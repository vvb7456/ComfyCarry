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

# 引用 Flask app logger (延迟绑定)
_app_logger = None


def set_app_logger(logger):
    """由 app.py 调用，绑定 Flask logger"""
    global _app_logger
    _app_logger = logger


def _sync_log(key, params=None, level="info"):
    """写结构化日志到内存 buffer"""
    ts = time.strftime("%H:%M:%S")
    entry = {"ts": ts, "key": key, "params": params or {}, "level": level}
    with _sync_log_lock:
        _sync_log_buffer.append(entry)
        if len(_sync_log_buffer) > 300:
            _sync_log_buffer[:] = _sync_log_buffer[-300:]
    if _app_logger:
        _app_logger.debug(f"[sync] {key} {params or {}}")


def get_sync_log_buffer():
    """获取日志缓冲的副本"""
    with _sync_log_lock:
        return list(_sync_log_buffer)


def _run_sync_rule(rule):
    """执行单条同步规则 (rclone subprocess), 带并发锁"""
    with _sync_exec_lock:
        return _run_sync_rule_inner(rule)


def _run_sync_rule_inner(rule):
    """_run_sync_rule 的内部实现"""
    remote = rule.get("remote", "")
    remote_path = rule.get("remote_path", "")
    local_rel = rule.get("local_path", "")
    method = rule.get("method", "sync")
    direction = rule.get("direction", "pull")
    filters = rule.get("filters", [])
    name = rule.get("name", rule.get("id", "?"))

    local_abs = os.path.join(COMFYUI_DIR, local_rel)
    os.makedirs(local_abs, exist_ok=True)

    remote_spec = f"{remote}:{remote_path}"
    if direction == "pull":
        src, dst = remote_spec, local_abs
    else:
        src, dst = local_abs, remote_spec

    cmd = ["rclone", method, src, dst, "--transfers", "4", "-P"]

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
            return False
        finally:
            with _sync_current_proc_lock:
                _sync_current_proc = None
        output = (stdout + stderr).strip()
        if output:
            for line in output.split('\n')[-3:]:
                line = line.strip()
                if line:
                    _sync_log("rclone_output", {"text": line})
        if proc.returncode == 0:
            _sync_log("rule_done", {"name": name}, "success")
        else:
            _sync_log("rule_failed", {"name": name, "code": proc.returncode}, "error")
        return proc.returncode == 0
    except Exception as e:
        _sync_log("rule_error", {"name": name, "error": str(e)}, "error")
        return False


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
            _run_sync_rule(rule)
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
