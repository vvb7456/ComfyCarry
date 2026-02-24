"""
ComfyCarry — Jupyter 管理路由

- /api/jupyter/status   — 状态概览 (进程、版本、kernels、sessions)
- /api/jupyter/kernels  — 内核列表
- /api/jupyter/sessions — 活跃会话
- /api/jupyter/terminals — 终端列表
- /api/jupyter/kernelspecs — 可用内核规格
- /api/jupyter/logs     — Jupyter 日志
- /api/jupyter/restart  — 重启 Jupyter 进程
"""

import json
import os
import re
import subprocess

import requests
import urllib3

from flask import Blueprint, jsonify, request

# 抑制自签证书警告 (Jupyter 在 vast.ai 上使用自签 HTTPS)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint("jupyter", __name__)

# ── 配置 ──────────────────────────────────────────────────────

JUPYTER_PORT = int(os.environ.get("JUPYTER_PORT", "8080"))
JUPYTER_TOKEN = os.environ.get("JUPYTER_TOKEN", "")
JUPYTER_URL = os.environ.get("JUPYTER_URL_INTERNAL",
                             f"https://localhost:{JUPYTER_PORT}")


def _jupyter_headers():
    """构建 Jupyter API 请求头"""
    token = JUPYTER_TOKEN or _detect_token()
    return {"Authorization": f"token {token}"} if token else {}


_cached_token = None


def _detect_token():
    """从 Jupyter 进程命令行自动检测 token"""
    global _cached_token
    if _cached_token:
        return _cached_token
    try:
        out = subprocess.run(
            "ps aux | grep jupyter",
            shell=True, capture_output=True, text=True, timeout=3
        ).stdout
        # Pattern: --LabApp.token=... or --ServerApp.token=...
        m = re.search(r'(?:Lab|Server|Notebook)App\.token[=\s]+([a-f0-9]{30,})', out)
        if m:
            _cached_token = m.group(1)
            return _cached_token
    except Exception:
        pass
    return ""


def _jupyter_get(path, timeout=5):
    """发送 GET 请求到 Jupyter REST API"""
    url = f"{JUPYTER_URL}{path}"
    return requests.get(url, headers=_jupyter_headers(),
                        verify=False, timeout=timeout)


def _get_jupyter_pid():
    """获取 Jupyter 主进程 PID 和命令行"""
    try:
        out = subprocess.run(
            "ps aux | grep '[j]upyter-lab\\|[j]upyter-notebook' | head -1",
            shell=True, capture_output=True, text=True, timeout=3
        ).stdout.strip()
        if out:
            parts = out.split()
            pid = int(parts[1])
            # Get memory usage from /proc
            mem = 0
            try:
                with open(f"/proc/{pid}/status") as f:
                    for line in f:
                        if line.startswith("VmRSS:"):
                            mem = int(line.split()[1]) * 1024  # KB → bytes
                            break
            except Exception:
                pass
            # Get CPU from ps
            cpu = float(parts[2]) if len(parts) > 2 else 0
            return {"pid": pid, "cpu": cpu, "memory": mem}
    except Exception:
        pass
    return None


# ── API 端点 ──────────────────────────────────────────────────

@bp.route("/api/jupyter/status")
def jupyter_status():
    """Jupyter 状态概览"""
    result = {
        "online": False,
        "version": "",
        "pid": None,
        "cpu": 0,
        "memory": 0,
        "port": JUPYTER_PORT,
        "kernels_count": 0,
        "sessions_count": 0,
        "terminals_count": 0,
        "kernelspecs": [],
    }

    # 进程信息
    proc = _get_jupyter_pid()
    if proc:
        result["pid"] = proc["pid"]
        result["cpu"] = proc["cpu"]
        result["memory"] = proc["memory"]

    # API 健康检查 + 版本
    try:
        r = _jupyter_get("/api")
        if r.ok:
            result["online"] = True
            d = r.json()
            result["version"] = d.get("version", "")
    except Exception:
        pass

    if not result["online"]:
        return jsonify(result)

    # Kernels
    try:
        r = _jupyter_get("/api/kernels")
        if r.ok:
            kernels = r.json()
            result["kernels_count"] = len(kernels)
            result["kernels"] = [{
                "id": k.get("id"),
                "name": k.get("name"),
                "state": k.get("execution_state", "unknown"),
                "last_activity": k.get("last_activity"),
                "connections": k.get("connections", 0),
            } for k in kernels]
    except Exception:
        pass

    # Sessions
    try:
        r = _jupyter_get("/api/sessions")
        if r.ok:
            sessions = r.json()
            result["sessions_count"] = len(sessions)
            result["sessions"] = [{
                "id": s.get("id"),
                "name": s.get("name"),
                "path": s.get("path"),
                "type": s.get("type"),
                "kernel_name": s.get("kernel", {}).get("name"),
                "kernel_state": s.get("kernel", {}).get("execution_state"),
                "kernel_id": s.get("kernel", {}).get("id"),
            } for s in sessions]
    except Exception:
        pass

    # Terminals
    try:
        r = _jupyter_get("/api/terminals")
        if r.ok:
            terminals = r.json()
            result["terminals_count"] = len(terminals)
            result["terminals"] = [{
                "name": t.get("name"),
                "last_activity": t.get("last_activity"),
            } for t in terminals]
    except Exception:
        pass

    # Kernel specs
    try:
        r = _jupyter_get("/api/kernelspecs")
        if r.ok:
            specs = r.json()
            result["default_kernel"] = specs.get("default", "")
            result["kernelspecs"] = [
                {"name": name, "display_name": info.get("spec", {}).get("display_name", name)}
                for name, info in specs.get("kernelspecs", {}).items()
            ]
    except Exception:
        pass

    return jsonify(result)


