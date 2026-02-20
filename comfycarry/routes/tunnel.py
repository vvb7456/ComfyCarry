"""
ComfyCarry — Tunnel 管理路由

包含:
- /api/tunnel_links  — Cloudflare Tunnel 服务链接
- /api/tunnel_status — Tunnel 状态 & 日志

服务发现逻辑 (v2 — 正向发现):
  1. 查找系统中固定运行的服务进程 (PM2 + Jupyter)
  2. 通过 PID 查找每个服务监听的端口 (ss -tlnp)
  3. 解析 Tunnel 日志获取 端口→域名 映射
  4. 将域名与服务一一对应
"""

import json
import os
import re
import subprocess
import time

from flask import Blueprint, jsonify

bp = Blueprint("tunnel", __name__)

# ── 缓存 ──
_links_cache = None
_links_cache_time = 0
_CACHE_TTL = 60  # 秒

# ── 已知服务定义 ──
# name: UI 显示名, pm2_name: PM2 进程名, icon: 图标, default_port: 默认端口
KNOWN_SERVICES = [
    {"name": "ComfyCarry",  "pm2_name": "dashboard", "icon": "📊", "default_port": 5000},
    {"name": "ComfyUI",     "pm2_name": "comfy",     "icon": "🎨", "default_port": 8188},
    {"name": "JupyterLab",  "pm2_name": None,        "icon": "📓", "default_port": None},
]


# ═══════════════════════════════════════════════════════════════
# API 端点
# ═══════════════════════════════════════════════════════════════

@bp.route("/api/tunnel_links")
def api_tunnel_links():
    """获取 Cloudflare Tunnel 代理的服务链接"""
    global _links_cache, _links_cache_time

    now = time.time()
    if _links_cache is not None and (now - _links_cache_time) < _CACHE_TTL:
        return jsonify({"links": _links_cache})

    links = _discover_service_links()
    _links_cache = links
    _links_cache_time = now

    return jsonify({"links": links})


@bp.route("/api/tunnel_status")
def api_tunnel_status():
    """获取 Tunnel 状态和日志"""
    status = "unknown"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout):
                if p.get("name") == "tunnel":
                    status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    logs = _get_tunnel_logs()
    links = _discover_service_links()

    return jsonify({"status": status, "logs": logs, "links": links})


# ═══════════════════════════════════════════════════════════════
# 核心: 正向服务发现
# ═══════════════════════════════════════════════════════════════

def _discover_service_links():
    """
    正向发现服务并匹配 Tunnel 域名:
    1. 查 PM2 进程列表 → 获取 PID + 启动参数
    2. 用 ss 查 PID 对应监听端口 (参数作为回退)
    3. 从 Tunnel 日志提取 端口→域名 映射
    4. 匹配服务与域名, 组装链接
    """

    # Step 1+2: 发现服务及其端口
    services = _discover_running_services()
    # services: [{name, icon, port, status, pid}, ...]

    # Step 3: 解析 tunnel 端口→域名映射
    port_to_domain = _parse_tunnel_port_domain_map()

    # Step 4: 匹配
    jupyter_token = _get_jupyter_token()
    links = []
    matched_ports = set()

    for svc in services:
        port = svc.get("port")
        port_str = str(port) if port else ""
        domain = port_to_domain.get(port_str) if port_str else None
        url = f"https://{domain}" if domain else None

        # Jupyter 附加 token
        if svc["name"] == "JupyterLab" and url and jupyter_token:
            url += f"/?token={jupyter_token}"

        links.append({
            "name": svc["name"],
            "icon": svc["icon"],
            "port": port_str,
            "status": svc.get("status", "unknown"),
            "url": url,
            "service": f"http://localhost:{port_str}" if port_str else "",
        })
        if port_str:
            matched_ports.add(port_str)

    # 附加: Tunnel 中有但不在已知服务里的端口 (SSH 等)
    for port_str, domain in port_to_domain.items():
        if port_str not in matched_ports:
            # 跳过 SSH 类型 (没有 HTTP 前端)
            links.append({
                "name": domain.split(".")[0].replace("-", " ").title(),
                "icon": "🌐",
                "port": port_str,
                "status": "unknown",
                "url": f"https://{domain}",
                "service": f"http://localhost:{port_str}",
            })

    # 环境变量覆盖 (兼容旧方式)
    _apply_env_overrides(links)

    return links


