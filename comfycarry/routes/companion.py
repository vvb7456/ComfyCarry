"""
ComfyCarry — Companion 客户端面板后端 (纯 Python)

蓝图前缀 /api/companion, JSON 响应 + HTTP 状态码。

错误文案分两套, 按消费方划分:
  - 桌面客户端调的 (connect / heartbeat): 原文 —— 客户端没有 locale
    表, 而且它只看状态码, 回 key 只会让排障时看到一串没人翻译的标识符。
契约: docs/COMPANION_DESKTOP_APP_SPEC.md §2.2–§2.4。

面板对 companion 只做两件事:
  ① 提供数据源 (WebDAV serve, 见 companion_serve 服务);
  ② 可观测 (谁连着、上报的同步状态)。
拉取规则归客户端所有, 面板不接收 (rule_summaries 字段直接忽略);
客户端上报的同步状态只在内存原样保留并展示, 不落库 (见 _clients)。

客户端连接记录只存内存 (见 _clients), 不落盘、不保留离线客户端:
  - heartbeat 直接覆盖该 client_id 的内存条目, last_seen=now;
  - GET /clients 只返回 last_seen 在 _ONLINE_TTL 内的客户端;
  - 面板重启后内存清空, 客户端下次心跳即重新出现, 无需"忘记"按钮。
"""

import logging
import time
import threading

from flask import Blueprint, jsonify, request

from ..config import (
    API_KEY,
    COMFYUI_DIR,
    DASHBOARD_PASSWORD,
    INSTANCE_LABEL,
)
from ..services import companion_serve

bp = Blueprint("companion", __name__)
log = logging.getLogger("comfycarry.companion")


# ── 客户端在线状态 (纯内存, 不持久化) ─────────────────────────
_clients_lock = threading.Lock()
# client_id -> info (与 heartbeat body 同构 + last_seen)。仅在线条目保留,
# 超过 _ONLINE_TTL 未再上报的条目在 GET /clients 读取时被过滤 (不主动删除,
# 下次该 client_id 心跳上报时直接覆盖, 避免竞态下丢条目)。
_clients: dict[str, dict] = {}

# last_seen 在此秒数内视为在线
_ONLINE_TTL = 45


def _infer_dav_url():
    """推断对客户端可用的 WebDAV 地址。

    WebDAV 数据面经 Flask 反代 (/api/companion/dav) 暴露, 不再走 cloudflared
    /dav ingress, 因此自定义/公共 Tunnel + 直连全通。

    优先 X-Forwarded-Proto/Host (经 cloudflared 反代时的真实协议/主机),
    回退 request.host_url (形如 "https://x.y/"), 拼接 /api/companion/dav。
    """
    scheme = request.headers.get("X-Forwarded-Proto", "").strip()
    if not scheme:
        scheme = request.scheme or "https"
    host = request.headers.get("X-Forwarded-Host", "").strip()
    if not host:
        host = request.host_url.rstrip("/")
        if "://" in host:
            return f"{host}/api/companion/dav"
        return f"{scheme}://{host}/api/companion/dav"
    return f"{scheme}://{host}/api/companion/dav"


# ═══════════════════════════════════════════════════════════════
# 2.2 客户端连接 (密码 → API Key)
# ═══════════════════════════════════════════════════════════════
@bp.route("/api/companion/connect", methods=["POST"])
def api_companion_connect():
    """密码换 API Key + WebDAV 连接信息。

    此端点在 auth 中间件放行名单内 (auth.py), 仅凭密码校验。
    """
    data = request.get_json(silent=True) or {}
    password = data.get("password", "")

    if not DASHBOARD_PASSWORD:
        return jsonify({"error": "面板未设置密码, 无法连接"}), 503

    if password != DASHBOARD_PASSWORD:
        log.warning("companion connect 密码不符")
        return jsonify({"error": "密码错误"}), 401

    return jsonify({
        "ok": True,
        "api_key": API_KEY,
        "dav_url": _infer_dav_url(),
        "dav_user": "comfy",
        "comfyui_dir": COMFYUI_DIR,
        "instance_label": INSTANCE_LABEL or "",
    })


# ═══════════════════════════════════════════════════════════════
# 2.4 客户端注册 + 心跳
# ═══════════════════════════════════════════════════════════════
@bp.route("/api/companion/heartbeat", methods=["POST"])
def api_companion_heartbeat():
    """客户端心跳上报。

    body: {client_id, hostname, app_version, status}
    面板只在内存记录连接身份、原样 status 与 last_seen (GET /clients 用),
    供在线判定与展示; 不写数据库。rule_summaries 等规则字段一律忽略。
    """
    data = request.get_json(silent=True) or {}
    client_id = data.get("client_id", "")
    if not client_id:
        return jsonify({"error": "缺少 client_id"}), 400

    now = time.time()
    info = {
        "client_id": client_id,
        "hostname": data.get("hostname", ""),
        "app_version": data.get("app_version", ""),
        "status": data.get("status", ""),
        "last_seen": now,
    }
    with _clients_lock:
        _clients[client_id] = info
    return jsonify({"ok": True, "online": True, "last_seen": now})


@bp.route("/api/companion/clients", methods=["GET"])
def api_companion_clients():
    """返回在线客户端 + serve 状态 + dav_url。

    返回: {clients:[...], serve:{...}, dav_url:"..."}
    仅返回 last_seen 在 _ONLINE_TTL 内的客户端; 离线条目不展示也不持久化,
    下次该 client_id 心跳上报时自动重新出现。
    """
    now = time.time()
    with _clients_lock:
        snapshot = list(_clients.values())
    result = []
    for info in snapshot:
        last_seen = info.get("last_seen", 0)
        if (now - last_seen) > _ONLINE_TTL:
            continue
        result.append({
            "client_id": info.get("client_id", ""),
            "hostname": info.get("hostname", ""),
            "app_version": info.get("app_version", ""),
            "status": info.get("status", ""),
            "last_seen": last_seen,
            "online": True,
        })
    result.sort(key=lambda c: c.get("last_seen", 0), reverse=True)
    return jsonify({
        "clients": result,
        "serve": companion_serve.status(),
        "dav_url": _infer_dav_url(),
    })

