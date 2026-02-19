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
_sync_log_buffer = []
_sync_log_lock = threading.Lock()

# 引用 Flask app logger (延迟绑定)
_app_logger = None


def set_app_logger(logger):
    """由 app.py 调用，绑定 Flask logger"""
    global _app_logger
    _app_logger = logger


def _sync_log(msg):
    """写日志到内存 buffer"""
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    with _sync_log_lock:
        _sync_log_buffer.append(line)
        if len(_sync_log_buffer) > 300:
            _sync_log_buffer[:] = _sync_log_buffer[-300:]
    if _app_logger:
        _app_logger.debug(f"[sync] {msg}")


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

    _sync_log(f"{'⬇' if direction == 'pull' else '⬆'} {name}: {src} → {dst} ({method})")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        output = (proc.stdout + proc.stderr).strip()
        if output:
            for line in output.split('\n')[-3:]:
                line = line.strip()
                if line:
                    _sync_log(f"  {line}")
        if proc.returncode == 0:
            _sync_log(f"✅ {name} 完成")
        else:
            _sync_log(f"❌ {name} 失败 (code={proc.returncode})")
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        _sync_log(f"⏰ {name} 超时 (600s)")
        return False
    except Exception as e:
        _sync_log(f"❌ {name} 异常: {e}")
        return False


def _sync_worker_loop():
    """后台线程: 持续执行 watch 类型规则"""
    _sync_log("☁️ Sync Worker 已启动")
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
                    for root, dirs, files in os.walk(local_abs):
                        dirs[:] = [d for d in dirs if not d.startswith('.')]
                        for f in files:
                            if not f.startswith('.') and not f.startswith('_'):
                                has_real = True
                                break
                        if has_real:
                            break
                    if not has_real:
                        continue
            _run_sync_rule(rule)
        settings = _load_sync_settings()
        wait = max(settings.get("watch_interval", 60), 5)
        _sync_worker_stop.wait(wait)
    _sync_log("🛑 Sync Worker 已停止")


def is_worker_running():
    """检查 Sync Worker 是否在运行"""
    return _sync_worker_thread is not None and _sync_worker_thread.is_alive()


def start_sync_worker():
    """启动 sync worker 后台线程"""
    global _sync_worker_thread
    stop_sync_worker()
    if _sync_worker_thread and _sync_worker_thread.is_alive():
        _sync_log("⚠️ 旧 Worker 仍在运行, 等待终止...")
        _sync_worker_thread.join(timeout=10)
        if _sync_worker_thread.is_alive():
            _sync_log("❌ 旧 Worker 无法停止, 跳过启动")
            return False
    _sync_worker_stop.clear()
    _sync_worker_thread = threading.Thread(target=_sync_worker_loop, daemon=True, name="sync-worker")
    _sync_worker_thread.start()
    return True


def stop_sync_worker():
    """停止 sync worker"""
    global _sync_worker_thread
    _sync_worker_stop.set()
    if _sync_worker_thread and _sync_worker_thread.is_alive():
        _sync_worker_thread.join(timeout=5)
    _sync_worker_thread = None
