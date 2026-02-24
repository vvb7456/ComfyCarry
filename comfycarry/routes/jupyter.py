"""
ComfyCarry — Jupyter 管理路由

通过 PM2 管理 JupyterLab 进程 (进程名: jupyter)

- /api/jupyter/status   — 状态概览 (进程、版本、kernels、sessions)
- /api/jupyter/start    — 启动 JupyterLab
- /api/jupyter/stop     — 停止 JupyterLab
- /api/jupyter/restart  — 重启 JupyterLab
- /api/jupyter/kernelspecs — 可用内核规格 (kernels/sessions/terminals 已合入 status)
- /api/jupyter/logs     — Jupyter 日志
- /api/jupyter/logs/stream — SSE 实时日志流
- /api/jupyter/token    — 访问令牌
"""

import json
import os
import re
import subprocess

import requests
import urllib3

from flask import Blueprint, Response, jsonify, request

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

bp = Blueprint("jupyter", __name__)

# PM2 进程名
PM2_NAME = "jupyter"


# ── 动态检测 ─────────────────────────────────────────────────

def _detect_port() -> int | None:
    """从运行中的 Jupyter 进程命令行检测端口"""
    try:
        out = subprocess.run(
            "ps aux | grep '[j]upyter-lab\\|[j]upyter-notebook'",
            shell=True, capture_output=True, text=True, timeout=3
        ).stdout
        m = re.search(r'--port[=\s]+(\d+)', out)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return None


_cached_token = None


