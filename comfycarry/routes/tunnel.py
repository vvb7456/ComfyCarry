"""ComfyCarry — Tunnel (v2)

Cloudflare Tunnel 管理路由。通过 CF API 自动配置, 不再解析日志。
"""

import json
import re
import subprocess

import requests as http_requests
from flask import Blueprint, Response, jsonify, request

from ..config import get_config, set_config

bp = Blueprint("tunnel", __name__)

# cloudflared --metrics 端点 (两种模式统一使用)
_CF_METRICS_URL = "http://localhost:20241"


def _check_cloudflared_ready() -> str:
    """通过 cloudflared metrics /ready 端点检测实际连通性。

    Returns: "connected" | "disconnected" | "unknown"
    """
    try:
        r = http_requests.get(f"{_CF_METRICS_URL}/ready", timeout=2)
        return "connected" if r.status_code == 200 else "disconnected"
    except Exception:
        return "unknown"


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
        "cloudflared": "online" | "stopped" | "unknown"
    }
    """
    from ..services.tunnel_manager import get_default_services
    result = {
        "configured": False,
        "domain": get_config("cf_domain", ""),
        "subdomain": get_config("cf_subdomain", ""),
        "tunnel": {"exists": False, "status": "inactive"},
        "urls": {},
        "services": [],
        "cloudflared": _get_cloudflared_pm2_status(),
        "cf_protocol": get_config("cf_protocol", "auto"),
    }

    # 构建服务列表 (默认 + 自定义)
    overrides = _get_suffix_overrides()
    all_services = []
    for svc in get_default_services():
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

    # ── 公共 Tunnel 模式 ──
    tunnel_mode = get_config("tunnel_mode", "")

    if tunnel_mode == "public":
        from ..services.public_tunnel import PublicTunnelClient
        client = PublicTunnelClient()
        pub_status = client.get_status()
        result["tunnel_mode"] = "public"

        # 为公共 Tunnel 的 Jupyter URL 拼接 token
        pub_urls = dict(pub_status.get("urls") or {})
        for name in list(pub_urls.keys()):
            if "jupyter" in name.lower():
                try:
                    from . import jupyter as jup_mod
                    token = jup_mod._detect_token()
                    if token:
                        pub_urls[name] = f"{pub_urls[name]}?token={token}"
                except Exception:
                    pass
                break

        result["public"] = {
            "random_id": pub_status.get("random_id"),
            "urls": pub_urls,
            "degraded": pub_status.get("degraded", False),
        }
        # 统一使用 cloudflared /ready 端点检测实际连通性
        ready = _check_cloudflared_ready()
        result["cloudflared_ready"] = ready
        if ready == "connected":
            result["effective_status"] = "online"
        elif pub_status.get("cloudflared_running"):
            result["effective_status"] = "connecting"
        else:
            result["effective_status"] = "offline"
        return jsonify(result)

    # ── 自定义 Tunnel 模式 ──
    mgr = _get_manager()
    if not mgr:
        result["tunnel_mode"] = None
        result["effective_status"] = "unconfigured"
        return jsonify(result)

    result["configured"] = True
    result["tunnel_mode"] = "custom"
    result["tunnel"] = mgr.get_tunnel_status()
    urls = mgr.get_service_urls()

    # 为 JupyterLab URL 自动拼接 token
    for name in list(urls.keys()):
        if "jupyter" in name.lower():
            try:
                from . import jupyter as jup_mod
                token = jup_mod._detect_token()
                if token:
                    urls[name] = f"{urls[name]}?token={token}"
            except Exception:
                pass
            break

    result["urls"] = urls

    # ── 统一状态: 优先使用 cloudflared /ready 本地检测 ──
    ready = _check_cloudflared_ready()
    result["cloudflared_ready"] = ready
    pm2_on = result["cloudflared"] == "online"

    if ready == "connected":
        result["effective_status"] = "online"
    elif ready == "disconnected" and pm2_on:
        result["effective_status"] = "connecting"
    elif pm2_on:
        # /ready 未知但进程在跑 — 可能 metrics 端口未就绪
        result["effective_status"] = "connecting"
    elif result["configured"]:
        result["effective_status"] = "offline"
    else:
        result["effective_status"] = "unconfigured"

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

    # 如果当前在公共 Tunnel 模式, 先释放
    if get_config("tunnel_mode", "") == "public":
        try:
            from ..services.public_tunnel import PublicTunnelClient
            PublicTunnelClient().release()
        except Exception:
            pass

    from ..services.tunnel_manager import TunnelManager, CFAPIError, get_default_services

    mgr = TunnelManager(api_token, domain, subdomain)

    # 包含自定义服务
    overrides = _get_suffix_overrides()
    services = []
    for svc in get_default_services():
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
    """重启 cloudflared (PM2)"""
    tunnel_mode = get_config("tunnel_mode", "")

    if tunnel_mode == "public":
        # 公共模式: 直接 PM2 重启
        r = subprocess.run("pm2 restart cf-tunnel 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return jsonify({"ok": False, "error": "PM2 重启失败"}), 500
        return jsonify({"ok": True})

    # 自定义模式
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


@bp.route("/api/tunnel/stop", methods=["POST"])
def api_tunnel_stop():
    """停止 cloudflared (PM2)"""
    r = subprocess.run("pm2 stop cf-tunnel 2>/dev/null", shell=True,
                       capture_output=True, text=True, timeout=10)
    if r.returncode != 0:
        return jsonify({"ok": False, "error": "停止失败"}), 500
    return jsonify({"ok": True})


@bp.route("/api/tunnel/start", methods=["POST"])
def api_tunnel_start():
    """启动 cloudflared (PM2)"""
    r = subprocess.run("pm2 start cf-tunnel 2>/dev/null", shell=True,
                       capture_output=True, text=True, timeout=10)
    if r.returncode != 0:
        return jsonify({"ok": False, "error": "启动失败"}), 500
    return jsonify({"ok": True})


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


# ═══════════════════════════════════════════════════════════════
# 公共 Tunnel 端点
# ═══════════════════════════════════════════════════════════════

@bp.route("/api/tunnel/public/enable", methods=["POST"])
def api_tunnel_public_enable():
    """
    启用公共 Tunnel。
    - 如果当前有自定义 Tunnel 运行, 先停止
    - 调用 Worker 注册获取 tunnel

    Response: { "ok": true, "urls": {...}, "random_id": "..." }
    """
    from ..services.public_tunnel import PublicTunnelClient, PublicTunnelError

    # 检查是否有自定义 Tunnel 在运行, 如果有则停止
    custom_token = get_config("cf_api_token", "")
    if custom_token:
        try:
            mgr = _get_manager()
            if mgr:
                mgr.teardown()
                set_config("cf_api_token", "")
                set_config("cf_domain", "")
                set_config("cf_subdomain", "")
                set_config("cf_custom_services", "")
        except Exception as e:
            # 自定义 Tunnel 停止失败不阻塞公共 Tunnel 启用
            pass

    client = PublicTunnelClient()
    try:
        result = client.register()
        return jsonify(result)
    except PublicTunnelError as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@bp.route("/api/tunnel/public/disable", methods=["POST"])
def api_tunnel_public_disable():
    """
    禁用公共 Tunnel。

    Response: { "ok": true }
    """
    from ..services.public_tunnel import PublicTunnelClient

    client = PublicTunnelClient()
    result = client.release()
    return jsonify(result)


@bp.route("/api/tunnel/protocol", methods=["POST"])
def api_tunnel_set_protocol():
    """
    设置 cloudflared 传输协议。需要重启 cloudflared 生效。

    Request: { "protocol": "auto" | "http2" | "quic" }
    Response: { "ok": true, "protocol": "http2", "restart_required": true }
    """
    data = request.get_json(force=True)
    protocol = data.get("protocol", "auto")
    if protocol not in ("auto", "http2", "quic"):
        return jsonify({"ok": False, "error": "无效协议，可选: auto, http2, quic"}), 400

    set_config("cf_protocol", protocol)
    return jsonify({"ok": True, "protocol": protocol, "restart_required": True})


@bp.route("/api/tunnel/public/status", methods=["GET"])
def api_tunnel_public_status():
    """
    获取公共 Tunnel 状态 + Worker 容量。

    Response: {
        "mode": "public" | "custom" | null,
        "random_id": "...",
        "urls": {...},
        "cloudflared_running": bool,
        "degraded": bool,
        "capacity": { "active_tunnels": N, "max_tunnels": 200, "available": bool }
    }
    """
    from ..services.public_tunnel import PublicTunnelClient

    client = PublicTunnelClient()
    status = client.get_status()
    capacity = client.get_capacity()
    status["capacity"] = capacity
    return jsonify(status)


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

    from ..services.tunnel_manager import get_default_services, CFAPIError

    # 应用后缀覆盖到默认服务
    overrides = _get_suffix_overrides()
    services = []
    for svc in get_default_services():
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
# Tunnel 日志
# ═══════════════════════════════════════════════════════════════

@bp.route("/api/tunnel/logs")
def api_tunnel_logs():
    """获取 cloudflared 历史日志"""
    lines = int(request.args.get("lines", 100))
    lines = max(10, min(lines, 500))
    try:
        r = subprocess.run(
            f"pm2 logs cf-tunnel --nostream --lines {lines} 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw = r.stdout + r.stderr
        ansi_re = re.compile(r'\x1b\[[0-9;]*m')
        cleaned = ansi_re.sub('', raw)
        cleaned = re.sub(r'^\d+\|[^|]+\|\s*', '', cleaned, flags=re.MULTILINE)
        logs = '\n'.join(
            l for l in cleaned.split('\n')
            if not l.startswith('[TAILING]')
            and 'last ' not in l
            and '/root/.pm2/logs/' not in l
        )
        return jsonify({"logs": logs})
    except Exception as e:
        return jsonify({"logs": "", "error": str(e)})


@bp.route("/api/tunnel/logs/stream")
def api_tunnel_logs_stream():
    """SSE — cloudflared 实时日志流"""
    ansi_re = re.compile(r'\x1b\[[0-9;]*m')
    pm2_prefix_re = re.compile(r'^\d+\|[^|]+\|\s*')

    def generate():
        proc = None
        try:
            proc = subprocess.Popen(
                ["pm2", "logs", "cf-tunnel", "--raw", "--lines", "0"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1
            )
            for line in iter(proc.stdout.readline, ''):
                if not line:
                    break
                line = ansi_re.sub('', line.rstrip('\n'))
                line = pm2_prefix_re.sub('', line)
                if not line:
                    continue
                lvl = "info"
                if re.search(r'error|ERR|exception', line, re.I):
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



