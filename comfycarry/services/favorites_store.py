"""
ComfyCarry — CivitAI 收藏持久化层

负责 civitai_favorites 表的读写。被 routes/favorites.py 调用。
风格照 download_store.py (from ..db import db, 纯函数)。
"""

import json
import logging
import time

from ..db import db

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
#  Favorites CRUD
# ═══════════════════════════════════════════════════════════════

def list_favorites() -> list[dict]:
    """读取全部收藏, 按 created_at DESC; all_versions_json 反序列化为 all_versions。"""
    rows = db.fetch_all(
        "SELECT * FROM civitai_favorites ORDER BY created_at DESC"
    )
    return [_row_to_dict(r) for r in rows]


def upsert_favorite(fav: dict) -> None:
    """插入或更新单条收藏; created_at 保留首次值 (存在时不覆盖)。

    fav 必填字段: model_id。可选: version_id, name, model_type, image_url,
    version_name, base_model, all_versions (list[dict])。
    若 fav_key 缺失则按 model_id / version_id 计算。
    """
    fav_key = _compute_fav_key(fav)
    av = fav.get("all_versions")
    if not isinstance(av, list):
        av = []
    all_versions_json = json.dumps(av, ensure_ascii=False)
    now = time.time()
    # INSERT OR REPLACE, created_at 用 COALESCE 保留首次值
    db.execute(
        """INSERT INTO civitai_favorites
               (fav_key, model_id, version_id, name, model_type,
                image_url, version_name, base_model, all_versions_json,
                created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(fav_key) DO UPDATE SET
                model_id            = excluded.model_id,
                version_id          = excluded.version_id,
                name                = excluded.name,
                model_type          = excluded.model_type,
                image_url           = excluded.image_url,
                version_name        = excluded.version_name,
                base_model          = excluded.base_model,
                all_versions_json   = excluded.all_versions_json,
                created_at          = civitai_favorites.created_at
        """,
        (fav_key,
         str(fav.get("model_id", "")),
         str(fav.get("version_id", "") or ""),
         str(fav.get("name", "") or ""),
         str(fav.get("model_type", "") or ""),
         str(fav.get("image_url", "") or ""),
         str(fav.get("version_name", "") or ""),
         str(fav.get("base_model", "") or ""),
         all_versions_json,
         now),
    )


def remove_favorite(fav_key: str) -> bool:
    """删除单条收藏, 返回是否删到。"""
    cursor = db.execute(
        "DELETE FROM civitai_favorites WHERE fav_key = ?",
        (fav_key,),
    )
    return cursor.rowcount > 0


def remove_by_model(model_id: str) -> int:
    """删除某 model 的全部收藏 (前端 toggleCart 按 model 整体移除语义), 返回删除数。"""
    cursor = db.execute(
        "DELETE FROM civitai_favorites WHERE model_id = ?",
        (str(model_id),),
    )
    return cursor.rowcount


def clear_favorites() -> int:
    """清空收藏表, 返回删除数。"""
    cursor = db.execute("DELETE FROM civitai_favorites")
    return cursor.rowcount


def bulk_upsert(favs: list[dict]) -> int:
    """批量 upsert, 供前端 localStorage 迁移一次性导入, 返回处理条数。"""
    count = 0
    for fav in favs:
        try:
            upsert_favorite(fav)
            count += 1
        except Exception as e:
            log.warning("[favorites] bulk_upsert 跳过条目: %s", e)
    return count


# ═══════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════

def _compute_fav_key(fav: dict) -> str:
    """计算 fav_key — "modelId" 或 "modelId:versionId" (同前端 cartKey)。"""
    key = fav.get("fav_key")
    if key:
        return str(key)
    model_id = str(fav.get("model_id", ""))
    version_id = fav.get("version_id", "")
    if version_id:
        return f"{model_id}:{version_id}"
    return model_id


def _row_to_dict(row) -> dict:
    """将 sqlite3.Row 转换为普通 dict, 并解析 all_versions_json。"""
    d = dict(row)
    raw = d.pop("all_versions_json", "[]")
    try:
        d["all_versions"] = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        d["all_versions"] = []
    return d
