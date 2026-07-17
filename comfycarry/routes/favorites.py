"""
ComfyCarry — Favorites 路由

CivitAI 收藏 CRUD API (B 期 — 收藏后端化)。
全局 check_auth 已覆盖 /api/*, 此 blueprint 无独立鉴权逻辑。

端点:
  GET    /api/favorites                  → {"favorites": [...]}
  POST   /api/favorites                  → 单个收藏对象; 201
  POST   /api/favorites/bulk             → {"items": [...]}; 返回 {"imported": n}
  DELETE /api/favorites/<fav_key>        → 404 if 不存在
  DELETE /api/favorites?model_id=X       → remove_by_model
  DELETE /api/favorites                  → clear_favorites
"""

import logging

from flask import Blueprint, jsonify, request

from ..services import favorites_store as store

logger = logging.getLogger(__name__)

bp = Blueprint("favorites", __name__)

# 长度上限 (防超长字段入库)
_MAX_FIELD_LEN = 2048


def _clean_str(val, default: str = "") -> str:
    """str() 清洗 + 长度截断。"""
    if val is None:
        return default
    s = str(val)
    if len(s) > _MAX_FIELD_LEN:
        s = s[:_MAX_FIELD_LEN]
    return s


def _clean_all_versions(val) -> list:
    """all_versions 非 list 时置 [], 每项做最小清洗。"""
    if not isinstance(val, list):
        return []
    out = []
    for item in val:
        if isinstance(item, dict):
            out.append({
                "id": _clean_str(item.get("id")),
                "name": _clean_str(item.get("name")),
                "baseModel": _clean_str(item.get("baseModel")),
            })
        else:
            out.append({"id": _clean_str(item), "name": "", "baseModel": ""})
    return out


def _normalize_fav(data: dict) -> dict:
    """入参字段清洗 → dict 供 store.upsert_favorite 使用。"""
    return {
        "fav_key": _clean_str(data.get("fav_key")),
        "model_id": _clean_str(data.get("model_id")),
        "version_id": _clean_str(data.get("version_id")),
        "name": _clean_str(data.get("name")),
        "model_type": _clean_str(data.get("model_type")),
        "image_url": _clean_str(data.get("image_url")),
        "version_name": _clean_str(data.get("version_name")),
        "base_model": _clean_str(data.get("base_model")),
        "all_versions": _clean_all_versions(data.get("all_versions")),
    }


@bp.route("/api/favorites", methods=["GET"])
def api_favorites_list():
    """返回全部收藏, 按 created_at DESC。"""
    return jsonify({"favorites": store.list_favorites()})


@bp.route("/api/favorites", methods=["POST"])
def api_favorites_create():
    """创建/更新单条收藏。校验 model_id 必填; 201。"""
    data = request.get_json(silent=True) or {}
    fav = _normalize_fav(data)
    if not fav["model_id"]:
        return jsonify({"error": "model_id 必填"}), 400
    store.upsert_favorite(fav)
    # 重新读出 (含计算好的 fav_key)
    return jsonify({"ok": True, "favorite": fav}), 201


@bp.route("/api/favorites/bulk", methods=["POST"])
def api_favorites_bulk():
    """批量导入收藏。body = {"items": [...]}; 返回 {"imported": n}。"""
    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list):
        return jsonify({"error": "items 必须为数组"}), 400
    cleaned = [_normalize_fav(item) for item in items
               if isinstance(item, dict)]
    n = store.bulk_upsert(cleaned)
    return jsonify({"imported": n})


@bp.route("/api/favorites/<path:fav_key>", methods=["DELETE"])
def api_favorites_delete_one(fav_key: str):
    """删除单条收藏, 404 if 不存在。"""
    ok = store.remove_favorite(fav_key)
    if not ok:
        return jsonify({"error": "收藏不存在"}), 404
    return jsonify({"ok": True})


@bp.route("/api/favorites", methods=["DELETE"])
def api_favorites_delete():
    """按 model_id 删除 (remove_by_model); 无 model_id 时 clear_favorites。"""
    model_id = (request.args.get("model_id") or "").strip()
    if model_id:
        n = store.remove_by_model(model_id)
        return jsonify({"ok": True, "removed": n})
    n = store.clear_favorites()
    return jsonify({"ok": True, "cleared": n})