def _detect_token() -> str:
    """从 jupyter server list 获取 token"""
    global _cached_token
    if _cached_token:
        return _cached_token
    try:
        r = subprocess.run(
            "jupyter server list --json 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        for line in r.stdout.strip().splitlines():
            try:
                info = json.loads(line)
                token = info.get("token", "")
                if token:
                    _cached_token = token
                    return _cached_token
            except json.JSONDecodeError:
                continue
    except Exception:
        pass
    # 回退: 从进程命令行检测
    try:
        out = subprocess.run(
            "ps aux | grep jupyter",
            shell=True, capture_output=True, text=True, timeout=3
        ).stdout
        m = re.search(
            r'(?:IdentityProvider|Lab|Server|Notebook)(?:App)?\.token[=\s]+([a-f0-9]{30,})',
            out
        )
        if m:
            _cached_token = m.group(1)
            return _cached_token
    except Exception:
        pass
    return ""


def _jupyter_url() -> str | None:
    """构建 Jupyter 内部访问 URL (动态检测端口)"""
    port = _detect_port()
    if not port:
        return None
    return f"http://localhost:{port}"


def _jupyter_headers() -> dict:
    """构建 Jupyter API 请求头"""
    token = _detect_token()
    return {"Authorization": f"token {token}"} if token else {}


def _jupyter_get(path, timeout=5):
    """发送 GET 请求到 Jupyter REST API"""
    url = _jupyter_url()
    if not url:
        return None
    return requests.get(f"{url}{path}", headers=_jupyter_headers(),
                        verify=False, timeout=timeout)


def _get_jupyter_pid():
    """获取 Jupyter 主进程 PID 和资源占用"""
    try:
        out = subprocess.run(
            "ps aux | grep '[j]upyter-lab\\|[j]upyter-notebook' | head -1",
            shell=True, capture_output=True, text=True, timeout=3
        ).stdout.strip()
        if out:
            parts = out.split()
            pid = int(parts[1])
            mem = 0
            try:
                with open(f"/proc/{pid}/status") as f:
                    for line in f:
                        if line.startswith("VmRSS:"):
                            mem = int(line.split()[1]) * 1024
                            break
            except Exception:
                pass
            cpu = float(parts[2]) if len(parts) > 2 else 0
            return {"pid": pid, "cpu": cpu, "memory": mem}
    except Exception:
        pass
    return None


def _pm2_status() -> str:
    """获取 jupyter PM2 进程状态: online / stopped / errored / not_found"""
    try:
        r = subprocess.run(
            "pm2 jlist 2>/dev/null", shell=True,
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            for p in json.loads(r.stdout):
                if p.get("name") == PM2_NAME:
                    return p.get("pm2_env", {}).get("status", "unknown")
    except Exception:
        pass
    return "not_found"

# ── API 端点 ──────────────────────────────────────────────────

@bp.route("/api/jupyter/status")
def jupyter_status():
    """Jupyter 状态概览"""
    port = _detect_port()
    pm2 = _pm2_status()

    result = {
        "online": False,
        "pm2_status": pm2,
        "version": "",
        "pid": None,
        "cpu": 0,
        "memory": 0,
        "port": port,
        "kernels_count": 0,
        "sessions_count": 0,
        "terminals_count": 0,
        "kernelspecs": [],
    }

    proc = _get_jupyter_pid()
    if proc:
        result["pid"] = proc["pid"]
        result["cpu"] = proc["cpu"]
        result["memory"] = proc["memory"]

    # API 健康检查 + 版本
    try:
        r = _jupyter_get("/api")
        if r and r.ok:
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
        if r and r.ok:
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
        if r and r.ok:
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
        if r and r.ok:
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
        if r and r.ok:
            specs = r.json()
            result["default_kernel"] = specs.get("default", "")
            result["kernelspecs"] = [
                {"name": name, "display_name": info.get("spec", {}).get("display_name", name)}
                for name, info in specs.get("kernelspecs", {}).items()
            ]
    except Exception:
        pass

    return jsonify(result)


@bp.route("/api/jupyter/terminals/new", methods=["POST"])
def jupyter_new_terminal():
    """创建新终端"""
    try:
        base = _jupyter_url()
        if not base:
            return jsonify({"error": "JupyterLab 未运行"}), 503
        r = requests.post(f"{base}/api/terminals", headers=_jupyter_headers(),
                          verify=False, timeout=5)
        if r.ok:
            return jsonify(r.json())
        return jsonify({"error": "Failed to create terminal"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/terminals/<name>", methods=["DELETE"])
def jupyter_delete_terminal(name):
    """销毁终端"""
    try:
        base = _jupyter_url()
        if not base:
            return jsonify({"error": "JupyterLab 未运行"}), 503
        r = requests.delete(f"{base}/api/terminals/{name}",
                            headers=_jupyter_headers(), verify=False, timeout=5)
        if r.ok or r.status_code == 204:
            return jsonify({"ok": True})
        return jsonify({"error": "Delete terminal failed"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/kernels/<kernel_id>/<action>", methods=["POST"])
def jupyter_kernel_action(kernel_id, action):
    """内核操作: restart, interrupt"""
    if action not in ("restart", "interrupt"):
        return jsonify({"error": "Invalid action"}), 400
    try:
        base = _jupyter_url()
        if not base:
            return jsonify({"error": "JupyterLab 未运行"}), 503
        r = requests.post(f"{base}/api/kernels/{kernel_id}/{action}",
                          headers=_jupyter_headers(), verify=False, timeout=10)
        if r.ok:
            return jsonify({"ok": True})
        return jsonify({"error": f"Kernel {action} failed"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/sessions/<session_id>", methods=["DELETE"])
def jupyter_delete_session(session_id):
    """关闭会话 (同时关闭内核)"""
    try:
        base = _jupyter_url()
        if not base:
            return jsonify({"error": "JupyterLab 未运行"}), 503
        r = requests.delete(f"{base}/api/sessions/{session_id}",
                            headers=_jupyter_headers(), verify=False, timeout=5)
        if r.ok or r.status_code == 204:
            return jsonify({"ok": True})
        return jsonify({"error": "Delete session failed"}), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/jupyter/logs")
def jupyter_logs():
    """获取 Jupyter 日志 (PM2)"""
    lines = min(int(request.args.get("lines", "200")), 2000)
    try:
        r = subprocess.run(
            f"pm2 logs {PM2_NAME} --nostream --lines {lines} 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw = r.stdout + r.stderr
        # 移除 ANSI 颜色码
        ansi_re = re.compile(r'\x1b\[[0-9;]*m')
        clean = ansi_re.sub('', raw)
        return jsonify({"logs": clean})
    except Exception as e:
        return jsonify({"logs": "", "error": str(e)})


@bp.route("/api/jupyter/logs/stream")
def jupyter_logs_stream():
    """SSE — PM2 Jupyter 日志实时流"""
    def generate():
        proc = None
        try:
            proc = subprocess.Popen(
                ["pm2", "logs", PM2_NAME, "--raw", "--lines", "50"],
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


@bp.route("/api/jupyter/start", methods=["POST"])
def jupyter_start():
    """启动 JupyterLab (PM2)"""
    pm2 = _pm2_status()
    if pm2 == "online":
        return jsonify({"ok": True, "message": "JupyterLab 已在运行"})

    # 清除 token 缓存 (Jupyter 自动生成新 token)
    global _cached_token
    _cached_token = None

    if pm2 == "not_found":
        # 首次启动 — 创建 PM2 进程
        cmd = (
            f'pm2 start jupyter-lab --name {PM2_NAME} '
            f'--interpreter none '
            f'--log /workspace/jupyter.log --time '
            f'-- --ip=0.0.0.0 --port=8888 --no-browser --allow-root '
            f'--ServerApp.root_dir=/workspace '
            f'--ServerApp.language=zh_CN'
        )
    else:
        # 已存在但 stopped/errored — 重启
        cmd = f'pm2 restart {PM2_NAME}'

    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        subprocess.run("pm2 save 2>/dev/null", shell=True)
        if r.returncode == 0:
            return jsonify({"ok": True, "message": "JupyterLab 启动中..."})
        return jsonify({"ok": False, "error": r.stderr or "启动失败"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.route("/api/jupyter/stop", methods=["POST"])
def jupyter_stop():
    """停止 JupyterLab (PM2)"""
    try:
        subprocess.run(f"pm2 stop {PM2_NAME} 2>/dev/null",
                       shell=True, timeout=10)
        global _cached_token
        _cached_token = None
        return jsonify({"ok": True, "message": "JupyterLab 已停止"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.route("/api/jupyter/restart", methods=["POST"])
def jupyter_restart():
    """重启 JupyterLab (PM2)"""
    try:
        r = subprocess.run(f"pm2 restart {PM2_NAME} 2>/dev/null",
                           shell=True, capture_output=True, text=True, timeout=10)
        global _cached_token
        _cached_token = None
        if r.returncode == 0:
            return jsonify({"ok": True, "message": "JupyterLab 正在重启..."})
        return jsonify({"ok": False, "error": "重启失败 (进程可能不存在)"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.route("/api/jupyter/token")
def jupyter_token_endpoint():
    """获取 Jupyter 访问令牌"""
    token = _detect_token()
    if token:
        return jsonify({"token": token})
    return jsonify({"token": "", "error": "未找到令牌"})
