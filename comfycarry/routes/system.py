"""
ComfyCarry — 系统监控 & 服务管理路由

包含:
- /api/version    — 版本信息
- /api/system     — CPU/GPU/内存/磁盘/网络监控
- /api/services   — PM2 服务列表
- /api/services/<name>/<action> — 服务控制 (start/stop/restart)
- /api/logs/<name> — PM2 日志查看
"""

import json
import os
import re
import subprocess

from flask import Blueprint, jsonify, request

from ..config import SCRIPT_DIR
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
# 系统监控 API
# ====================================================================
@bp.route("/api/system")
def api_system():
    """获取系统信息"""
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
# 服务管理 API (PM2)
# ====================================================================
@bp.route("/api/services")
def api_services():
    """获取 PM2 服务列表"""
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