def _discover_running_services():
    """查找已知服务进程, 确定其 PID 和监听端口"""
    results = []
    pm2_procs = _get_pm2_procs()  # {name: {pid, status, args}}

    for svc_def in KNOWN_SERVICES:
        svc_name = svc_def["name"]
        pm2_name = svc_def["pm2_name"]
        icon = svc_def["icon"]
        default_port = svc_def["default_port"]

        if svc_name == "JupyterLab":
            # Jupyter 有独立的发现逻辑
            jupyter = _discover_jupyter()
            if jupyter:
                results.append({
                    "name": svc_name, "icon": icon,
                    "port": jupyter["port"],
                    "status": "online",
                    "pid": jupyter.get("pid"),
                })
            # Jupyter 未运行时不添加 (不像其他服务那样有固定 PM2 进程)
            continue

        pm2_info = pm2_procs.get(pm2_name)
        if not pm2_info:
            # PM2 里没有此进程
            results.append({
                "name": svc_name, "icon": icon,
                "port": default_port,
                "status": "stopped",
                "pid": None,
            })
            continue

        pid = pm2_info["pid"]
        status = pm2_info["status"]
        args = pm2_info.get("args", [])

        # 确定端口: ss(PID) → 启动参数 → 默认值
        port = None
        if pid and status == "online":
            port = _find_listening_port(pid)
        if not port:
            port = _extract_port_from_args(args)
        if not port:
            port = default_port

        results.append({
            "name": svc_name, "icon": icon,
            "port": port, "status": status, "pid": pid,
        })

    return results


# ═══════════════════════════════════════════════════════════════
# 进程 & 端口发现工具
# ═══════════════════════════════════════════════════════════════

def _get_pm2_procs():
    """获取 PM2 进程列表, 返回 {name: {pid, status, args}}"""
    result = {}
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout):
                name = p.get("name", "")
                env = p.get("pm2_env", {})
                result[name] = {
                    "pid": p.get("pid", 0),
                    "status": env.get("status", "unknown"),
                    "args": env.get("args", []),
                }
    except Exception:
        pass
    return result


def _find_listening_port(pid):
    """通过 ss 查找进程 PID 监听的 TCP 端口"""
    if not pid:
        return None
    try:
        # ss -tlnp: 列出所有 TCP LISTEN socket 及其进程
        r = subprocess.run(
            f"ss -tlnp 2>/dev/null | grep 'pid={pid},'",
            shell=True, capture_output=True, text=True, timeout=5
        )
        if r.stdout.strip():
            # 格式: LISTEN 0 128 0.0.0.0:5000 0.0.0.0:*
            # 或:   LISTEN 0 128 *:8188 *:*
            for line in r.stdout.strip().split("\n"):
                m = re.search(r'[\s*:](\d{2,5})\s', line)
                if m:
                    port = int(m.group(1))
                    if port > 1023:  # 忽略系统端口
                        return port
    except Exception:
        pass
    return None


def _extract_port_from_args(args):
    """从启动参数中提取 --port 值"""
    if not isinstance(args, list):
        return None
    for i, a in enumerate(args):
        if a == "--port" and i + 1 < len(args):
            try:
                return int(args[i + 1])
            except (ValueError, TypeError):
                pass
    return None


def _discover_jupyter():
    """检测运行中的 JupyterLab/Notebook, 返回 {port, token, pid} 或 None"""
    try:
        r = subprocess.run(
            "jupyter server list 2>&1",
            shell=True, capture_output=True, text=True, timeout=5
        )
        output = r.stdout + r.stderr
        # 格式: http://hostname:8888/?token=abc123 :: /workspace
        m = re.search(r'https?://[^:]+:(\d+)/?\?token=([a-f0-9]+)', output)
        if m:
            port = int(m.group(1))
            token = m.group(2)
            # 尝试获取 PID
            pid = None
            try:
                r2 = subprocess.run(
                    f"ss -tlnp 2>/dev/null | grep ':{port} '",
                    shell=True, capture_output=True, text=True, timeout=3
                )
                pm = re.search(r'pid=(\d+)', r2.stdout)
                if pm:
                    pid = int(pm.group(1))
            except Exception:
                pass
            return {"port": port, "token": token, "pid": pid}
    except Exception:
        pass
    return None


def _get_jupyter_token():
    """获取 Jupyter token (简化版, 供链接拼接用)"""
    try:
        r = subprocess.run("jupyter server list 2>&1", shell=True,
                           capture_output=True, text=True, timeout=5)
        m = re.search(r'\?token=([a-f0-9]+)', r.stdout + r.stderr)
        return m.group(1) if m else ""
    except Exception:
        return ""


