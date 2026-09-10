"""
ComfyCarry — Companion 客户端面板后端 (纯 Python)

蓝图前缀 /api/companion, JSON 响应 + HTTP 状态码。

错误文案分两套, 按消费方划分:
  - 桌面客户端调的 (connect / heartbeat / jobs*): 原文 —— 客户端没有 locale
    表, 而且它只看状态码, 回 key 只会让排障时看到一串没人翻译的标识符。
契约: docs/COMPANION_DESKTOP_APP_SPEC.md §2.2–§2.5。

面板对 companion 只做两件事:
  ① 提供数据源 (WebDAV serve, 见 companion_serve 服务);
  ② 可观测 (谁连着、在拉什么、结果进统一 Activity)。
拉取规则归客户端所有并本地持久化, 面板不存规则、不做规则 CRUD。
规则信息由客户端经 heartbeat 上报「只读摘要」(rule_summaries), 面板仅展示。

客户端连接记录只存内存 (见 _clients), 不落盘、不保留离线客户端:
  - heartbeat 直接覆盖该 client_id 的内存条目, last_seen=now;
  - GET /clients 只返回 last_seen 在 _ONLINE_TTL 内的客户端;
  - 面板重启后内存清空, 客户端下次心跳即重新出现, 无需"忘记"按钮。
"""

import logging
import time
import threading
import uuid

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

    body: {client_id, hostname, app_version, status, rule_summaries}
    rule_summaries: list (客户端上报什么就存什么, 不校验内部结构; 非 list 则存 [])
    记录 last_seen=now, 供 GET /clients 在线判定。

    active_rule_id / progress 曾由客户端上报, 但面板不展示 (前者从未使用, 后者
    的进度条已移除), 现从协议中剔除 —— 客户端本地保留即可, 不必再上报。
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
        "rule_summaries": rule_summaries,
        "last_seen": now,
    }
    with _clients_lock:
        _clients[client_id] = info
    return jsonify({"ok": True, "online": True, "last_seen": now})


@bp.route("/api/companion/clients", methods=["GET"])
def api_companion_clients():
    """返回在线客户端 + serve 状态 + dav_url。

    返回: {clients:[...], serve:{...}, dav_url:"..."}
    每个 client 项带 rule_summaries (缺省 [])。
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
            "status": info.get("status", "idle"),
            "rule_summaries": info.get("rule_summaries", []),
            "last_seen": last_seen,
            "online": True,
        })
    result.sort(key=lambda c: c.get("last_seen", 0), reverse=True)
    return jsonify({
        "clients": result,
        "serve": companion_serve.status(),
        "dav_url": _infer_dav_url(),
    })


# ═══════════════════════════════════════════════════════════════
# 2.5 Job 回报 (复用 sync_store)
# ═══════════════════════════════════════════════════════════════
@bp.route("/api/companion/jobs", methods=["POST"])
def api_companion_job_create():
    """创建 companion job (映射 sync_store.create_job, trigger_type="companion")。

    body: {rule_id, rule_count?, client_id?, rule_snapshot?, rule_snapshots?}
      - rule_snapshot / rule_snapshots: 客户端可提交服务端可用的展示快照;
      - 未提交快照时按 rule_id 从当前规则表补齐;
      - 规则已不存在时写入 id 与触发信息, 其余字段空值, 保证历史仍能
        显示任务数量与事件结果。
    返回: {ok:true, job_id:"companion-..."}
    """
    from ..services import sync_store as store
    from ..services.sync_engine import _load_sync_rules, build_rule_snapshot

    data = request.get_json(silent=True) or {}
    rule_id = data.get("rule_id", "")
    client_id = data.get("client_id", "")
    rule_count = int(data.get("rule_count", 0) or 0)

    snapshots = _companion_rule_snapshots(data, rule_id,
                                          _load_sync_rules, build_rule_snapshot)
    if not rule_count and snapshots:
        rule_count = len(snapshots)

    job_id = f"companion-{uuid.uuid4().hex[:12]}"
    store.create_job(
        job_id,
        trigger_type="companion",
        trigger_ref=rule_id,
        rule_count=rule_count,
        rules=snapshots,
    )
    log.info("companion job created: %s (client=%s rule=%s)", job_id, client_id, rule_id)
    return jsonify({"ok": True, "job_id": job_id})


def _companion_rule_snapshots(data, rule_id, load_rules, build_snapshot):
    """整理 companion 任务的规则快照。

    优先级: 客户端提交的 rule_snapshots / rule_snapshot → 当前规则表补齐 →
    规则已不存在时的最小快照 (id + 触发信息, 其余空值)。
    """
    raw_list = data.get("rule_snapshots")
    if isinstance(raw_list, list) and raw_list:
        return [build_snapshot(s) for s in raw_list if isinstance(s, dict)]
    raw = data.get("rule_snapshot")
    if isinstance(raw, dict):
        return [build_snapshot(raw)]
    if rule_id:
        rule = next((r for r in load_rules() if r.get("id") == rule_id), None)
        if rule:
            return [build_snapshot(rule)]
        return [build_snapshot({"id": rule_id, "trigger": "companion"})]
    return []


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
