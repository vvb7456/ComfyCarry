"""
ComfyCarry — Companion 客户端面板后端 (纯 Python)

藍图前缀 /api/companion, JSON 响应, 错误统一 {"error": "..."} + HTTP 状态码。
契约: docs/COMPANION_DESKTOP_APP_SPEC.md §2.2–§2.5。

面板对 companion 只做两件事:
  ① 提供数据源 (WebDAV serve, 见 companion_serve 服务);
  ② 可观测 (谁连着、在拉什么、结果进统一 Activity)。
拉取规则归客户端所有并本地持久化, 面板不存规则、不做规则 CRUD。
规则信息由客户端经 heartbeat 上报「只读摘要」(rule_summaries), 面板仅展示。
"""

import json
import logging
import os
import time
import threading
import uuid

from flask import Blueprint, jsonify, request

from ..config import (
    API_KEY,
    COMFYUI_DIR,
    COMPANION_CLIENTS_FILE,
    DASHBOARD_PASSWORD,
    INSTANCE_LABEL,
)
from ..services import companion_serve

bp = Blueprint("companion", __name__)
log = logging.getLogger("comfycarry.companion")

# ── 客户端状态文件读写 ───────────────────────────────────────
_clients_lock = threading.Lock()

# last_seen 在此秒数内视为在线
_ONLINE_TTL = 45


def _load_clients():
    """加载已知客户端状态 (dict: client_id -> info)"""
    if COMPANION_CLIENTS_FILE.exists():
        try:
            return json.loads(COMPANION_CLIENTS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_clients(data):
    """保存客户端状态 (临时文件 + 原子替换, 防写一半被中断损坏 JSON)。"""
    COMPANION_CLIENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = COMPANION_CLIENTS_FILE.with_suffix(COMPANION_CLIENTS_FILE.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    os.replace(tmp, COMPANION_CLIENTS_FILE)


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

    body: {client_id, hostname, app_version, status, active_rule_id, progress, rule_summaries}
    rule_summaries: list (客户端上报什么就存什么, 不校验内部结构; 非 list 则存 [])
    记录 last_seen=now, 供 GET /clients 在线判定。
    """
    data = request.get_json(silent=True) or {}
    client_id = data.get("client_id", "")
    if not client_id:
        return jsonify({"error": "缺少 client_id"}), 400

    rule_summaries = data.get("rule_summaries")
    if not isinstance(rule_summaries, list):
        rule_summaries = []

    now = time.time()
    info = {
        "client_id": client_id,
        "hostname": data.get("hostname", ""),
        "app_version": data.get("app_version", ""),
        "status": data.get("status", "idle"),
        "active_rule_id": data.get("active_rule_id", ""),
        "progress": data.get("progress", {}),
        "rule_summaries": rule_summaries,
        "last_seen": now,
    }
    with _clients_lock:
        clients = _load_clients()
        clients[client_id] = info
        _save_clients(clients)
    return jsonify({"ok": True, "online": True, "last_seen": now})


@bp.route("/api/companion/clients", methods=["GET"])
def api_companion_clients():
    """返回已知客户端 + 在线判定 + serve 状态 + dav_url。

    返回: {clients:[...], serve:{...}, dav_url:"..."}
    每个 client 项带 rule_summaries (缺省 [])。
    """
    now = time.time()
    with _clients_lock:
        clients = _load_clients()
    result = []
    for cid, info in clients.items():
        last_seen = info.get("last_seen", 0)
        online = (now - last_seen) <= _ONLINE_TTL
        result.append({
            "client_id": cid,
            "hostname": info.get("hostname", ""),
            "app_version": info.get("app_version", ""),
            "status": info.get("status", "idle"),
            "active_rule_id": info.get("active_rule_id", ""),
            "progress": info.get("progress", {}),
            "rule_summaries": info.get("rule_summaries", []),
            "last_seen": last_seen,
            "online": online,
        })
    result.sort(key=lambda c: c.get("last_seen", 0), reverse=True)
    return jsonify({
        "clients": result,
        "serve": companion_serve.status(),
        "dav_url": _infer_dav_url(),
    })


@bp.route("/api/companion/clients/<client_id>", methods=["DELETE"])
def api_companion_client_forget(client_id):
    """忘记客户端: 从 clients 文件删除该 client_id 的记录。"""
    with _clients_lock:
        clients = _load_clients()
        if client_id not in clients:
            return jsonify({"error": "客户端不存在"}), 404
        del clients[client_id]
        _save_clients(clients)
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════════
# 2.5 Job 回报 (复用 sync_store)
# ═══════════════════════════════════════════════════════════════
@bp.route("/api/companion/jobs", methods=["POST"])
def api_companion_job_create():
    """创建 companion job (映射 sync_store.create_job, trigger_type="companion")。

    body: {rule_id, rule_count?, client_id?} (rule_count 缺省 0)
    返回: {ok:true, job_id:"companion-..."}
    """
    from ..services import sync_store as store

    data = request.get_json(silent=True) or {}
    rule_id = data.get("rule_id", "")
    client_id = data.get("client_id", "")
    rule_count = int(data.get("rule_count", 0) or 0)

    job_id = f"companion-{uuid.uuid4().hex[:12]}"
    store.create_job(
        job_id,
        trigger_type="companion",
        trigger_ref=rule_id,
        rule_count=rule_count,
    )
    log.info("companion job created: %s (client=%s rule=%s)", job_id, client_id, rule_id)
    return jsonify({"ok": True, "job_id": job_id})


@bp.route("/api/companion/jobs/<job_id>/events", methods=["POST"])
def api_companion_job_event(job_id):
    """追加事件 (映射 sync_store.add_event)。

    body: {key, rule_id?, level?, params?}
    返回: {ok:true}
    """
    from ..services import sync_store as store

    # 校验 job 存在
    job = store.get_job(job_id)
    if not job:
        return jsonify({"error": "Job 不存在"}), 404

    data = request.get_json(silent=True) or {}
    key = data.get("key", "")
    if not key:
        return jsonify({"error": "缺少 key"}), 400

    store.add_event(
        job_id,
        key,
        rule_id=data.get("rule_id", ""),
        level=data.get("level", "info"),
        params=data.get("params"),
    )
    return jsonify({"ok": True})


@bp.route("/api/companion/jobs/<job_id>/finish", methods=["POST"])
def api_companion_job_finish(job_id):
    """收尾 job (映射 sync_store.finish_job)。

    body: {status, success_count?, failure_count?, files_synced?, summary?}
    返回: {ok:true}
    """
    from ..services import sync_store as store

    job = store.get_job(job_id)
    if not job:
        return jsonify({"error": "Job 不存在"}), 404

    data = request.get_json(silent=True) or {}
    status = data.get("status", "success")
    if status not in ("success", "failed", "partial", "cancelled"):
        return jsonify({"error": "status 取值非法"}), 400

    store.finish_job(
        job_id,
        status=status,
        success_count=int(data.get("success_count", 0) or 0),
        failure_count=int(data.get("failure_count", 0) or 0),
        files_synced=int(data.get("files_synced", 0) or 0),
        summary=data.get("summary"),
    )
    return jsonify({"ok": True})
