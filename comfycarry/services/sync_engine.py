"""
ComfyCarry — Cloud Sync v2 引擎

- 同步规则 CRUD
- rclone 配置解析
- Sync Worker 后台线程
- 同步设置管理
"""

import json
import os
import queue
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass

from ..config import (
    RCLONE_CONF, SYNC_RULES_FILE, SYNC_SETTINGS_FILE,
    REMOTE_ROOT_DIR_KEY, resolve_workspace_path,
)


def _local_abs(rule_path: str) -> str | None:
    """规则里的 local_path (workspace 根相对) → 真实绝对路径。越界返回 None。"""
    target, err = resolve_workspace_path(rule_path, allow_root=False)
    return None if err else str(target)


# ── 同步规则 CRUD ────────────────────────────────────────────

# 规则 / 设置文件的写锁 —— 面板保存与 deploy 阶段落盘可能并发
_rules_file_lock = threading.Lock()
_settings_file_lock = threading.Lock()

def _load_sync_rules():
    """加载同步规则"""
    if SYNC_RULES_FILE.exists():
        try:
            return json.loads(SYNC_RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def _atomic_write_json(path, data):
    """同目录临时文件 + os.replace 原子替换。

    直接 write_text 时进程在写入中途退出会留下截断 JSON, 而 _load_sync_rules
    对损坏文件的兜底是返回 [] —— 等于规则全丢。
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _save_sync_rules(rules):
    """保存同步规则 (原子写 + 串行化, 防并发保存互相覆盖)"""
    with _rules_file_lock:
        _atomic_write_json(SYNC_RULES_FILE, rules)


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
            current = {"name": m.group(1), "type": "", "root_dir": "", "params": {},
                       "_has_token": False, "_has_keys": False, "_has_pass": False}
        elif current and '=' in line:
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip()
            if k == "type":
                current["type"] = v
            if k == REMOTE_ROOT_DIR_KEY:
                # 同步文件夹是 remote 的一等字段, 不是凭据参数
                current["root_dir"] = v
            if k == "token" and v:
                current["_has_token"] = True
            if k == "access_key_id" and v:
                current["_has_keys"] = True
            if k in ("pass", "password", "user", "key_file") and v:
                current["_has_pass"] = True
            if k not in ("token", "access_key_id", "secret_access_key",
                         "refresh_token", REMOTE_ROOT_DIR_KEY):
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
    with _settings_file_lock:
        _atomic_write_json(SYNC_SETTINGS_FILE, settings)


# ── Sync Worker ──────────────────────────────────────────────

_sync_worker_thread = None
_sync_worker_stop = threading.Event()
_sync_exec_lock = threading.Lock()
_sync_current_proc = None          # 当前正在执行的 rclone 子进程
_sync_current_proc_lock = threading.Lock()
_sync_log_buffer = []
_sync_log_lock = threading.Lock()

# Job 追踪。
# _current_job.job_id / .rule_id 是 thread-local: 日志归属必须按执行线程算 ——
# 用模块级单变量时, 后开始的 job 会覆盖它, 前一个 job 的后续事件就写进了
# 别人的记录里 (worker 跑 watch job 时用户点手动执行即可复现)。
_current_job = threading.local()   # .job_id / .rule_id


# ── 同步任务队列 & 常驻执行员 ─────────────────────────────────
#
# 所有同步任务都由唯一执行员顺序执行: 发起人 (run 接口 / watch 调度) 只
# 入队, 不再各自起线程。排队行立即落库, 因此列表可见、可取消。

@dataclass
class JobRequest:
    """队列元素: 一条待执行任务及其规则快照 (原始规则字典, 非展示快照)。"""
    job_id: str
    rules: list[dict]
    trigger_type: str
    trigger_ref: str


_job_queue: "queue.Queue[JobRequest]" = queue.Queue()
_executor_thread = None                  # 常驻执行员单例
_executor_lock = threading.Lock()        # 保证执行员单例
_queue_lock = threading.Lock()           # 入队与停止清队互斥
_active_job_id: str | None = None        # 执行员当前正在跑的任务
_active_interrupt = threading.Event()    # 当前任务的中断信号

# 引用 Flask app logger (延迟绑定)
_app_logger = None


def set_app_logger(logger):
    """由 app.py 调用，绑定 Flask logger"""
    global _app_logger
    _app_logger = logger


def _sync_log(key, params=None, level="info"):
    """写结构化日志到内存 buffer + DB event (双写) + 落盘 /workspace/sync.log (JSONL)"""
    ts = time.strftime("%H:%M:%S")
    entry = {"ts": ts, "key": key, "params": params or {}, "level": level}
    with _sync_log_lock:
        _sync_log_buffer.append(entry)
        if len(_sync_log_buffer) > 300:
            _sync_log_buffer[:] = _sync_log_buffer[-300:]
    if _app_logger:
        _app_logger.debug(f"[sync] {key} {params or {}}")
    # 落盘 JSONL: 前端读文件后逐行 JSON.parse 还原结构化, 再走 translateLogEntry 翻译。
    # 这样 sync 面板和其他日志面板统一用 log_service 读文件, 不再走内存 buffer 取数。
    try:
        with open("/workspace/sync.log", "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass
    # DB 双写 - 有活跃 job 时写入 sync_job_events (按执行线程归属)
    job_id = getattr(_current_job, "job_id", None)
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
    local_path = rule.get("local_path", "")
    method = rule.get("method", "sync")
    direction = rule.get("direction", "pull")
    filters = rule.get("filters", [])
    name = rule.get("name", rule.get("id", "?"))
    rule_id = rule.get("id", "")

    # 设置当前 rule_id 供 _sync_log DB 双写使用
    _current_job.rule_id = rule_id

    local_abs = _local_abs(local_path)
    if local_abs is None:
        # 独立 key: 插值参数里塞中文句子的话, 英文 locale 下会是英文模板+中文插值
        _sync_log("rule_path_invalid", {"name": name, "path": local_path}, "error")
        return False, {}
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
            _sync_log("rclone_output", {"text": f"{name}: {' · '.join(parts)}"})

        if proc.returncode == 0:
            _sync_log("rule_done", {"name": name}, "success")
        else:
            _sync_log("rule_failed", {"name": name, "code": proc.returncode}, "error")
        return proc.returncode == 0, rule_stats
    except Exception as e:
        _sync_log("rule_error", {"name": name, "error": str(e)}, "error")
        return False, {}


def get_current_job_id() -> str | None:
    """返回执行员当前正在执行的任务 id (无任务时为 None)。"""
    return _active_job_id


def interrupt_active_job(job_id: str) -> bool:
    """中断当前正在执行的任务。

    job_id 与执行员的活动任务不一致时返回 False (调用方据此拒绝, 避免误杀)。
    只置中断信号并终止当前 rclone 进程, 不触碰队列与 watch 调度 —— 执行员
    在该任务收尾后继续下一条。
    """
    if not job_id or job_id != _active_job_id:
        return False
    _active_interrupt.set()
    _terminate_current_proc()
    return True


# 执行规则写入历史记录时保留的展示字段 (其余运行时字段不落快照)
_RULE_SNAPSHOT_FIELDS = (
    "id", "name", "direction", "method",
    "remote", "remote_path", "local_path", "trigger",
)


def build_rule_snapshot(rule: dict) -> dict:
    """从规则字典提取展示快照, 缺失字段补空串。

    快照用于历史记录在规则被编辑/删除后继续显示名称与流向, 只保留展示
    需要的字段, 授权等敏感信息仍由 remote 配置管理。
    """
    return {k: str(rule.get(k) or "") for k in _RULE_SNAPSHOT_FIELDS}


def run_rules_as_job(rules: list[dict], trigger_type: str = "manual",
                     trigger_ref: str = "", *, job_id: str | None = None) -> str:
    """
    将一组规则打包为一个 Job 执行。
    逐条执行规则，统计成功/失败，最后 finish。返回 job_id。

    job_id 为空时保持旧行为: 自建 running 行再执行 (测试与直接调用方)。
    传入 job_id 时假定行已由 enqueue_job 建为 queued: 不再建行, 开始时用
    条件 UPDATE 置 running; 未命中 (排队期间被取消/停止清队) 直接返回,
    不执行规则也不 finish —— 行已是 cancelled 终态。

    注意: 本函数不写 _active_* 模块变量, 只读 _active_interrupt 做中断判定。
    这些活动状态由执行员循环维护, 避免在别处被调用时误清执行员的现场。
    """
    if job_id is None:
        job_id = f"sync-{uuid.uuid4().hex[:12]}"
        rule_count = len(rules)
        snapshots = [build_rule_snapshot(r) for r in rules]
        # 创建 DB job
        try:
            from . import sync_store as store
            store.create_job(job_id, trigger_type=trigger_type,
                             trigger_ref=trigger_ref, rule_count=rule_count,
                             rules=snapshots)
        except Exception as e:
            if _app_logger:
                _app_logger.warning(f"[sync] create_job failed: {e}")
    else:
        from . import sync_store as store
        # mark_job_running 是条件 UPDATE: 排队期间已被取消/停止清队时未命中,
        # 该任务不再执行 (行保持 cancelled 终态, 执行员跳过)
        if not store.mark_job_running(job_id):
            return job_id

    # 本线程的 job 归属 (thread-local, 不会被并发 job 覆盖)
    _current_job.job_id = job_id
    _current_job.rule_id = ""

    success_count = 0
    failure_count = 0
    all_stats: list[dict] = []
    # 只有 watch 类型受 worker stop 信号中断; 手动/部署执行不受其影响
    check_stop = (trigger_type == "watch")
    was_cancelled = False
    was_interrupted = False
    try:
        for rule in rules:
            # 中断判定对所有触发类型生效
            if _active_interrupt.is_set():
                was_interrupted = True
                break
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
            # 进程在规则中被杀时该规则已返回, 这里补一次判定
            if _active_interrupt.is_set():
                was_interrupted = True
                break
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
        # 执行中被中断 / watch 调度被停止都是 interrupted; cancelled 仅用于
        # 「从未开始执行就被取消」, 由 cancel 接口直接落库, 不经过这里
        if was_interrupted or was_cancelled:
            status = "interrupted"
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

        _current_job.job_id = None

    return job_id


def enqueue_job(rules: list[dict], trigger_type: str = "manual",
                trigger_ref: str = "") -> str:
    """把一组规则加入同步队列, 返回 job_id。

    持 _queue_lock 让「写 queued 行 + 放队列」与「停止清队」整体互斥, 避免
    出现「DB 还是 queued 但队列里已没有」或反之的半截记录。执行员懒启动。
    """
    job_id = f"sync-{uuid.uuid4().hex[:12]}"
    snapshots = [build_rule_snapshot(r) for r in rules]
    with _queue_lock:
        from . import sync_store as store
        store.create_job(job_id, trigger_type=trigger_type,
                         trigger_ref=trigger_ref, rule_count=len(rules),
                         rules=snapshots, status="queued", queued_at=time.time())
        _job_queue.put(JobRequest(job_id, list(rules), trigger_type, trigger_ref))
    _ensure_executor()
    return job_id


def _ensure_executor():
    """确保常驻执行员线程存在 (懒启动单例)。"""
    global _executor_thread
    with _executor_lock:
        if _executor_thread is None or not _executor_thread.is_alive():
            _executor_thread = threading.Thread(
                target=_executor_loop, daemon=True, name="sync-executor")
            _executor_thread.start()


def _executor_loop():
    """常驻执行员: 从队列取任务顺序执行, 队列空时阻塞在 get() 不占资源。

    整体套一层异常保护: 单条任务的意外异常只记日志, 绝不允许常驻执行员
    线程死亡 (否则后续入队的任务永远无人消费)。
    """
    while True:
        try:
            req = _job_queue.get()
            try:
                _executor_run_one(req)
            finally:
                _job_queue.task_done()
        except Exception as e:
            _sync_log("executor_error", {"error": str(e)}, "error")
            if _app_logger:
                _app_logger.exception("[sync] executor task failed")


def _executor_run_one(req: JobRequest):
    """执行单条队列任务, 维护执行员的活动任务状态。"""
    global _active_job_id
    from . import sync_store as store

    # 以 DB 状态为准: 排队期间被取消/停止清队时直接跳过
    job = store.get_job(req.job_id)
    if not job or job.get("status") != "queued":
        return
    # watch 调度已停止: 丢弃待跑的 watch 任务 (手动任务不受影响)
    if req.trigger_type == "watch" and _sync_worker_stop.is_set():
        store.cancel_queued_job(req.job_id)
        return

    # 活动状态的设置/清理全部放在这里 (不在 run_rules_as_job 里), 避免该
    # 函数在别处被调用时误清执行员的现场
    _active_job_id = req.job_id
    _active_interrupt.clear()
    try:
        run_rules_as_job(req.rules, req.trigger_type, req.trigger_ref,
                         job_id=req.job_id)
    finally:
        _active_job_id = None


def _terminate_current_proc():
    """终止当前正在执行的 rclone 子进程 (terminate + wait, kill 兜底)。"""
    with _sync_current_proc_lock:
        proc = _sync_current_proc
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    proc.kill()
                except OSError:
                    pass
            _sync_log("rclone_killed", level="warn")


def _sync_worker_loop():
    """后台线程: 持续执行 watch 类型规则"""
    _sync_log("worker_started")
    while not _sync_worker_stop.is_set():
        try:
            _sync_worker_tick()
        except Exception as e:
            # 单轮出错不能让 worker 静默死掉 —— 之前 os.walk 撞上无读权限的
            # 子目录就会把线程带走, is_worker_running() 变假且没有任何线索
            _sync_log("worker_error", {"error": str(e)}, "error")
            if _app_logger:
                _app_logger.exception("[sync] worker tick failed")
            _sync_worker_stop.wait(10)
    _sync_log("worker_stopped")


def _has_syncable_files(local_abs: str) -> bool:
    """目录下是否有非隐藏、非下划线开头的真实文件 (push 规则的执行前提)。"""
    try:
        for root, dirs, files in os.walk(local_abs):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if not f.startswith('.') and not f.startswith('_'):
                    return True
    except OSError:
        # FileNotFoundError / PermissionError 等一律当作"没有可同步文件"
        return False
    return False


def _sync_worker_tick():
    """worker 的单轮迭代 (异常由 _sync_worker_loop 兜住)"""
    rules = _load_sync_rules()
    watch_rules = [r for r in rules
                   if r.get("trigger") == "watch" and r.get("enabled", True)]
    if not watch_rules:
        _sync_worker_stop.wait(30)
        return
    method_order = {"copy": 0, "sync": 1, "move": 2}
    watch_rules.sort(key=lambda r: method_order.get(r.get("method", "sync"), 1))

    # 过滤: push 规则只在有真实文件时执行
    runnable = []
    for rule in watch_rules:
        if _sync_worker_stop.is_set():
            break
        if rule.get("direction") == "push":
            local_abs = _local_abs(rule.get("local_path", ""))
            if local_abs and os.path.isdir(local_abs) and not _has_syncable_files(local_abs):
                continue
        runnable.append(rule)

    if runnable and not _sync_worker_stop.is_set():
        from . import sync_store as store
        # 已有 watch 任务在排队或执行时本轮不入队, 防止队列无界堆积
        if not store.has_active_watch_job():
            enqueue_job(runnable, trigger_type="watch")

    settings = _load_sync_settings()
    wait = max(settings.get("watch_interval", 60), 5)
    _sync_worker_stop.wait(wait)


def is_worker_running():
    """检查 Sync Worker 是否在运行"""
    return _sync_worker_thread is not None and _sync_worker_thread.is_alive()


def start_sync_worker():
    """启动 sync worker 后台线程 (先回收旧调度, 不丢手动队列)"""
    global _sync_worker_thread
    stop_sync_worker(cancel_pending=False)
    _sync_worker_stop.clear()
    _sync_worker_thread = threading.Thread(target=_sync_worker_loop, daemon=True, name="sync-worker")
    _sync_worker_thread.start()


def stop_sync_worker(*, cancel_pending: bool = True):
    """停止 watch 调度线程。

    cancel_pending=True (用户「停止」/ 设置页重置): 终止当前任务并把队列里
    所有 queued 任务标为 cancelled 后清空队列, 停止后无任何排队残留。
    cancel_pending=False (重启 / 规则变更的内部回收): 只停调度线程, 不杀
    rclone 进程、不清手动队列。

    执行员线程本身常驻, 不随停止销毁 —— 避免「停线程 / 下次入队再启动」
    的哨兵竞态; 「停止」的保证由清空队列与 DB 取消提供。
    """
    global _sync_worker_thread
    _sync_worker_stop.set()
    # worker 现在只调度不执行, join 很快; 不再需要先杀进程才能让线程退出
    if _sync_worker_thread and _sync_worker_thread.is_alive():
        _sync_worker_thread.join(timeout=10)
    _sync_worker_thread = None

    if not cancel_pending:
        return

    # 快照活动 job: 释放 _queue_lock 后可能有新任务入队并开跑, 若不快照会
    # 误伤那个 stop 之后才创建的新任务 (cancel_all 不影响它)
    with _queue_lock:
        active = _active_job_id
        from . import sync_store as store
        store.cancel_all_queued_jobs()
        while True:
            try:
                _job_queue.get_nowait()
            except queue.Empty:
                break

    if active:
        # 经 interrupt_active_job 的 job_id 原子比对兜底: 快照与 set 之间
        # 旧任务可能已结束、新任务可能已开跑, 比对不一致时放弃中断, 不误杀
        interrupt_active_job(active)
