"""
ComfyCarry — 插件管理路由 (代理 ComfyUI-Manager)

- /api/plugins/installed      — 已安装插件列表
- /api/plugins/available      — 可用插件列表
- /api/plugins/versions/<name> — 插件版本
- /api/plugins/fetch_updates  — 拉取更新
- /api/plugins/install|uninstall|update|disable — 操作队列
- /api/plugins/update_all     — 一键更新
- /api/plugins/install_git    — Git URL 安装
- /api/plugins/queue_status   — 队列状态
- /api/plugins/manager_version — Manager 版本
"""

import time

import requests
from flask import Blueprint, jsonify, request

from ..config import COMFYUI_URL

bp = Blueprint("plugins", __name__)


# ── ComfyUI-Manager 请求辅助 ────────────────────────────────

def _safe_upstream_code(code: int) -> int:
    """上游 status code → 安全的 Dashboard 响应码 (避免 401/403 被前端误判为 session 过期)"""
    if 200 <= code < 300:
        return code
    return 502


def _cm_get(path, params=None, timeout=30):
    """向 ComfyUI-Manager 发送 GET 请求"""
    try:
        r = requests.get(f"{COMFYUI_URL}{path}", params=params, timeout=timeout)
        return r
    except requests.exceptions.ConnectionError:
        return None
    except Exception:
        return None


def _cm_post(path, json_data=None, text_data=None, timeout=30):
    """向 ComfyUI-Manager 发送 POST 请求"""
    try:
        if text_data is not None:
            r = requests.post(f"{COMFYUI_URL}{path}", data=text_data,
                              headers={"Content-Type": "text/plain"}, timeout=timeout)
        else:
            r = requests.post(f"{COMFYUI_URL}{path}", json=json_data, timeout=timeout)
        return r
    except requests.exceptions.ConnectionError:
        return None
    except Exception:
        return None


