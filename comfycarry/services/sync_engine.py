"""
ComfyCarry — Cloud Sync v2 引擎

- 同步规则 CRUD
- rclone 配置解析
- Sync Worker 后台线程
- 同步设置管理
"""

import json
import os
import re
import subprocess
import threading
import time
import uuid

from ..config import (
    COMFYUI_DIR, RCLONE_CONF, SYNC_RULES_FILE, SYNC_SETTINGS_FILE,
)


# ── 同步规则 CRUD ────────────────────────────────────────────

def _load_sync_rules():
    """加载同步规则"""
    if SYNC_RULES_FILE.exists():
        try:
            return json.loads(SYNC_RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def _save_sync_rules(rules):
    """保存同步规则"""
    SYNC_RULES_FILE.write_text(
        json.dumps(rules, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# ── Rclone 配置解析 ──────────────────────────────────────────

def _parse_rclone_conf():
    """解析 rclone.conf 返回 remote 列表"""
    remotes = []
    if not RCLONE_CONF.exists():
        return remotes
    current = None
    for line in RCLONE_CONF.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        m = re.match(r'^\[(.+)\]$', line)
        if m:
            if current:
                remotes.append(current)
            current = {"name": m.group(1), "type": "", "params": {},
                       "_has_token": False, "_has_keys": False, "_has_pass": False}
        elif current and '=' in line:
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip()
            if k == "type":
                current["type"] = v
            if k == "token" and v:
                current["_has_token"] = True
            if k == "access_key_id" and v:
                current["_has_keys"] = True
            if k in ("pass", "password", "user", "key_file") and v:
                current["_has_pass"] = True
            if k not in ("token", "access_key_id", "secret_access_key", "refresh_token"):
                current["params"][k] = v
    if current:
        remotes.append(current)
    return remotes


# ── 同步设置 ─────────────────────────────────────────────────

def _load_sync_settings():
    """加载全局同步设置"""
    defaults = {"min_age": 30, "watch_interval": 60}
    try:
        if SYNC_SETTINGS_FILE.exists():
            data = json.loads(SYNC_SETTINGS_FILE.read_text())
            defaults.update(data)
    except Exception:
        pass
    return defaults


def _save_sync_settings(settings):
    """保存全局同步设置"""
    SYNC_SETTINGS_FILE.write_text(json.dumps(settings, indent=2))


# ── Sync Worker ──────────────────────────────────────────────

_sync_worker_thread = None
_sync_worker_stop = threading.Event()
_sync_exec_lock = threading.Lock()
_sync_current_proc = None          # 当前正在执行的 rclone 子进程
_sync_current_proc_lock = threading.Lock()
_sync_log_buffer = []
_sync_log_lock = threading.Lock()

# Job 追踪 — _current_job_id 是模块级变量（跨线程可见）
_current_job_id: str | None = None
_current_job_id_lock = threading.Lock()
# rule_id 只在执行线程内使用，用 thread-local 即可
_current_job = threading.local()   # _current_job.rule_id

# 引用 Flask app logger (延迟绑定)
_app_logger = None


def set_app_logger(logger):
    """由 app.py 调用，绑定 Flask logger"""
    global _app_logger
    _app_logger = logger


def _sync_log(key, params=None, level="info"):
    """写结构化日志到内存 buffer + DB event (双写)"""
    ts = time.strftime("%H:%M:%S")
    entry = {"ts": ts, "key": key, "params": params or {}, "level": level}
    with _sync_log_lock:
        _sync_log_buffer.append(entry)
        if len(_sync_log_buffer) > 300:
            _sync_log_buffer[:] = _sync_log_buffer[-300:]
    if _app_logger:
        _app_logger.debug(f"[sync] {key} {params or {}}")
    # DB 双写 — 有活跃 job 时写入 sync_job_events
    with _current_job_id_lock:
        job_id = _current_job_id
    if job_id:
        try:
            from . import sync_store as store
            store.add_event(
                job_id, key,
                rule_id=getattr(_current_job, "rule_id", ""),
                level=level, params=params,
            )
        except Exception:
            pass  # DB 写入失败不影响主逻辑


def get_sync_log_buffer():
    """获取日志缓冲的副本"""
    with _sync_log_lock:
        return list(_sync_log_buffer)


def _fmt_bytes(n: int | float) -> str:
    """Format bytes to human readable string."""
    if n < 1024:
        return f"{int(n)} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


def _parse_rclone_json_logs(stderr_output: str) -> dict:
    """解析 rclone --use-json-log 的 JSON 日志, 提取传输统计。"""
    stats: dict = {}
    files: list[str] = []

    for line in stderr_output.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue

        # 收集传输的文件名 (INFO 级别, object 字段)
        if entry.get('level') == 'info' and 'object' in entry:
            msg = entry.get('msg', '')
            if any(kw in msg for kw in ('Copied', 'Moved', 'Deleted', 'Updated')):
                files.append(entry['object'])

        # 结构化统计 (最后一次出现为准)
        if 'stats' in entry and isinstance(entry['stats'], dict):
            s = entry['stats']
            stats.update({
                'bytes': s.get('bytes', 0),
                'total_bytes': s.get('totalBytes', 0),
                'speed': s.get('speed', 0),           # bytes/s
                'transfers': s.get('transfers', 0),
                'total_transfers': s.get('totalTransfers', 0),
                'checks': s.get('checks', 0),
                'errors': s.get('errors', 0),
                'elapsed': s.get('elapsedTime', 0),
            })

    if files:
        stats['files'] = files

    return stats


def _run_sync_rule(rule):
    """执行单条同步规则 (rclone subprocess), 带并发锁。返回 (ok, stats)。"""
    with _sync_exec_lock:
        return _run_sync_rule_inner(rule)


def _run_sync_rule_inner(rule):
    """_run_sync_rule 的内部实现。返回 (ok: bool, stats: dict)。"""
    remote = rule.get("remote", "")
    remote_path = rule.get("remote_path", "")
    local_rel = rule.get("local_path", "")
    method = rule.get("method", "sync")
    direction = rule.get("direction", "pull")
    filters = rule.get("filters", [])
    name = rule.get("name", rule.get("id", "?"))
    rule_id = rule.get("id", "")

    # 设置当前 rule_id 供 _sync_log DB 双写使用
    _current_job.rule_id = rule_id

    local_abs = os.path.join(COMFYUI_DIR, local_rel)
    os.makedirs(local_abs, exist_ok=True)

    remote_spec = f"{remote}:{remote_path}"
    if direction == "pull":
        src, dst = remote_spec, local_abs
    else:
        src, dst = local_abs, remote_spec

    cmd = ["rclone", method, src, dst, "--transfers", "4",
           "-v", "--use-json-log", "--stats-one-line"]

    if direction == "push":
        settings = _load_sync_settings()
        min_age = settings.get("min_age", 30)
        if min_age > 0:
            cmd.extend(["--min-age", f"{min_age}s"])

    for f in filters:
        cmd.extend(["--filter", f])

    start_key = "rule_start_pull" if direction == "pull" else "rule_start_push"
    _sync_log(start_key, {"name": name, "src": src, "dst": dst, "method": method})
    try:
        global _sync_current_proc
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        with _sync_current_proc_lock:
            _sync_current_proc = proc
        try:
            stdout, stderr = proc.communicate(timeout=600)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
            _sync_log("rule_timeout", {"name": name, "seconds": 600}, "error")
            return False, {}
        finally:
            with _sync_current_proc_lock:
                _sync_current_proc = None

        # 解析 JSON 日志获取结构化统计
        rule_stats = _parse_rclone_json_logs(stderr)

        # SSE 日志: 结构化事件 (不存 raw log)
        transferred_files = rule_stats.get('files', [])
        for fname in transferred_files[:30]:
            _sync_log("file_transferred", {"name": fname})

        # 统计摘要 — 使用 rclone_output 格式化文本, 兼容 SSE 翻译
        xfer = rule_stats.get('transfers', 0)
        byt = rule_stats.get('bytes', 0)
        spd = rule_stats.get('speed', 0)
        if xfer or byt:
            parts = [f"{xfer} files"]
            if byt:
                parts.append(_fmt_bytes(byt))
            if spd:
                parts.append(f"{_fmt_bytes(spd)}/s")
            _sync_log("rclone_output", {"text": f"📊 {name}: {' · '.join(parts)}"})

        if proc.returncode == 0:
            _sync_log("rule_done", {"name": name}, "success")
        else:
            _sync_log("rule_failed", {"name": name, "code": proc.returncode}, "error")
        return proc.returncode == 0, rule_stats
    except Exception as e:
        _sync_log("rule_error", {"name": name, "error": str(e)}, "error")
        return False, {}


def get_current_job_id() -> str | None:
    """返回当前正在执行的 job_id (跨线程安全)。"""
    with _current_job_id_lock:
        return _current_job_id


def run_rules_as_job(rules: list[dict], trigger_type: str = "manual",
                     trigger_ref: str = "") -> str:
    """
    将一组规则打包为一个 Job 执行。
    创建 DB job 记录，逐条执行规则，统计成功/失败，最后 finish。
    返回 job_id。
    """
    global _current_job_id
    job_id = f"sync-{uuid.uuid4().hex[:12]}"
    rule_count = len(rules)

    # 创建 DB job
    try:
        from . import sync_store as store
        store.create_job(job_id, trigger_type=trigger_type,
                         trigger_ref=trigger_ref, rule_count=rule_count)
    except Exception as e:
        if _app_logger:
            _app_logger.warning(f"[sync] create_job failed: {e}")

    # 设置当前 job (模块级，跨线程可见)
    with _current_job_id_lock:
        _current_job_id = job_id
    _current_job.rule_id = ""

    success_count = 0
    failure_count = 0
    all_stats: list[dict] = []
    # 只有 watch 类型受 stop 信号中断; 手动/部署执行不受 worker stop 影响
    check_stop = (trigger_type == "watch")
    was_cancelled = False
    try:
        for rule in rules:
            if check_stop and _sync_worker_stop.is_set():
                was_cancelled = True
                break
            ok, rule_stats = _run_sync_rule(rule)
            if ok:
                success_count += 1
            else:
                failure_count += 1
            if rule_stats:
                all_stats.append(rule_stats)
            # 增量更新 DB 进度 (每条规则执行完后)
            try:
                from . import sync_store as store
                store.update_job_progress(
                    job_id,
                    success_count=success_count,
                    failure_count=failure_count,
                )
            except Exception:
                pass
    finally:
        # 清理线程局部变量
        _current_job.rule_id = ""

        # 聚合统计
        total_bytes = sum(s.get('bytes', 0) for s in all_stats)
        total_transfers = sum(s.get('transfers', 0) for s in all_stats)
        total_elapsed = sum(s.get('elapsed', 0) for s in all_stats)
        all_files: list[str] = []
        for s in all_stats:
            all_files.extend(s.get('files', []))
        avg_speed = round(total_bytes / total_elapsed) if total_elapsed > 0 else 0

        summary = {
            'bytes': total_bytes,
            'speed': avg_speed,
            'transfers': total_transfers,
            'files': all_files[:50],     # 最多保存 50 个文件名
            'errors': sum(s.get('errors', 0) for s in all_stats),
        }

        # 决定 job 终态
        if was_cancelled:
            status = "cancelled"
        elif failure_count == 0:
            status = "success"
        elif success_count == 0:
            status = "failed"
        else:
            status = "partial"

        # Finish DB job
        try:
            from . import sync_store as store
            store.finish_job(
                job_id, status=status,
                success_count=success_count,
                failure_count=failure_count,
                files_synced=total_transfers,
                summary=summary,
            )
        except Exception as e:
            if _app_logger:
                _app_logger.warning(f"[sync] finish_job failed: {e}")

        with _current_job_id_lock:
            _current_job_id = None

    return job_id


def _sync_worker_loop():
    """后台线程: 持续执行 watch 类型规则"""
    _sync_log("worker_started")
    while not _sync_worker_stop.is_set():
        rules = _load_sync_rules()
        watch_rules = [r for r in rules if r.get("trigger") == "watch" and r.get("enabled", True)]
        if not watch_rules:
            _sync_worker_stop.wait(30)
            continue
        method_order = {"copy": 0, "sync": 1, "move": 2}
        watch_rules.sort(key=lambda r: method_order.get(r.get("method", "sync"), 1))

        # 过滤: push 规则只在有真实文件时执行
        runnable = []
        for rule in watch_rules:
            if _sync_worker_stop.is_set():
                break
            if rule.get("direction") == "push":
                local_abs = os.path.join(COMFYUI_DIR, rule.get("local_path", ""))
                if os.path.isdir(local_abs):
                    has_real = False
                    try:
                        for root, dirs, files in os.walk(local_abs):
                            dirs[:] = [d for d in dirs if not d.startswith('.')]
                            for f in files:
                                if not f.startswith('.') and not f.startswith('_'):
                                    has_real = True
                                    break
                            if has_real:
                                break
                    except FileNotFoundError:
                        continue
                    if not has_real:
                        continue
            runnable.append(rule)

        if runnable and not _sync_worker_stop.is_set():
            run_rules_as_job(runnable, trigger_type="watch")

        settings = _load_sync_settings()
        wait = max(settings.get("watch_interval", 60), 5)
        _sync_worker_stop.wait(wait)
    _sync_log("worker_stopped")


def is_worker_running():
    """检查 Sync Worker 是否在运行"""
    return _sync_worker_thread is not None and _sync_worker_thread.is_alive()


def start_sync_worker():
    """启动 sync worker 后台线程"""
    global _sync_worker_thread
    stop_sync_worker()
    if _sync_worker_thread and _sync_worker_thread.is_alive():
        _sync_log("worker_stale", level="warn")
        _sync_worker_thread.join(timeout=10)
        if _sync_worker_thread.is_alive():
            _sync_log("worker_stale_failed", level="error")
            return False
    _sync_worker_stop.clear()
    _sync_worker_thread = threading.Thread(target=_sync_worker_loop, daemon=True, name="sync-worker")
    _sync_worker_thread.start()
    return True


def stop_sync_worker():
    """停止 sync worker 并终止正在执行的 rclone 进程"""
    global _sync_worker_thread
    _sync_worker_stop.set()
    # 终止正在执行的 rclone 子进程
    with _sync_current_proc_lock:
        if _sync_current_proc and _sync_current_proc.poll() is None:
            try:
                _sync_current_proc.terminate()
                _sync_current_proc.wait(timeout=3)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    _sync_current_proc.kill()
                except OSError:
                    pass
            _sync_log("rclone_killed", level="warn")
    if _sync_worker_thread and _sync_worker_thread.is_alive():
        _sync_worker_thread.join(timeout=10)
    _sync_worker_thread = None
