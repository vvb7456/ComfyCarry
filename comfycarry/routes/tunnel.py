"""ComfyCarry — Tunnel (v2)

Cloudflare Tunnel 管理路由。通过 CF API 自动配置, 不再解析日志。
"""

import json
import re
import subprocess

from flask import Blueprint, jsonify, request

from ..config import get_config, set_config

bp = Blueprint("tunnel", __name__)


def _get_manager():
    """从 config 构造 TunnelManager (如果已配置)"""
    from ..services.tunnel_manager import TunnelManager
    token = get_config("cf_api_token", "")
    domain = get_config("cf_domain", "")
    if not token or not domain:
        return None
    subdomain = get_config("cf_subdomain", "")
    return TunnelManager(token, domain, subdomain)


# ═══════════════════════════════════════════════════════════════
# 新 API 端点 (v2)
# ═══════════════════════════════════════════════════════════════

@bp.route("/api/tunnel/status")
def api_tunnel_status_v2():
    """
    Tunnel 综合状态 — 替代旧的 /api/tunnel_status + /api/tunnel_links

    Response: {
        "configured": bool,
        "domain": "mydomain.com",
        "subdomain": "my-workspace",
        "tunnel": { "exists": bool, "tunnel_id": "...", "status": "...", "connections": [...] },
        "urls": { "ComfyCarry": "https://...", ... },
        "cloudflared": "online" | "stopped" | "unknown",
        "logs": "..."
    }
    """
    result = {
        "configured": False,
        "domain": get_config("cf_domain", ""),
        "subdomain": get_config("cf_subdomain", ""),
        "tunnel": {"exists": False, "status": "inactive"},
        "urls": {},
        "cloudflared": _get_cloudflared_pm2_status(),
        "logs": _get_cloudflared_logs(),
    }

    mgr = _get_manager()
    if not mgr:
        return jsonify(result)

    result["configured"] = True
    result["tunnel"] = mgr.get_tunnel_status()
    result["urls"] = mgr.get_service_urls()
    return jsonify(result)


@bp.route("/api/tunnel/validate", methods=["POST"])
def api_tunnel_validate():
    """
    验证 CF API Token。
    Request: { "api_token": "xxx", "domain": "mydomain.com" }
    """
    data = request.get_json(force=True)
    from ..services.tunnel_manager import TunnelManager
    mgr = TunnelManager(
        api_token=data.get("api_token", ""),
        domain=data.get("domain", ""),
    )
    ok, info = mgr.validate_token()
    return jsonify({"ok": ok, **info})


@bp.route("/api/tunnel/provision", methods=["POST"])
def api_tunnel_provision():
    """
    创建/确保 Tunnel 存在, 配置 DNS + Ingress, 启动 cloudflared。
    保存配置到 .dashboard_env。

    Request: {
        "api_token": "xxx",
        "domain": "mydomain.com",
        "subdomain": "my-workspace"  // 可选
    }
    """
    data = request.get_json(force=True)
    api_token = data.get("api_token", "")
    domain = data.get("domain", "")
    subdomain = data.get("subdomain", "")

    if not api_token or not domain:
        return jsonify({"ok": False, "error": "缺少 api_token 或 domain"}), 400

    from ..services.tunnel_manager import TunnelManager, CFAPIError

    mgr = TunnelManager(api_token, domain, subdomain)

    try:
        result = mgr.ensure()
    except CFAPIError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    # 持久化到 config (可被 export 导出)
    set_config("cf_api_token", api_token)
    set_config("cf_domain", domain)
    set_config("cf_subdomain", mgr.subdomain)

    # 启动 cloudflared
    mgr.start_cloudflared(result["tunnel_token"])

    return jsonify({
        "ok": True,
        "tunnel_id": result["tunnel_id"],
        "subdomain": mgr.subdomain,
        "urls": result["urls"],
    })


@bp.route("/api/tunnel/teardown", methods=["POST"])
def api_tunnel_teardown():
    """删除 Tunnel + DNS, 停止 cloudflared, 清除 config"""
    mgr = _get_manager()
    if not mgr:
        return jsonify({"ok": False, "error": "Tunnel 未配置"}), 400

    ok = mgr.teardown()

    if ok:
        set_config("cf_api_token", "")
        set_config("cf_domain", "")
        set_config("cf_subdomain", "")

    return jsonify({"ok": ok})


@bp.route("/api/tunnel/restart", methods=["POST"])
def api_tunnel_restart():
    """重启 cloudflared (不重新 provision)"""
    mgr = _get_manager()
    if not mgr:
        return jsonify({"ok": False, "error": "Tunnel 未配置"}), 400

    from ..services.tunnel_manager import CFAPIError
    try:
        account_id, _ = mgr._get_account()
        tunnel = mgr._find_tunnel(account_id, mgr.tunnel_name)
        if not tunnel:
            return jsonify({"ok": False, "error": "Tunnel 不存在"}), 404

        token = mgr._get_tunnel_token(account_id, tunnel["id"])
        mgr.start_cloudflared(token)
        return jsonify({"ok": True})
    except CFAPIError as e:
        return jsonify({"ok": False, "error": str(e)}), 400


# ═══════════════════════════════════════════════════════════════
# 旧端点兼容 (重定向到新 API)
# ═══════════════════════════════════════════════════════════════

@bp.route("/api/tunnel_status")
def api_tunnel_status_compat():
    """兼容旧端点 — 转换新 API 格式"""
    r = api_tunnel_status_v2()
    data = r.get_json()
    # 转换为旧格式
    links = []
    for name, url in data.get("urls", {}).items():
        from ..services.tunnel_manager import DEFAULT_SERVICES
        svc = next((s for s in DEFAULT_SERVICES if s["name"] == name), {})
        links.append({
            "name": name,
            "icon": {"ComfyCarry": "📊", "ComfyUI": "🎨",
                     "JupyterLab": "📓", "SSH": "🔒"}.get(name, "🌐"),
            "port": str(svc.get("port", "")),
            "status": data.get("cloudflared", "unknown"),
            "url": url if svc.get("protocol", "http") != "ssh" else None,
            "service": f"{svc.get('protocol', 'http')}://localhost:{svc.get('port', '')}",
        })
    return jsonify({
        "status": data.get("cloudflared", "unknown"),
        "logs": data.get("logs", ""),
        "links": links,
    })


@bp.route("/api/tunnel_links")
def api_tunnel_links_compat():
    """兼容旧端点"""
    r = api_tunnel_status_compat()
    data = r.get_json()
    return jsonify({"links": data.get("links", [])})


# ═══════════════════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════════════════

def _get_cloudflared_pm2_status() -> str:
    """查询 cloudflared PM2 进程状态"""
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout):
                if p.get("name") == "cf-tunnel":
                    return p.get("pm2_env", {}).get("status", "unknown")
    except Exception:
        pass
    return "unknown"


def _get_cloudflared_logs() -> str:
    """获取 cloudflared 最近日志"""
    try:
        r = subprocess.run(
            "pm2 logs cf-tunnel --nostream --lines 50 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw = r.stdout + r.stderr
        ansi_re = re.compile(r'\x1b\[[0-9;]*m')
        cleaned = ansi_re.sub('', raw)
        cleaned = re.sub(r'^\d+\|[^|]+\|\s*', '', cleaned, flags=re.MULTILINE)
        return '\n'.join(
            l for l in cleaned.split('\n')
            if not l.startswith('[TAILING]')
            and 'last 50 lines' not in l
            and '/root/.pm2/logs/' not in l
        )
    except Exception:
        return ""
