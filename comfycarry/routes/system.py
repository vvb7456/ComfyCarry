"""
ComfyCarry — 系统监控 & 服务管理路由

包含:
- /api/version    — 版本信息
- (internal)      — system() / services() → 由 /api/overview 聚合
- /api/services/<name>/<action> — 服务控制 (start/stop/restart)
- /api/logs/<name> — PM2 日志查看
"""

import json
import os
import re
import subprocess
import time

from flask import Blueprint, jsonify, request, Response

import requests as req_lib

from ..config import SCRIPT_DIR, COMFYUI_URL
from ..utils import _run_cmd

bp = Blueprint("system", __name__)


# ====================================================================
# 版本信息 API
# ====================================================================
@bp.route("/api/version")
def api_version():
    """返回当前部署版本信息"""
    version_info = {"version": "v2.4", "branch": "main", "commit": ""}
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
# 系统监控 (内部函数, 由 api_overview 聚合调用)
# ====================================================================
def api_system():
    """获取系统信息 (仅供 api_overview 内部调用)"""
    info = {"cpu": {}, "memory": {}, "disk": {}, "gpu": [], "network": {}, "uptime": ""}

    # CPU
    try:
        import psutil
        info["cpu"]["percent"] = psutil.cpu_percent(interval=0.5)
        info["cpu"]["cores"] = psutil.cpu_count()
        info["cpu"]["freq"] = psutil.cpu_freq()._asdict() if psutil.cpu_freq() else {}
        load = os.getloadavg()
        info["cpu"]["load"] = {"1m": load[0], "5m": load[1], "15m": load[2]}
    except Exception as e:
        info["cpu"]["error"] = str(e)

    # Memory
    try:
        import psutil
        mem = psutil.virtual_memory()
        info["memory"] = {
            "total": mem.total, "used": mem.used, "available": mem.available,
            "percent": mem.percent
        }
    except Exception as e:
        info["memory"]["error"] = str(e)

    # Disk
    try:
        import psutil
        disk = psutil.disk_usage("/workspace" if os.path.exists("/workspace") else "/")
        info["disk"] = {
            "total": disk.total, "used": disk.used, "free": disk.free,
            "percent": disk.percent, "path": "/workspace"
        }
    except Exception as e:
        info["disk"]["error"] = str(e)

    # GPU (nvidia-smi)
    try:
        gpu_out = _run_cmd(
            "nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,"
            "utilization.gpu,temperature.gpu,power.draw,power.limit "
            "--format=csv,nounits,noheader", timeout=5
        )
        for line in gpu_out.strip().split("\n"):
            if not line.strip():
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 9:
                info["gpu"].append({
                    "index": int(parts[0]), "name": parts[1],
                    "mem_total": int(parts[2]), "mem_used": int(parts[3]),
                    "mem_free": int(parts[4]), "util": int(parts[5]),
                    "temp": int(parts[6]),
                    "power": float(parts[7]) if parts[7] != "[N/A]" else 0,
                    "power_limit": float(parts[8]) if parts[8] != "[N/A]" else 0,
                })
    except Exception:
        pass

    # Network
    try:
        import psutil
        net = psutil.net_io_counters()
        info["network"] = {
            "bytes_sent": net.bytes_sent, "bytes_recv": net.bytes_recv,
            "packets_sent": net.packets_sent, "packets_recv": net.packets_recv,
        }
    except Exception:
        pass

    # Uptime
    try:
        info["uptime"] = _run_cmd("uptime -p", timeout=3)
    except Exception:
        pass

    return jsonify(info)


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
        return jsonify({"error": "Invalid action"}), 400
    if not re.match(r'^[\w\-]+$', name):
        return jsonify({"error": "Invalid service name"}), 400
    out = _run_cmd(f"pm2 {action} {name}", timeout=10)
    return jsonify({"ok": True, "output": out})


# ====================================================================
# 日志 API
# ====================================================================
@bp.route("/api/logs/<name>")
def api_logs(name):
    """获取 PM2 日志"""
    if not re.match(r'^[\w\-]+$', name):
        return jsonify({"logs": "", "error": "Invalid service name"}), 400
    try:
        lines = int(request.args.get("lines", "100"))
        lines = min(max(lines, 1), 1000)
    except (ValueError, TypeError):
        lines = 100
    try:
        out = _run_cmd(f"pm2 logs {name} --nostream --lines {lines}", timeout=5)
        return jsonify({"logs": out})
    except Exception as e:
        return jsonify({"logs": "", "error": str(e)})


@bp.route("/api/logs/<name>/stream")
def api_logs_stream(name):
    """SSE — PM2 实时日志流"""
    if not re.match(r'^[\w\-]+$', name):
        return jsonify({"error": "Invalid service name"}), 400

    def generate():
        proc = None
        try:
            proc = subprocess.Popen(
                ["pm2", "logs", name, "--raw", "--lines", "0"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1
            )
            for line in iter(proc.stdout.readline, ''):
                if not line:
                    break
                line = line.rstrip('\n')
                if not line:
                    continue
                lvl = "info"
                if re.search(r'error|exception|traceback', line, re.I):
                    lvl = "error"
                elif re.search(r'warn', line, re.I):
                    lvl = "warn"
                yield f"data: {json.dumps({'line': line, 'level': lvl}, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            pass
        finally:
            if proc:
                try:
                    proc.kill()
                    proc.stdout.close()
                    proc.wait(timeout=5)
                except Exception:
                    pass

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


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
    try:
        r = req_lib.get(f"{COMFYUI_URL}/system_stats", timeout=3)
        if r.ok:
            d = r.json()
            comfyui["online"] = True
            sys_info = d.get("system", {})
            comfyui["version"] = sys_info.get("comfyui_version", "")
            comfyui["pytorch_version"] = sys_info.get("pytorch_version", "")
            comfyui["python_version"] = sys_info.get("python_version", "")
            devs = d.get("devices", [])
            if devs:
                comfyui["devices"] = devs
    except Exception:
        pass
    try:
        r = req_lib.get(f"{COMFYUI_URL}/queue", timeout=3)
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

    # PM2 status for comfy process
    for svc in result.get("services", {}).get("services", []):
        if svc.get("name") == "comfy":
            comfyui["pm2_status"] = svc.get("status")
            comfyui["pm2_uptime"] = svc.get("uptime")
            comfyui["pm2_restarts"] = svc.get("restarts", 0)
            break

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

    # ── Tunnel (v2 — 使用新 API) ──
    tunnel_info = {"running": False, "urls": {}}
    try:
        resp = tunnel_mod.api_tunnel_status_v2()
        tunnel_data = resp.get_json() if hasattr(resp, 'get_json') else json.loads(resp.get_data())
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
    downloads = {"active": [], "queue_count": 0}
    try:
        from . import models as models_mod
        dl_resp = models_mod.api_download_status()
        dl_data = dl_resp.get_json() if hasattr(dl_resp, 'get_json') else json.loads(dl_resp.get_data())
        active = dl_data.get("active", [])
        queued = dl_data.get("queue", [])
        downloads["active"] = active[:3]  # Limit for overview
        downloads["active_count"] = len(active)
        downloads["queue_count"] = len(queued)
    except Exception:
        pass
    result["downloads"] = downloads

    # ── Dashboard 版本 ──
    ver_resp = api_version()
    result["version"] = ver_resp.get_json() if hasattr(ver_resp, 'get_json') else json.loads(ver_resp.get_data())

    return jsonify(result)
