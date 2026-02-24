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
        "services": [ { "name": ..., "port": ..., "suffix": ..., "protocol": ..., "custom": bool } ],
        "cloudflared": "online" | "stopped" | "unknown",
        "logs": "..."
    }
    """
    from ..services.tunnel_manager import DEFAULT_SERVICES
    result = {
        "configured": False,
        "domain": get_config("cf_domain", ""),
        "subdomain": get_config("cf_subdomain", ""),
        "tunnel": {"exists": False, "status": "inactive"},
        "urls": {},
        "services": [],
        "cloudflared": _get_cloudflared_pm2_status(),
        "logs": _get_cloudflared_logs(),
    }

    # 构建服务列表 (默认 + 自定义)
    overrides = _get_suffix_overrides()
    all_services = []
    for svc in DEFAULT_SERVICES:
        s = dict(svc)
        s["custom"] = False
        orig_suffix = s.get("suffix", "")
        if orig_suffix in overrides:
            s["suffix"] = overrides[orig_suffix]
        all_services.append(s)

    custom = _get_custom_services()
    for svc in custom:
        s = dict(svc)
        s["custom"] = True
        all_services.append(s)

    result["services"] = all_services

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

    from ..services.tunnel_manager import TunnelManager, CFAPIError, DEFAULT_SERVICES

    mgr = TunnelManager(api_token, domain, subdomain)

    # 包含自定义服务
    overrides = _get_suffix_overrides()
    services = []
    for svc in DEFAULT_SERVICES:
        s = dict(svc)
        orig_suffix = s.get("suffix", "")
        if orig_suffix in overrides:
            s["suffix"] = overrides[orig_suffix]
        services.append(s)
    custom = _get_custom_services()
    services.extend(custom)

    try:
        result = mgr.ensure(services)
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
        set_config("cf_custom_services", "")

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


@bp.route("/api/tunnel/services", methods=["GET"])
def api_tunnel_services():
    """获取当前服务列表 (默认 + 自定义)"""
    from ..services.tunnel_manager import DEFAULT_SERVICES
    custom = _get_custom_services()
    all_services = list(DEFAULT_SERVICES) + custom
    return jsonify({"services": all_services})


@bp.route("/api/tunnel/services", methods=["POST"])
def api_tunnel_add_service():
    """
    添加自定义服务并更新 Tunnel Ingress + DNS。
    Request: { "name": "MyApp", "port": 3000, "suffix": "app", "protocol": "http" }
    """
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    port = data.get("port", 0)
    suffix = data.get("suffix", "").strip()
    protocol = data.get("protocol", "http")

    if not name or not port or not suffix:
        return jsonify({"ok": False, "error": "请填写服务名称、端口和子域名后缀"}), 400

    # 保存到自定义服务列表
    custom = _get_custom_services()
    # 检查是否已存在
    for s in custom:
        if s["suffix"] == suffix:
            return jsonify({"ok": False, "error": f"后缀 '{suffix}' 已被服务 '{s['name']}' 使用"}), 400

    custom.append({"name": name, "port": int(port), "suffix": suffix, "protocol": protocol})
    set_config("cf_custom_services", json.dumps(custom))

    # 重新 provision (更新 Ingress + DNS)
    return _reprovision_services()


@bp.route("/api/tunnel/services/<suffix>", methods=["DELETE"])
def api_tunnel_remove_service(suffix):
    """移除自定义服务"""
    custom = _get_custom_services()
    custom = [s for s in custom if s["suffix"] != suffix]
    set_config("cf_custom_services", json.dumps(custom))
    return _reprovision_services()


@bp.route("/api/tunnel/services/<suffix>/subdomain", methods=["PUT"])
def api_tunnel_update_subdomain(suffix):
    """
    修改某个服务的子域名后缀。
    Request: { "new_suffix": "newname" }
    """
    data = request.get_json(force=True)
    new_suffix = data.get("new_suffix", "").strip()
    if not new_suffix:
        return jsonify({"ok": False, "error": "新后缀不能为空"}), 400

    custom = _get_custom_services()
    found = False
    for s in custom:
        if s["suffix"] == suffix:
            s["suffix"] = new_suffix
            found = True
            break

    if not found:
        # 检查是否是默认服务 — 默认服务的后缀通过 override 存储
        overrides = _get_suffix_overrides()
        overrides[suffix] = new_suffix
        set_config("cf_suffix_overrides", json.dumps(overrides))
    else:
        set_config("cf_custom_services", json.dumps(custom))

    return _reprovision_services()


@bp.route("/api/tunnel/config", methods=["GET"])
def api_tunnel_get_config():
    """获取当前 Tunnel 配置 (用于修改配置弹窗)"""
    return jsonify({
        "api_token": get_config("cf_api_token", ""),
        "domain": get_config("cf_domain", ""),
        "subdomain": get_config("cf_subdomain", ""),
    })


def _get_custom_services():
    """获取用户自定义服务列表"""
    raw = get_config("cf_custom_services", "")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []


def _get_suffix_overrides():
    """获取默认服务的后缀覆盖"""
    raw = get_config("cf_suffix_overrides", "")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _reprovision_services():
    """重新 provision 所有服务 (默认 + 自定义)"""
    mgr = _get_manager()
    if not mgr:
        return jsonify({"ok": False, "error": "Tunnel 未配置"}), 400

    from ..services.tunnel_manager import DEFAULT_SERVICES, CFAPIError

    # 应用后缀覆盖到默认服务
    overrides = _get_suffix_overrides()
    services = []
    for svc in DEFAULT_SERVICES:
        s = dict(svc)
        orig_suffix = s.get("suffix", "")
        if orig_suffix in overrides:
            s["suffix"] = overrides[orig_suffix]
        services.append(s)

    # 添加自定义服务
    custom = _get_custom_services()
    services.extend(custom)

    try:
        result = mgr.ensure(services)
        # 重启 cloudflared
        mgr.start_cloudflared(result["tunnel_token"])
        return jsonify({"ok": True, "urls": result["urls"]})
    except CFAPIError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

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
