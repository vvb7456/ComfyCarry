"""
ComfyCarry — Tunnel 管理路由

包含:
- /api/tunnel_links  — Cloudflare Tunnel 服务链接
- /api/tunnel_status — Tunnel 状态 & 日志
"""

import json
import os
import re
import subprocess

from flask import Blueprint, jsonify

bp = Blueprint("tunnel", __name__)


@bp.route("/api/tunnel_links")
def api_tunnel_links():
    """获取 Cloudflare Tunnel 代理的服务链接"""
    links = []
    # 尝试从环境变量获取
    tunnel_url = os.environ.get("CF_TUNNEL_URL", os.environ.get("TUNNEL_URL", ""))
    if tunnel_url:
        links.append({"name": "ComfyUI", "url": tunnel_url.rstrip("/"), "icon": "🎨"})
    jupyter_url = os.environ.get("JUPYTER_URL", "")
    if jupyter_url:
        links.append({"name": "Jupyter", "url": jupyter_url, "icon": "📓"})

    if not links:
        links = _parse_tunnel_ingress()

    vast_proxy = os.environ.get("VAST_PROXY_URL", "")
    if vast_proxy:
        links.append({"name": "Vast.ai Proxy", "url": vast_proxy, "icon": "☁️"})

    return jsonify({"links": links})


def _parse_tunnel_ingress():
    """从 PM2 tunnel 日志中解析 Cloudflare Tunnel ingress 配置"""
    links = []
    try:
        r = subprocess.run(
            "pm2 logs tunnel --nostream --lines 300 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        log = r.stdout + r.stderr

        # Strategy 1: Parse config="{...}" with escaped JSON (named tunnels)
        cfg_match = re.search(r'config="((?:[^"\\]|\\.)*)"', log)
        if cfg_match:
            raw = cfg_match.group(1).replace('\\"', '"').replace('\\\\', '\\')
            try:
                cfg = json.loads(raw)
                ingress = cfg.get("ingress", [])
                _tunnel_ingress_to_links(ingress, links)
            except (json.JSONDecodeError, ValueError):
                pass

        # Strategy 2: Look for "ingress" JSON array directly in logs
        if not links:
            ing_match = re.search(r'"ingress"\s*:\s*\[', log)
            if ing_match:
                start = ing_match.start()
                brace_start = log.index('[', start)
                depth = 0
                end = brace_start
                for i in range(brace_start, min(brace_start + 5000, len(log))):
                    if log[i] == '[': depth += 1
                    elif log[i] == ']': depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
                try:
                    ingress = json.loads(log[brace_start:end])
                    _tunnel_ingress_to_links(ingress, links)
                except (json.JSONDecodeError, ValueError):
                    pass

        # Strategy 3: Find hostname→URL mappings
        if not links:
            hostnames = re.findall(r'hostname[=:]\s*([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', log)
            for h in set(hostnames):
                if 'cloudflare' not in h:
                    links.append({"name": h.split(".")[0].replace("-", " ").title(),
                                  "url": f"https://{h}", "icon": "🌐"})

        # Strategy 4: Fallback — trycloudflare quick tunnel URLs
        if not links:
            urls = list(set(re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com', log)))
            for i, u in enumerate(urls):
                links.append({"name": f"Service #{i+1}", "url": u, "icon": "🌐"})
    except Exception:
        pass
    return links


def _tunnel_ingress_to_links(ingress, links):
    """将 Cloudflare Tunnel ingress 列表转换为服务链接"""
    port_services = _detect_port_services()
    jupyter_token = _get_jupyter_token()
    for entry in ingress:
        hostname = entry.get("hostname", "")
        service = entry.get("service", "")
        if not hostname or "http_status:" in service:
            continue
        port_match = re.search(r':(\d+)', service)
        port = port_match.group(1) if port_match else ""
        proto = "ssh" if service.startswith("ssh://") else "http"
        if proto == "ssh":
            continue
        svc_name = port_services.get(port, "")
        if not svc_name:
            svc_name = hostname.split(".")[0].replace("-", " ").title()
        icon = {"comfyui": "🎨", "jupyter": "📓", "dashboard": "📊"}.get(svc_name.lower(), "🌐")
        url = f"https://{hostname}"
        if svc_name.lower() == "jupyter" and jupyter_token:
            url += f"/?token={jupyter_token}"
        links.append({
            "name": svc_name, "url": url,
            "icon": icon, "port": port, "service": service
        })


def _get_jupyter_token():
    """从 jupyter server list 获取运行中的 Jupyter token"""
    try:
        r = subprocess.run(
            "jupyter server list 2>&1",
            shell=True, capture_output=True, text=True, timeout=5
        )
        output = r.stdout + r.stderr
        match = re.search(r'https?://[^?]+\?token=([a-f0-9]+)', output)
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


def _detect_port_services():
    """检测本机端口对应的服务名称"""
    mapping = {}
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            procs = json.loads(r.stdout)
            for p in procs:
                name = p.get("name", "")
                args = p.get("pm2_env", {}).get("args", [])
                if isinstance(args, list):
                    for i, a in enumerate(args):
                        if a == "--port" and i + 1 < len(args):
                            mapping[str(args[i + 1])] = name.title()
    except Exception:
        pass
    mapping["8188"] = "ComfyUI"
    mapping["5000"] = "Dashboard"
    mapping["8080"] = "Jupyter"
    mapping["8888"] = "Jupyter"
    return mapping


@bp.route("/api/tunnel_status")
def api_tunnel_status():
    """获取 Tunnel 状态和日志"""
    status = "unknown"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            procs = json.loads(r.stdout)
            for p in procs:
                if p.get("name") == "tunnel":
                    status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    try:
        r = subprocess.run(
            "pm2 logs tunnel --nostream --lines 100 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw_logs = r.stdout + r.stderr
        ansi_re = re.compile(r'\x1b\[[0-9;]*m')
        logs = ansi_re.sub('', raw_logs)
        logs = re.sub(r'^\d+\|[^|]+\|\s*', '', logs, flags=re.MULTILINE)
        logs = '\n'.join(l for l in logs.split('\n')
                        if not l.startswith('[TAILING]') and 'last 100 lines' not in l and '/root/.pm2/logs/' not in l)
    except Exception:
        logs = ""

    links = _parse_tunnel_ingress()

    return jsonify({"status": status, "logs": logs, "links": links})
