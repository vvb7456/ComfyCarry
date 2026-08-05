"""
ComfyCarry — 模型管理路由

包含:
- CivitAI 搜索代理 (Meilisearch CORS bypass)
- 本地模型管理 (索引/预览/删除/获取信息)
- Enhanced-Civicomfy 下载代理
"""

import json
import logging
import os
import threading
import time
from pathlib import Path
from urllib.parse import quote

import requests
from flask import Blueprint, Response, jsonify, request, send_file

from ..config import (
    COMFYUI_DIR,
    MEILI_BEARER,
    MEILI_URL,
    MODEL_DIRS,
    WORKSPACE_ROOT,
    get_extra_model_paths,
)
from ..utils import _get_api_key

logger = logging.getLogger(__name__)

bp = Blueprint("models", __name__)


def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `models.err.<key>` 翻译; _extra 是响应体的附加顶层字段。"""
    body = {"error_key": f"models.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


# ====================================================================
# CivitAI 搜索代理 (Meilisearch CORS bypass)
# ====================================================================
@bp.route("/api/search", methods=["POST"])
def proxy_search():
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return _err("no_json_body")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MEILI_BEARER}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        # 30s 而非 10s: Civitai 的 Meilisearch 实测会间歇性慢到 9~15s
        # (2026-07-28 实测 /health 单次 14.5s), 10s 卡在临界点, 一半请求超时。
        resp = requests.post(MEILI_URL, headers=headers, json=data, timeout=30)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except requests.Timeout:
        # 504 而非 500 —— 是上游慢, 不是本服务出错。前端据此给出可重试的提示。
        return _err("search_timeout", 504)
    except requests.RequestException as e:
        return _err("search_unavailable", 502, detail=str(e))
    except Exception as e:
        return _err("internal", 500, detail=str(e))


# ====================================================================
# CivitAI Model API Proxy (统一前端对 civitai.com 的请求)
# ====================================================================
@bp.route("/api/civitai/model/<int:model_id>", methods=["GET"])
def proxy_civitai_model(model_id: int):
    """代理 CivitAI v1 models/{id} API, 避免前端直接跨域请求."""
    try:
        api_key = _get_api_key()
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "ComfyCarry/1.0",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        resp = requests.get(
            f"https://civitai.com/api/v1/models/{model_id}",
            headers=headers,
            timeout=30,
        )
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except requests.Timeout:
        return _err("civitai_api_timeout", 504)
    except Exception as e:
        return _err("civitai_api_failed", 502, detail=str(e))


# ====================================================================
# CivitAI 可下载性 (Generation-Only 过滤)
# ====================================================================
# 背景: 作者可以把模型设为 "Generation-Only" —— 只能在 Civitai 站内出图,
#       不提供权重下载。这类 version 不该出现在下载列表里。
#
# 判据来源 (2026-07-28 实测):
#   - Meilisearch 索引 (前端搜索用):  **没有**任何相关字段。permissions 只是
#     授权条款; mode/status/availability/locked 在 Generation-Only 模型上与
#     普通模型完全一致 (null/Published/Public/false)。
#   - REST v1 /models/{id}:           **没有** canDownload。files 与 downloadUrl
#     照常返回, 看不出区别。
#   - 唯一结构化来源: tRPC model.getById → result.data.json.modelVersions[].canDownload
#     canDownload 为 true 才可下载 (Generation-Only 模型上全部 version 恒为 null)。
#
# 佐证: 不带 key 直接 GET /api/download/models/<vid> ——
#   Pony V6 (可下载)  → 200 application/octet-stream
#   Babes (Gen-Only)  → 401 Unauthorized
# 该探测能确诊但每个 version 一次请求, 太重, 故用 tRPC 一次拿全模型。
#
# 注意: tRPC 是 Civitai 的内部接口, 不保证稳定。**失败一律放行** (fail-open) ——
#       宁可多列一个下不了的版本 (下载时仍有 4xx 兜底), 也不能因为接口抖动
#       把正常模型从列表里抹掉。

_DL_FLAGS_TTL = 600  # 秒
_dl_flags_cache: dict[int, tuple[float, dict]] = {}
_dl_flags_lock = threading.Lock()


@bp.route("/api/civitai/model/<int:model_id>/download_flags", methods=["GET"])
def civitai_download_flags(model_id: int):
    """返回 {version_id: 是否可下载}。

    响应: {"flags": {"290640": true, ...}, "resolved": bool}
      resolved=False 表示没拿到判据 (接口失败/结构变化), 前端应放行全部版本。
    """
    now = time.time()
    with _dl_flags_lock:
        cached = _dl_flags_cache.get(model_id)
        if cached and now - cached[0] < _DL_FLAGS_TTL:
            return jsonify(cached[1])

    payload = {"flags": {}, "resolved": False}
    try:
        inp = quote(json.dumps({"json": {"id": model_id}}, separators=(",", ":")))
        resp = requests.get(
            f"https://civitai.com/api/trpc/model.getById?input={inp}",
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://civitai.com/",
            },
            timeout=20,
        )
        if resp.ok:
            versions = (
                resp.json().get("result", {}).get("data", {}).get("json", {}) or {}
            ).get("modelVersions") or []
            if versions:
                payload = {
                    "flags": {
                        str(v.get("id")): (v.get("canDownload") is True)
                        for v in versions
                        if v.get("id") is not None
                    },
                    "resolved": True,
                }
    except Exception as e:
        logger.debug(f"[civitai] download_flags 获取失败 (放行): {e}")

    # 只缓存成功结果。失败 (网络抖动 / resp 非 ok / versions 为空 / 结构变化) 时
    # payload 仍是 resolved=False 的放行态, 缓存它会让这个模型在整个 TTL 内都拿不到
    # 判据 —— 一次超时就使 Generation-Only 模型十分钟内无法被正确过滤, 用户会点到
    # 下不了的版本。失败不写缓存, 下次请求即可重试。
    if payload["resolved"]:
        with _dl_flags_lock:
            _dl_flags_cache[model_id] = (now, payload)
    return jsonify(payload)


# --------------------------------------------------------------------
# Indexed local-model API
# --------------------------------------------------------------------
#
# The metadata store is the source of truth for this API.  Production callers
# use the ID-based endpoints below and never submit a filesystem path.

_PREVIEW_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})
model_meta_store = None


def _get_model_meta_store():
    """Import the metadata store lazily to avoid an app-startup cycle."""
    global model_meta_store
    if model_meta_store is None:
        from ..services import model_meta_store as store

        model_meta_store = store
    return model_meta_store


def _model_not_found(local_model_id: int):
    return _err("model_not_found", 404, local_model_id=local_model_id)


def _as_dict(value):
    """Convert a store row (dict/sqlite Row) to a plain dictionary."""
    if value is None:
        return None
    if isinstance(value, dict):
        return dict(value)
    try:
        return dict(value)
    except (TypeError, ValueError):
        return None


def _json_value(value, default):
    """Decode a JSON column while accepting already-decoded values."""
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return default
    return default


def _path_in(root: Path, candidate) -> bool:
    """Resolve a path and check that it is below ``root``."""
    if not candidate:
        return False
    try:
        return Path(candidate).resolve(strict=False).is_relative_to(root.resolve())
    except (OSError, RuntimeError, TypeError, ValueError):
        return False


def _managed_model_roots() -> list[Path]:
    """Return every configured model root after resolving directory symlinks."""
    roots: list[Path] = []
    seen: set[str] = set()
    comfy_root = Path(COMFYUI_DIR)
    for relative in MODEL_DIRS.values():
        root = (comfy_root / relative).resolve(strict=False)
        if str(root) not in seen:
            seen.add(str(root))
            roots.append(root)
    for directories in get_extra_model_paths().values():
        for raw in directories:
            root = Path(raw).resolve(strict=False)
            if str(root) not in seen:
                seen.add(str(root))
                roots.append(root)
    return roots


def _path_in_managed_models(candidate) -> bool:
    return any(_path_in(root, candidate) for root in _managed_model_roots())


def _invalidate_generate_options() -> None:
    """Refresh generation metadata after an indexed model changes."""
    try:
        from .generate import invalidate_options_cache

        invalidate_options_cache()
    except Exception as exc:
        logger.debug("[models] invalidate generate options failed: %s", exc)


def _capabilities(model: dict) -> tuple[bool, bool]:
    """Return safe enrich/delete capabilities for an internal model row."""
    real_path = model.get("real_path")
    enrich_default = _path_in(Path(COMFYUI_DIR), real_path)
    delete_default = _path_in(Path(WORKSPACE_ROOT), real_path)
    can_fetch = model.get("can_fetch_info")
    can_delete = model.get("can_delete")
    return (
        bool(enrich_default if can_fetch is None else can_fetch),
        bool(delete_default if can_delete is None else can_delete),
    )


def _public_model(model: dict, *, detail: bool = False) -> dict:
    """Map a store row to the API contract and hide internal paths."""
    value = _as_dict(model) or {}
    # Normalize defaults for an index row that has not been enriched yet.
    value.setdefault("relative_path", "")
    value.setdefault("display_name", value.get("filename", ""))
    value.setdefault("model_type", value.get("category", ""))
    value.setdefault("file_mtime", 0)
    value.setdefault("size_bytes", 0)
    value.setdefault("architecture", value.get("architecture", "unknown") or "unknown")
    value.setdefault("base_model", value.get("base_model", ""))
    value["has_info"] = bool(value.get("has_info", False))
    value["has_preview"] = bool(value.get("has_preview", False))

    if "trigger_words" not in value:
        value["trigger_words"] = _json_value(value.get("trigger_words_json"), [])
    if "trigger_sources" not in value:
        value["trigger_sources"] = _json_value(value.get("trigger_sources_json"), {})

    source = value.get("source")
    if isinstance(source, dict):
        value.setdefault("source_type", source.get("type", ""))
        value.setdefault("source_model_id", source.get("model_id", ""))
        value.setdefault("source_version_id", source.get("version_id", ""))
        value.setdefault("source_version_name", source.get("version_name", ""))
    elif detail:
        value["source"] = {
            "type": value.get("source_type", ""),
            "model_id": value.get("source_model_id", ""),
            "version_id": value.get("source_version_id", ""),
            "version_name": value.get("source_version_name", ""),
        }

    if value.get("id") is not None:
        try:
            value["preview_url"] = (
                f"/api/local_models/{int(value['id'])}/preview"
                if value["has_preview"]
                else None
            )
        except (TypeError, ValueError):
            value["preview_url"] = None

    can_fetch, can_delete = _capabilities(value)
    value["can_fetch_info"] = can_fetch
    value["can_delete"] = can_delete

    details = _json_value(value.get("details_json"), {})
    if isinstance(details, dict):
        images = details.get("images", [])
        if isinstance(images, list) and images:
            first = images[0] if isinstance(images[0], dict) else {}
            value.setdefault("remote_preview_url", first.get("url"))
            value.setdefault("remote_preview_type", first.get("type") or "image")
        else:
            value.setdefault("remote_preview_url", None)
            value.setdefault("remote_preview_type", None)
        if detail:
            value.setdefault("links", details.get("links", []))
            value.setdefault("images", images)

    fields = (
        "id",
        "filename",
        "category",
        "relative_path",
        "display_name",
        "model_type",
        "architecture",
        "base_model",
        "size_bytes",
        "file_mtime",
        "has_info",
        "has_preview",
        "preview_url",
        "remote_preview_url",
        "remote_preview_type",
        "source_type",
        "source_model_id",
        "source_version_id",
        "source_version_name",
        "can_fetch_info",
        "can_delete",
    )
    if detail:
        fields += (
            "sha256",
            "trigger_words",
            "trigger_sources",
            "source",
            "links",
            "images",
        )
    return {key: value[key] for key in fields if key in value}


def _get_internal_model(local_model_id: int) -> dict | None:
    return _as_dict(_get_model_meta_store().get_model_detail(local_model_id))


@bp.route("/api/local_models")
def api_local_models():
    """Return small list fields from the SQLite model index."""
    category = request.args.get("category", "all").strip()
    category_arg = None if not category or category == "all" else category
    try:
        _get_model_meta_store().reconcile_model_index()
        models = _get_model_meta_store().list_models(category_arg) or []
        public = [_public_model(m) for m in models]
        return jsonify({"models": public, "total": len(public)})
    except Exception as exc:
        logger.exception("[models] list local models failed")
        return _err("internal", 500, detail=str(exc))


@bp.route("/api/local_models/<int:local_model_id>", methods=["GET"])
def api_local_model_detail(local_model_id: int):
    """Return complete metadata for one indexed local model."""
    try:
        model = _get_internal_model(local_model_id)
    except Exception as exc:
        logger.exception("[models] get local model %s failed", local_model_id)
        return _err("internal", 500, detail=str(exc))
    if model is None:
        return _model_not_found(local_model_id)
    return jsonify(_public_model(model, detail=True))


@bp.route("/api/local_models/<int:local_model_id>/preview", methods=["GET"])
def api_local_model_preview(local_model_id: int):
    """Serve the preview image associated with a model ID."""
    try:
        model = _get_internal_model(local_model_id)
    except Exception as exc:
        logger.exception("[models] get preview metadata %s failed", local_model_id)
        return _err("internal", 500, detail=str(exc))
    if model is None:
        return _model_not_found(local_model_id)

    model_path = model.get("real_path")
    if not model_path:
        return _err("preview_not_found", 404, local_model_id=local_model_id)
    if not _path_in_managed_models(model_path):
        return _err("path_outside", 403)

    try:
        model_file = Path(model_path).resolve(strict=False)
        preview_file = _get_model_meta_store().local_preview_path(model_file)
    except (OSError, RuntimeError, TypeError, ValueError):
        return _err("path_outside", 403)

    # A preview belongs beside its model.  Resolving both paths also rejects a
    # symlink that points to a different directory.
    if (
        preview_file is None
        or preview_file.parent != model_file.parent
        or not _path_in_managed_models(preview_file)
    ):
        return _err("preview_not_found", 404, local_model_id=local_model_id)
    return send_file(preview_file)


@bp.route("/api/local_models/<int:local_model_id>/enrich", methods=["POST"])
def api_local_model_enrich(local_model_id: int):
    """Fetch CivitAI metadata by hash and update one indexed model row."""
    try:
        model = _get_internal_model(local_model_id)
    except Exception as exc:
        logger.exception("[models] get enrich target %s failed", local_model_id)
        return _err("internal", 500, detail=str(exc))
    if model is None:
        return _model_not_found(local_model_id)

    can_fetch, _ = _capabilities(model)
    if not can_fetch:
        return _err("not_in_comfy_dir", 403)

    real_path = model.get("real_path")
    if not real_path or not Path(real_path).is_file():
        return _err("file_not_found", 404)

    try:
        from ..services.civitai_resolver import enrich_model_by_hash

        result = enrich_model_by_hash(
            str(real_path), api_key=_get_api_key(), local_model_id=local_model_id
        )
    except Exception as exc:
        logger.exception("[models] enrich local model %s failed", local_model_id)
        return _err("internal", 500, detail=str(exc))

    if result is None:
        return _err("civitai_not_found", 404)

    _invalidate_generate_options()

    try:
        updated = _get_internal_model(local_model_id) or _as_dict(result)
    except Exception:
        updated = _as_dict(result)
    if not updated:
        return _err("internal", 500, detail="enrich did not return model metadata")
    response = _public_model(updated, detail=True)
    response["ok"] = True
    return jsonify(response)


@bp.route("/api/local_models/<int:local_model_id>", methods=["DELETE"])
def api_local_model_delete(local_model_id: int):
    """Delete one model file, preview and metadata row by ID."""
    try:
        model = _get_internal_model(local_model_id)
    except Exception as exc:
        logger.exception("[models] get delete target %s failed", local_model_id)
        return _err("internal", 500, detail=str(exc))
    if model is None:
        return _model_not_found(local_model_id)

    _, can_delete = _capabilities(model)
    if not can_delete:
        return _err("not_in_comfy_dir", 403)

    try:
        deleted = _get_model_meta_store().delete_model(local_model_id)
    except FileNotFoundError:
        return _err("file_not_found", 404)
    except PermissionError:
        return _err("not_in_comfy_dir", 403)
    except Exception as exc:
        logger.exception("[models] delete local model %s failed", local_model_id)
        return _err("internal", 500, detail=str(exc))

    deleted_paths = deleted or []
    _invalidate_generate_options()
    return jsonify({"ok": True, "deleted": list(deleted_paths)})