@bp.route("/api/jupyter/kernels")
def jupyter_kernels():
    """获取活跃内核列表"""
    try:
        r = _jupyter_get("/api/kernels")
        if r.ok:
            return jsonify(r.json())
        return jsonify([])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/sessions")
def jupyter_sessions():
    """获取活跃会话列表"""
    try:
        r = _jupyter_get("/api/sessions")
        if r.ok:
            return jsonify(r.json())
        return jsonify([])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/terminals")
def jupyter_terminals():
    """获取终端列表"""
    try:
        r = _jupyter_get("/api/terminals")
        if r.ok:
            return jsonify(r.json())
        return jsonify([])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/terminals/new", methods=["POST"])
def jupyter_new_terminal():
    """创建新终端"""
    try:
        url = f"{JUPYTER_URL}/api/terminals"
        r = requests.post(url, headers=_jupyter_headers(),
                          verify=False, timeout=5)
        if r.ok:
            return jsonify(r.json())
        return jsonify({"error": "Failed to create terminal"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/kernels/<kernel_id>/<action>", methods=["POST"])
def jupyter_kernel_action(kernel_id, action):
    """内核操作: restart, interrupt"""
    if action not in ("restart", "interrupt"):
        return jsonify({"error": "Invalid action"}), 400
    try:
        url = f"{JUPYTER_URL}/api/kernels/{kernel_id}/{action}"
        r = requests.post(url, headers=_jupyter_headers(),
                          verify=False, timeout=10)
        if r.ok:
            return jsonify({"ok": True})
        return jsonify({"error": f"Kernel {action} failed"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/sessions/<session_id>", methods=["DELETE"])
def jupyter_delete_session(session_id):
    """关闭会话 (同时关闭内核)"""
    try:
        url = f"{JUPYTER_URL}/api/sessions/{session_id}"
        r = requests.delete(url, headers=_jupyter_headers(),
                            verify=False, timeout=5)
        if r.ok or r.status_code == 204:
            return jsonify({"ok": True})
        return jsonify({"error": "Delete session failed"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/logs")
def jupyter_logs():
    """获取 Jupyter 日志"""
    lines = min(int(request.args.get("lines", "200")), 2000)
    log_path = "/var/log/jupyter.log"
    try:
        if os.path.exists(log_path):
            out = subprocess.run(
                f"tail -n {lines} {log_path}",
                shell=True, capture_output=True, text=True, timeout=3
            ).stdout
            return jsonify({"logs": out})
        return jsonify({"logs": "(日志文件不存在)"})
    except Exception as e:
        return jsonify({"logs": "", "error": str(e)})


@bp.route("/api/jupyter/restart", methods=["POST"])
def jupyter_restart():
    """重启 Jupyter 进程 (杀掉进程, vast.ai 会自动重启)"""
    proc = _get_jupyter_pid()
    if not proc:
        return jsonify({"error": "未找到 Jupyter 进程"}), 404
    try:
        os.kill(proc["pid"], 15)  # SIGTERM
        return jsonify({"ok": True, "message": "Jupyter 正在重启..."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/url")
def jupyter_url():
    """获取 Jupyter 外部访问 URL"""
    # 尝试从 tunnel v2 API 获取
    try:
        from . import tunnel as tunnel_mod
        resp = tunnel_mod.api_tunnel_status_v2()
        data = resp.get_json() if hasattr(resp, 'get_json') else {}
        urls = data.get("urls", {})
        for name, url in urls.items():
            if "jupyter" in name.lower():
                # 拼接 token 参数
                token = JUPYTER_TOKEN or _detect_token()
                if token:
                    url = f"{url}?token={token}"
                return jsonify({"url": url, "source": "tunnel"})
    except Exception:
        pass
    # 回退到环境变量
    url = os.environ.get("JUPYTER_URL", "")
    if url:
        return jsonify({"url": url, "source": "env"})
    return jsonify({"url": f"https://localhost:{JUPYTER_PORT}",
                    "source": "localhost", "note": "仅限本地访问"})


@bp.route("/api/jupyter/token")
def jupyter_token():
    """获取 Jupyter 访问令牌"""
    token = JUPYTER_TOKEN or _detect_token()
    if token:
        return jsonify({"token": token})
    return jsonify({"token": "", "error": "未找到令牌"})