# ====================================================================
# 响应文案 —— 一律 key + params, 由前端翻译 (i18n/locales/*/plugins.json)
#
# /api/plugins/* 的唯一消费方是面板前端, 错误回传 error_key + error_params,
# 成功回传 message_key + message_params, 前端按 plugins.err.<key> /
# plugins.msg.<key> 翻译; 未接 i18n 的端点继续回传 error 原文, apiErrorText()
# / apiMessageText() 对两种后端都安全。
# ====================================================================
def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `plugins.err.<key>` 翻译; _extra 是响应体的附加顶层字段。

    形参位置化 (`/`): 插值参数里有 code 这种名字, 不然会和函数自己的形参撞车。
    `_extra` 反过来只能用关键字传 (`*` 右边): 它要是位置化, 关键字写法会被
    `**params` 静默吞掉, 顶层字段丢失。
    """
    body = {"error_key": f"plugins.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


def _ok(key: str, /, **extra):
    """成功响应。前端按 `plugins.msg.<key>` 翻译 message_key。"""
    body = {"ok": True, "message_key": f"plugins.msg.{key}"}
    params = extra.pop("params", None)
    if params:
        body["message_params"] = params
    body.update(extra)
    return jsonify(body)


# ====================================================================
# 路由
# ====================================================================

@bp.route("/api/plugins/installed")
def api_plugins_installed():
    r = _cm_get("/customnode/installed", params={"mode": "default"})
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code != 200:
        return _err("upstream_error", _safe_upstream_code(r.status_code), code=r.status_code)
    try:
        return jsonify(r.json())
    except Exception:
        return _err("parse_failed", 500)


@bp.route("/api/plugins/available")
def api_plugins_available():
    r = _cm_get("/customnode/getlist",
                params={"mode": "remote", "skip_update": "true"}, timeout=60)
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code != 200:
        return _err("upstream_error", _safe_upstream_code(r.status_code), code=r.status_code)
    try:
        return jsonify(r.json())
    except Exception:
        return _err("parse_failed", 500)


@bp.route("/api/plugins/versions/<path:node_name>")
def api_plugins_versions(node_name):
    r = _cm_get(f"/customnode/versions/{node_name}")
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code != 200:
        return _err("upstream_error", _safe_upstream_code(r.status_code), code=r.status_code)
    try:
        return jsonify(r.json())
    except Exception:
        return _err("parse_failed", 500)


@bp.route("/api/plugins/fetch_updates")
def api_plugins_fetch_updates():
    r = _cm_get("/customnode/fetch_updates",
                params={"mode": "remote"}, timeout=120)
    if r is None:
        return _err("no_comfyui", 502)
    return jsonify({"has_updates": r.status_code == 201,
                    "status_code": r.status_code})


@bp.route("/api/plugins/install", methods=["POST"])
def api_plugins_install():
    """安装插件。

    前端需传入 version 字段 (来自 CM getlist):
    - version != "unknown" → CM 走 CNR 路径 (zip 下载, 安全)
    - version == "unknown" → CM 走 Git Clone 路径 (需要 files 字段)
    """
    data = request.get_json(force=True) or {}
    plugin_id = data.get("id", "").strip()
    if not plugin_id:
        return _err("missing_id", 400)
    version = data.get("version", "unknown")
    payload = {
        "id": plugin_id,
        "version": version,
        "selected_version": data.get("selected_version", "latest"),
        "channel": "default",
        "mode": "remote",
        "ui_id": f"dash-{int(time.time())}",
        "skip_post_install": False,
    }
    if data.get("repository"):
        payload["repository"] = data["repository"]
    # Git Clone 路径必须有 files; CNR 路径不需要但带上无害
    if data.get("files"):
        payload["files"] = data["files"]
    elif version == "unknown":
        return _err("unknown_needs_files", 400)
    r = _cm_post("/manager/queue/install", json_data=payload)
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code not in (200, 201):
        return _err("install_failed", _safe_upstream_code(r.status_code), code=r.status_code)
    _cm_get("/manager/queue/start")
    return _ok("queued_install")


@bp.route("/api/plugins/uninstall", methods=["POST"])
def api_plugins_uninstall():
    data = request.get_json(force=True) or {}
    plugin_id = data.get("id", "").strip()
    if not plugin_id:
        return _err("missing_id", 400)
    payload = {
        "id": plugin_id,
        "version": data.get("version", "unknown"),
        "ui_id": f"dash-{int(time.time())}",
    }
    if data.get("files"):
        payload["files"] = data["files"]
    r = _cm_post("/manager/queue/uninstall", json_data=payload)
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code not in (200, 201):
        return _err("uninstall_failed", _safe_upstream_code(r.status_code), code=r.status_code)
    _cm_get("/manager/queue/start")
    return _ok("queued_uninstall")


@bp.route("/api/plugins/update", methods=["POST"])
def api_plugins_update():
    data = request.get_json(force=True) or {}
    plugin_id = data.get("id", "").strip()
    if not plugin_id:
        return _err("missing_id", 400)
    payload = {
        "id": plugin_id,
        "version": data.get("version", "unknown"),
        "ui_id": f"dash-{int(time.time())}",
    }
    r = _cm_post("/manager/queue/update", json_data=payload)
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code not in (200, 201):
        return _err("update_failed", _safe_upstream_code(r.status_code), code=r.status_code)
    _cm_get("/manager/queue/start")
    return _ok("queued_update")


@bp.route("/api/plugins/update_all", methods=["POST"])
def api_plugins_update_all():
    r = _cm_get("/manager/queue/update_all",
                params={"mode": "remote"}, timeout=120)
    if r is None:
        return _err("no_comfyui", 502)
    _cm_get("/manager/queue/start")
    return _ok("queued_update_all")


@bp.route("/api/plugins/disable", methods=["POST"])
def api_plugins_disable():
    data = request.get_json(force=True) or {}
    plugin_id = data.get("id", "").strip()
    if not plugin_id:
        return _err("missing_id", 400)
    payload = {
        "id": plugin_id,
        "version": data.get("version", "unknown"),
        "ui_id": f"dash-{int(time.time())}",
    }
    r = _cm_post("/manager/queue/disable", json_data=payload)
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code not in (200, 201):
        return _err("action_failed", _safe_upstream_code(r.status_code), code=r.status_code)
    _cm_get("/manager/queue/start")
    return _ok("action_submitted")


@bp.route("/api/plugins/install_git", methods=["POST"])
def api_plugins_install_git():
    """通过 Git URL 安装插件。

    使用 queue/install 的 unknown 路径 (而非 /customnode/install/git_url,
    后者在默认安全级别 normal 下会 403)。
    """
    data = request.get_json(force=True) or {}
    url = data.get("url", "").strip()
    if not url:
        return _err("url_required", 400)
    payload = {
        "id": "",
        "version": "unknown",
        "selected_version": "unknown",
        "channel": "default",
        "mode": "remote",
        "files": [url],
        "ui_id": f"dash-{int(time.time())}",
        "skip_post_install": False,
    }
    r = _cm_post("/manager/queue/install", json_data=payload, timeout=30)
    if r is None:
        return _err("no_comfyui", 502)
    if r.status_code not in (200, 201):
        return _err("install_failed", _safe_upstream_code(r.status_code), code=r.status_code)
    _cm_get("/manager/queue/start")
    return _ok("queued_install")


@bp.route("/api/plugins/queue_status")
def api_plugins_queue_status():
    r = _cm_get("/manager/queue/status")
    if r is None:
        return _err("no_comfyui", 502)
    try:
        return jsonify(r.json())
    except Exception:
        return jsonify({"total_count": 0, "done_count": 0,
                        "in_progress_count": 0, "is_processing": False})


@bp.route("/api/plugins/manager_version")
def api_plugins_manager_version():
    r = _cm_get("/manager/version")
    if r is None:
        return _err("no_comfyui", 502)
    return jsonify({"version": r.text.strip()})