# ═══════════════════════════════════════════════════════════════
# Tunnel 日志解析 — 提取 端口→域名 映射
# ═══════════════════════════════════════════════════════════════

def _parse_tunnel_port_domain_map():
    """
    从 cloudflared 日志中解析 ingress 配置, 返回 {port_str: domain}.
    多种策略逐级回退.
    """
    mapping = {}  # port_str → domain
    try:
        r = subprocess.run(
            "pm2 logs tunnel --nostream --lines 5000 2>/dev/null "
            "| grep -i 'config=\\|ingress\\|hostname' | head -50",
            shell=True, capture_output=True, text=True, timeout=10
        )
        log = r.stdout + r.stderr
        if not log.strip():
            return mapping

        # Strategy 1: config="{...}" 中的 escaped JSON (named tunnels)
        cfg_match = re.search(r'config="((?:[^"\\]|\\.)*)"', log)
        if cfg_match:
            raw = cfg_match.group(1).replace('\\"', '"').replace('\\\\', '\\')
            try:
                cfg = json.loads(raw)
                ingress = cfg.get("ingress", [])
                _ingress_to_port_map(ingress, mapping)
            except (json.JSONDecodeError, ValueError):
                pass

        # Strategy 2: 日志中直接出现 "ingress": [...]
        if not mapping:
            ing_match = re.search(r'"ingress"\s*:\s*\[', log)
            if ing_match:
                start = ing_match.start()
                brace_start = log.index('[', start)
                depth = 0
                end = brace_start
                for i in range(brace_start, min(brace_start + 5000, len(log))):
                    if log[i] == '[':
                        depth += 1
                    elif log[i] == ']':
                        depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
                try:
                    ingress = json.loads(log[brace_start:end])
                    _ingress_to_port_map(ingress, mapping)
                except (json.JSONDecodeError, ValueError):
                    pass

        # Strategy 3: hostname=xxx 日志行 (无法确定端口, 跳过)
        # 这种情况下无法可靠地确定端口→域名关系, 不做猜测

        # Strategy 4: trycloudflare quick tunnel (无法确定端口, 跳过)

    except Exception:
        pass
    return mapping


def _ingress_to_port_map(ingress, mapping):
    """从 ingress 数组提取 port→domain 映射"""
    for entry in ingress:
        hostname = entry.get("hostname", "")
        service = entry.get("service", "")
        if not hostname or "http_status:" in service:
            continue
        # 跳过 SSH
        if service.startswith("ssh://"):
            continue
        port_match = re.search(r':(\d+)', service)
        if port_match:
            mapping[port_match.group(1)] = hostname


# ═══════════════════════════════════════════════════════════════
# 环境变量覆盖 & 日志
# ═══════════════════════════════════════════════════════════════

def _apply_env_overrides(links):
    """环境变量覆盖 URL (兼容旧部署方式)"""
    tunnel_url = os.environ.get("CF_TUNNEL_URL", os.environ.get("TUNNEL_URL", ""))
    jupyter_url = os.environ.get("JUPYTER_URL", "")
    vast_proxy = os.environ.get("VAST_PROXY_URL", "")

    if tunnel_url:
        # 覆盖 ComfyUI 的 URL
        for l in links:
            if l["name"] == "ComfyUI":
                l["url"] = tunnel_url.rstrip("/")
                break

    if jupyter_url:
        for l in links:
            if l["name"] == "JupyterLab":
                l["url"] = jupyter_url
                break

    if vast_proxy:
        links.append({"name": "Vast.ai Proxy", "url": vast_proxy,
                       "icon": "☁️", "port": "", "status": "online", "service": ""})


def _get_tunnel_logs():
    """获取 Tunnel 清洗后的日志"""
    try:
        r = subprocess.run(
            "pm2 logs tunnel --nostream --lines 100 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw_logs = r.stdout + r.stderr
        ansi_re = re.compile(r'\x1b\[[0-9;]*m')
        logs = ansi_re.sub('', raw_logs)
        logs = re.sub(r'^\d+\|[^|]+\|\s*', '', logs, flags=re.MULTILINE)
        return '\n'.join(
            l for l in logs.split('\n')
            if not l.startswith('[TAILING]')
            and 'last 100 lines' not in l
            and '/root/.pm2/logs/' not in l
        )
    except Exception:
        return ""
