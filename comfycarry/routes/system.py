"""
ComfyCarry — 系统监控 & 服务管理路由

包含:
- /api/version         — 版本信息
- /api/system/stats    — 实时系统指标 (读缓存, <1ms)
- (internal)           — api_system() → 由 /api/overview 聚合
- /api/services/<name>/<action> — 服务控制 (start/stop/restart)
- /api/logs/<name>     — PM2 日志查看
"""

import json
import os
import re
import subprocess
import time

from flask import Blueprint, jsonify, request, Response

import requests as req_lib

from ..config import SCRIPT_DIR, COMFYUI_URL, APP_VERSION
from ..utils import _run_cmd
from ..services import system_monitor

bp = Blueprint("system", __name__)


# ====================================================================
# 响应文案 —— key + params, 由前端翻译 (i18n/locales/*/system.json)
# 契约同 sync.py: error_key=system.err.<key> + error_params; str(e)
# 原文不翻译, 作为 detail 参数透传。
# ====================================================================
def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `system.err.<key>` 翻译; _extra 是响应体附加顶层字段。"""
    body = {"error_key": f"system.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


# ====================================================================
# 版本信息 API
# ====================================================================
@bp.route("/api/version")
def api_version():
    """返回当前部署版本信息"""
    version_info = {"version": APP_VERSION, "branch": "main", "commit": ""}
    version_file = os.path.join(SCRIPT_DIR, ".version")
    try:
        if os.path.exists(version_file):
            with open(version_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line:
                        k, v = line.split("=", 1)
                        version_info[k.strip().lower()] = v.strip()
    except Exception:
        pass
    # Also try git if available (dev environment)
    if not version_info.get("commit"):
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                cwd=SCRIPT_DIR, timeout=3
            )
            if result.returncode == 0:
                version_info["commit"] = result.stdout.strip()
            result2 = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True,
                cwd=SCRIPT_DIR, timeout=3
            )
            if result2.returncode == 0:
                version_info["branch"] = result2.stdout.strip()
        except Exception:
            pass
    return jsonify(version_info)


# ====================================================================
# 实时系统指标 (读 system_monitor 缓存, <1ms)
# ====================================================================
@bp.route("/api/system/stats")
def api_system_stats():
    """实时系统指标 — GPU / CPU / 内存 / 磁盘 / 网络"""
    return jsonify(system_monitor.get_stats())


# ====================================================================
# 系统监控 (内部函数, 由 api_overview 聚合调用)
# ====================================================================
def api_system():
    """获取系统信息 (仅供 api_overview 内部调用) — 读 monitor 缓存"""
    return jsonify(system_monitor.get_stats())


# ====================================================================
# 服务管理 (内部函数, 由 api_overview 聚合调用)
# ====================================================================
def api_services():
    """获取 PM2 服务列表 (仅供 api_overview 内部调用)"""
    try:
        out = _run_cmd("pm2 jlist", timeout=5)
        if out and not out.startswith("Error"):
            services = json.loads(out)
            result = []
            for s in services:
                result.append({
                    "name": s.get("name"),
                    "pm_id": s.get("pm_id"),
                    "status": s.get("pm2_env", {}).get("status"),
                    "cpu": s.get("monit", {}).get("cpu", 0),
                    "memory": s.get("monit", {}).get("memory", 0),
                    "restarts": s.get("pm2_env", {}).get("restart_time", 0),
                    "uptime": s.get("pm2_env", {}).get("pm_uptime", 0),
                    "pid": s.get("pid"),
                })
            return jsonify({"services": result})
        return jsonify({"services": [], "error": out})
    except Exception as e:
        return jsonify({"services": [], "error": str(e)})


@bp.route("/api/services/<name>/<action>", methods=["POST"])
def api_service_action(name, action):
    """控制服务: restart, stop, start"""
    if action not in ("restart", "stop", "start"):
        return _err("invalid_action")
    if not re.match(r'^[\w\-]+$', name):
        return _err("invalid_service")
    out = _run_cmd(f"pm2 {action} {name}", timeout=10)
    return jsonify({"ok": True, "output": out})


# ====================================================================
# 日志 API
# ====================================================================
_pm2_names_cache: tuple[float, set[str]] | None = None
_PM2_CACHE_TTL = 3.0  # 秒, 避免每个日志请求都跑 pm2 jlist

def _pm2_log_path(name: str) -> str | None:
    """返回进程的合并日志文件路径 /workspace/<name>.log。

    所有 pm2 进程在启动时都带 ``--log /workspace/<name>.log --merge-logs`` (bootstrap
    负责 dashboard/jupyter, app.py 负责 comfy), out+err 合并到这一个文件。
    进程存在性查 jlist (3s 缓存, 不存在则返回 None), 路径用约定而非 jlist 的
    pm_out_log_path (后者在 resurrect 恢复的旧配置下指向默认 ~/.pm2/logs/)。

    注: cf-tunnel 的日志文件是 /workspace/tunnel.log (非 cf-tunnel.log),
    但 tunnel 页走自己的 /api/tunnel/logs 端点, 不经过这里。
    """
    global _pm2_names_cache
    import time as _time
    now = _time.time()
    if _pm2_names_cache and (now - _pm2_names_cache[0]) < _PM2_CACHE_TTL:
        names = _pm2_names_cache[1]
    else:
        try:
            proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=5)
            if proc.returncode != 0:
                return None
            apps = json.loads(proc.stdout or "[]")
            names = {a.get("name", "") for a in apps}
            _pm2_names_cache = (now, names)
        except Exception:
            return None
    return f"/workspace/{name}.log" if name in names else None


@bp.route("/api/logs/<name>")
def api_logs(name):
    """获取 PM2 进程日志 history (行号游标分页)。

    - ?lines=N           末尾 N 行 (默认 100)
    - ?before=K&lines=N  第 K 行 (含) 之前的 N 行 (往上滚懒加载)
    返回 {"entries": [{line, text, level}], "total": 文件总行数}。
    """
    if not re.match(r'^[\w\-]+$', name):
        return _err("invalid_service")
    path = _pm2_log_path(name)
    if not path:
        return jsonify({"entries": [], "total": 0})

    try:
        lines = int(request.args.get("lines", "100"))
    except (ValueError, TypeError):
        lines = 100
    before = request.args.get("before")
    before = int(before) if before and before.isdigit() else None

    from ..services.log_service import read_history
    return jsonify(read_history(path, before=before, lines=lines))


@bp.route("/api/logs/<name>/stream")
def api_logs_stream(name):
    """SSE - PM2 进程日志实时流 (tail -f 日志文件)。

    服务没跑时文件仍在磁盘, tail -f 照常打开 -> onopen 触发, 不卡 loading。
    """
    if not re.match(r'^[\w\-]+$', name):
        return _err("invalid_service")
    path = _pm2_log_path(name)
    if not path:
        # 进程不存在: 保持 SSE 挂起 (定期心跳), 每轮检查进程是否出现,
        # 出现则结束心跳让 EventSource 重连到真正的 tail -f。
        def heartbeat():
            import time as _time
            while True:
                yield ": heartbeat\n\n"
                _time.sleep(15)
                if _pm2_log_path(name):
                    return
        return Response(heartbeat(), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    from ..services.log_service import stream_tail
    return Response(stream_tail(path), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ====================================================================
# 总览聚合 API
# ====================================================================
@bp.route("/api/overview")
def api_overview():
    """聚合总览页所需全部数据，避免前端发 5+ 个并发请求"""
    from . import tunnel as tunnel_mod, jupyter as jupyter_mod
    from ..services import sync_engine, comfyui_bridge

    result = {}

    # ── 系统硬件 ──
    result["system"] = json.loads(api_system().get_data())

    # ── PM2 服务 ──
    result["services"] = json.loads(api_services().get_data())

    # ── ComfyUI 状态 ──
    comfyui = {"online": False, "version": "", "pytorch_version": "",
               "python_version": "", "queue_pending": 0, "queue_running": 0,
               "current_prompt_id": None, "progress": None}

    # 先检查 PM2 状态, 避免 ComfyUI 离线时浪费 6s 在 HTTP 超时上
    comfy_pm2_online = False
    for svc in result.get("services", {}).get("services", []):
        if svc.get("name") == "comfy":
            comfyui["pm2_status"] = svc.get("status")
            comfyui["pm2_uptime"] = svc.get("uptime")
            comfyui["pm2_restarts"] = svc.get("restarts", 0)
            comfy_pm2_online = svc.get("status") == "online"
            break

    if comfy_pm2_online:
        try:
            r = req_lib.get(f"{COMFYUI_URL}/system_stats", timeout=2)
            if r.ok:
                d = r.json()
                comfyui["online"] = True
                sys_info = d.get("system", {})
                comfyui["version"] = sys_info.get("comfyui_version", "")
                comfyui["pytorch_version"] = sys_info.get("pytorch_version", "")
                comfyui["python_version"] = sys_info.get("python_version", "")
        except Exception:
            pass
        try:
            r = req_lib.get(f"{COMFYUI_URL}/queue", timeout=2)
            if r.ok:
                q = r.json()
                comfyui["queue_running"] = len(q.get("queue_running", []))
                comfyui["queue_pending"] = len(q.get("queue_pending", []))
        except Exception:
            pass

    # Execution state from WS bridge
    bridge = comfyui_bridge.get_bridge()
    if bridge and bridge._exec_info:
        comfyui["executing"] = True
        comfyui["exec_start_time"] = bridge._exec_info.get("start_time")
        if bridge._last_progress:
            comfyui["progress"] = bridge._last_progress
    else:
        comfyui["executing"] = False

    result["comfyui"] = comfyui

    # ── Sync 状态 ──
    sync_status = {
        "worker_running": sync_engine.is_worker_running(),
        "rules_count": 0,
        "last_log_lines": [],
    }
    try:
        rules = sync_engine._load_sync_rules()
        sync_status["rules_count"] = len(rules)
        sync_status["active_rules"] = len([r for r in rules if r.get("enabled", True)])
        sync_status["watch_rules"] = len([r for r in rules
                                          if r.get("trigger") == "watch" and r.get("enabled", True)])
    except Exception:
        pass
    log_buf = sync_engine.get_sync_log_buffer()
    if log_buf:
        sync_status["last_log_lines"] = list(log_buf)[-5:]
    result["sync"] = sync_status

    # ── Tunnel (使用缓存, 避免每次调用 CF API) ──
    tunnel_info = {"running": False, "urls": {}}
    try:
        tunnel_data = tunnel_mod._build_tunnel_status()
        tunnel_info["configured"] = tunnel_data.get("configured", False)
        tunnel_info["urls"] = tunnel_data.get("urls", {})
        tunnel_info["cloudflared"] = tunnel_data.get("cloudflared", "unknown")
        tunnel_info["domain"] = tunnel_data.get("domain", "")
        tunnel_info["subdomain"] = tunnel_data.get("subdomain", "")
        tunnel_info["effective_status"] = tunnel_data.get("effective_status", "unconfigured")
        tunnel_info["tunnel_mode"] = tunnel_data.get("tunnel_mode", "")
        if tunnel_data.get("public"):
            tunnel_info["public"] = tunnel_data["public"]
        tunnel_status = tunnel_data.get("tunnel", {})
        tunnel_info["status"] = tunnel_status.get("status", "inactive")
        tunnel_info["running"] = tunnel_info["effective_status"] == "online"
    except Exception:
        pass
    # PM2 status for cf-tunnel (新名称)
    for svc in result.get("services", {}).get("services", []):
        if svc.get("name") == "cf-tunnel":
            tunnel_info["pm2_status"] = svc.get("status")
            break
    result["tunnel"] = tunnel_info

    # ── Jupyter ──
    try:
        jup_resp = jupyter_mod.jupyter_status()
        jup_data = jup_resp.get_json() if hasattr(jup_resp, 'get_json') else json.loads(jup_resp.get_data())
        result["jupyter"] = jup_data
    except Exception:
        result["jupyter"] = {"online": False}

    # ── Downloads ──
    downloads = {"active": [], "active_count": 0, "queue_count": 0}
    try:
        from ..services.download_engine import get_engine as _get_dl_engine
        tasks = _get_dl_engine().list_tasks()
        active = [t for t in tasks if t["status"] == "active"]
        queued = [t for t in tasks if t["status"] == "queued"]
        downloads["active"] = active[:3]
        downloads["active_count"] = len(active)
        downloads["queue_count"] = len(queued)
    except Exception:
        pass
    result["downloads"] = downloads

    # ── Dashboard 版本 ──
    ver_resp = api_version()
    result["version"] = ver_resp.get_json() if hasattr(ver_resp, 'get_json') else json.loads(ver_resp.get_data())

    return jsonify(result)


# ====================================================================
# 活动状态 API (快变化数据, 5s 轮询)
# ====================================================================
@bp.route("/api/activity")
def api_activity():
    """快变化数据聚合 — ComfyUI 队列/在线状态 + 下载进度 + Sync 日志"""
    from ..services import sync_engine, comfyui_bridge

    result = {}

    # ── ComfyUI queue & online ──
    comfyui = {"online": False, "queue_running": 0, "queue_pending": 0}
    try:
        r = req_lib.get(f"{COMFYUI_URL}/queue", timeout=2)
        if r.ok:
            comfyui["online"] = True
            q = r.json()
            comfyui["queue_running"] = len(q.get("queue_running", []))
            comfyui["queue_pending"] = len(q.get("queue_pending", []))
    except Exception:
        pass

    # Execution state from WS bridge
    bridge = comfyui_bridge.get_bridge()
    if bridge and bridge._exec_info:
        comfyui["executing"] = True
        comfyui["exec_start_time"] = bridge._exec_info.get("start_time")
        if bridge._last_progress:
            comfyui["progress"] = bridge._last_progress
    else:
        comfyui["executing"] = False
    result["comfyui"] = comfyui

    # ── Downloads ──
    downloads = {"active": [], "active_count": 0, "queue_count": 0}
    try:
        from ..services.download_engine import get_engine as _get_dl_engine
        tasks = _get_dl_engine().list_tasks()
        active = [t for t in tasks if t["status"] == "active"]
        queued = [t for t in tasks if t["status"] == "queued"]
        downloads["active"] = active[:3]
        downloads["active_count"] = len(active)
        downloads["queue_count"] = len(queued)
    except Exception:
        pass
    result["downloads"] = downloads

    # ── Sync last log lines ──
    sync_status = {"worker_running": sync_engine.is_worker_running()}
    log_buf = sync_engine.get_sync_log_buffer()
    if log_buf:
        sync_status["last_log_lines"] = list(log_buf)[-5:]
    else:
        sync_status["last_log_lines"] = []
    result["sync"] = sync_status

    return jsonify(result)
