import logging
import time

from ..db import db

log = logging.getLogger(__name__)

T_GROUPS = "prompt_groups"
T_SUBGROUPS = "prompt_subgroups"
T_TAGS = "prompt_tags"
T_DANBOORU = "danbooru_tags"
T_HISTORY = "prompt_history"


def get_status() -> dict:
    groups = db.row_count(T_GROUPS) if db.table_exists(T_GROUPS) else 0
    tags = db.row_count(T_TAGS) if db.table_exists(T_TAGS) else 0
    danbooru = db.row_count(T_DANBOORU) if db.table_exists(T_DANBOORU) else 0
    history = 0
    if db.table_exists(T_HISTORY):
        row = db.fetch_one(
            f"SELECT COUNT(*) FROM {T_HISTORY} WHERE is_deleted=0"
        )
        history = row[0] if row else 0

    initialized = False
    if db.table_exists("app_meta"):
        row = db.fetch_one(
            "SELECT value FROM app_meta WHERE key = 'prompt_library_imported'"
        )
        initialized = row is not None and row[0] == "true"

    return {
        "initialized": initialized,
        "groups": groups,
        "tags": tags,
        "danbooru": danbooru,
        "history": history,
    }


def get_groups() -> list[dict]:
    rows = db.fetch_all(
        f"SELECT id, name, translate, color, is_nsfw FROM {T_GROUPS} ORDER BY sort, id"
    )
    return [dict(r) for r in rows]


def get_subgroups(group_id: int) -> list[dict]:
    rows = db.fetch_all(
        f"SELECT id, name, translate, color, group_id "
        f"FROM {T_SUBGROUPS} WHERE group_id=? ORDER BY sort, id",
        (group_id,),
    )
    return [dict(r) for r in rows]


def get_tags(subgroup_id: int) -> list[dict]:
    rows = db.fetch_all(
        f"SELECT pt.id, pt.text, pt.translate,"
        f"  COALESCE(NULLIF(pt.color,''), NULLIF(ps.color,''), NULLIF(pg.color,''), '') AS color,"
        f"  pt.subgroup_id "
        f"FROM {T_TAGS} pt "
        f"JOIN {T_SUBGROUPS} ps ON ps.id = pt.subgroup_id "
        f"JOIN {T_GROUPS} pg ON pg.id = ps.group_id "
        f"WHERE pt.subgroup_id=? ORDER BY pt.sort, pt.id",
        (subgroup_id,),
    )
    return [dict(r) for r in rows]


def get_tree() -> list[dict]:
    groups = get_groups()
    for g in groups:
        subs = get_subgroups(g["id"])
        for s in subs:
            s["tags"] = get_tags(s["id"])
        g["subgroups"] = subs
    return groups


def resolve_tags(texts: list[str]) -> dict[str, dict]:
    if not texts:
        return {}

    result: dict[str, dict] = {}
    remaining: list[str] = []

    placeholders = ",".join("?" * len(texts))
    rows = db.fetch_all(
        f"SELECT pt.text,"
        f"  COALESCE(NULLIF(pt.color,''), NULLIF(ps.color,''), NULLIF(pg.color,''), '') AS color,"
        f"  pt.translate "
        f"FROM {T_TAGS} pt "
        f"JOIN {T_SUBGROUPS} ps ON ps.id = pt.subgroup_id "
        f"JOIN {T_GROUPS} pg ON pg.id = ps.group_id "
        f"WHERE pt.text IN ({placeholders})",
        texts,
    )
    for r in rows:
        result[r["text"]] = {"color": r["color"], "translate": r["translate"]}

    for t in texts:
        if t not in result:
            remaining.append(t)

    if remaining:
        lookup = {}
        for t in remaining:
            lookup[t] = t
            underscore = t.replace(" ", "_")
            if underscore != t:
                lookup[underscore] = t

        placeholders2 = ",".join("?" * len(lookup))
        rows2 = db.fetch_all(
            f"SELECT tag, color, translate FROM danbooru_tags "
            f"WHERE tag IN ({placeholders2})",
            list(lookup.keys()),
        )
        for r in rows2:
            original = lookup.get(r["tag"], r["tag"])
            if original not in result:
                result[original] = {"color": r["color"], "translate": r["translate"]}

    return result


import math

_AUTOCOMPLETE_SQL_TAGS = """
    SELECT pt.text, pt.translate AS desc,
           COALESCE(NULLIF(pt.color,''), NULLIF(ps.color,''), NULLIF(pg.color,''), '') AS color,
           'library' AS source,
           COALESCE(dt.hot, 0) AS hot,
           CASE
               WHEN pt.text = ?                      THEN 6
               WHEN pt.text LIKE ? || '%'            THEN 5
               WHEN pt.text LIKE '%' || ? || '%'     THEN 4
               WHEN pt.translate = ?                  THEN 3
               WHEN pt.translate LIKE ? || '%'        THEN 2
               WHEN pt.translate LIKE '%' || ? || '%' THEN 1
               ELSE 0
           END AS match_tier
    FROM prompt_tags pt
    JOIN prompt_subgroups ps ON ps.id = pt.subgroup_id
    JOIN prompt_groups pg ON pg.id = ps.group_id
    LEFT JOIN danbooru_tags dt ON dt.tag = pt.text
    WHERE pt.text LIKE '%' || ? || '%'
       OR pt.translate  LIKE '%' || ? || '%'
    ORDER BY match_tier DESC, COALESCE(dt.hot, 0) DESC
    LIMIT ?
"""

_AUTOCOMPLETE_SQL_DANBOORU = """
    SELECT tag AS text, translate AS desc, color, 'danbooru' AS source,
           hot,
           CASE
               WHEN tag = ?                           THEN 6
               WHEN tag LIKE ? || '%'                 THEN 5
               WHEN tag LIKE '%' || ? || '%'          THEN 4
               WHEN translate = ?                      THEN 3
               WHEN translate LIKE ? || '%'            THEN 2
               WHEN translate LIKE '%' || ? || '%'     THEN 1
               ELSE 0
           END AS match_tier
    FROM danbooru_tags
    WHERE tag       LIKE '%' || ? || '%'
       OR translate LIKE '%' || ? || '%'
    ORDER BY match_tier DESC, hot DESC
    LIMIT ?
"""

_TIER_BASE = 100_000
_HOT_SCALE = 6400  # ln(6M+1) * 6400 ≈ 99862 < 100000
_LIBRARY_BOOST = 50000  # 精选标签库加成，确保零热度 library > 低热度 danbooru


def _rank_score(r: dict) -> int:
    tier = r.get("match_tier", 0)
    hot = r.get("hot", 0)
    hot_bonus = min(99999, int(math.log(hot + 1) * _HOT_SCALE))
    source_bonus = _LIBRARY_BOOST if r.get("source") == "library" else 0
    return tier * _TIER_BASE + source_bonus + hot_bonus - len(r["text"])


def autocomplete(query: str, limit: int = 20) -> list[dict]:
    query = query.strip()
    if not query or len(query) > 200:
        return []

    params_tags = (query, query, query, query, query, query, query, query, limit)
    tag_results = db.fetch_all(_AUTOCOMPLETE_SQL_TAGS, params_tags)
    results = [dict(r) for r in tag_results]
    seen = {r["text"] for r in results}

    remaining = limit - len(results)
    if remaining > 0:
        params_dan = (query, query, query, query, query, query, query, query, remaining)
        dan_results = db.fetch_all(_AUTOCOMPLETE_SQL_DANBOORU, params_dan)
        for r in dan_results:
            d = dict(r)
            if d["text"] not in seen:
                results.append(d)
                seen.add(d["text"])

    for r in results:
        r["score"] = _rank_score(r)
    results.sort(key=lambda x: x["score"], reverse=True)

    for r in results:
        r.pop("match_tier", None)

    return results[:limit]


def add_history(positive: str, negative: str = "", is_favorite: int = 0) -> int:
    recent = db.fetch_one(
        f"SELECT id, positive, negative, is_favorite FROM {T_HISTORY} "
        f"WHERE is_deleted=0 ORDER BY created_at DESC LIMIT 1"
    )
    if recent and recent["positive"] == positive and recent["negative"] == negative:
        if is_favorite and not recent["is_favorite"]:
            db.execute(
                f"UPDATE {T_HISTORY} SET is_favorite=1 WHERE id=?",
                (recent["id"],),
            )
        return recent["id"]

    cursor = db.execute(
        f"INSERT INTO {T_HISTORY} (positive, negative, is_favorite, created_at) "
        f"VALUES (?, ?, ?, ?)",
        (positive, negative, is_favorite, int(time.time())),
    )

    count_row = db.fetch_one(
        f"SELECT COUNT(*) FROM {T_HISTORY} WHERE is_deleted=0 AND is_favorite=0"
    )
    count = count_row[0] if count_row else 0
    if count > 500:
        excess = count - 500
        db.execute(
            f"UPDATE {T_HISTORY} SET is_deleted=1 "
            f"WHERE id IN ("
            f"  SELECT id FROM {T_HISTORY} WHERE is_deleted=0 AND is_favorite=0 "
            f"  ORDER BY created_at ASC LIMIT ?"
            f")",
            (excess,),
        )

    return cursor.lastrowid


def list_history(
    history_type: str = "all",
    page: int = 1,
    size: int = 20,
) -> dict:
    where = "WHERE is_deleted=0"
    params: list = []
    if history_type == "history":
        where += " AND is_favorite=0"
    elif history_type == "favorite":
        where += " AND is_favorite=1"

    count_row = db.fetch_one(f"SELECT COUNT(*) FROM {T_HISTORY} {where}", tuple(params))
    total = count_row[0] if count_row else 0

    offset = (max(1, page) - 1) * size
    rows = db.fetch_all(
        f"SELECT id, positive, negative, name, is_favorite, created_at "
        f"FROM {T_HISTORY} {where} "
        f"ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (*params, size, offset),
    )

    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "size": size,
    }


def update_history(history_id: int, **fields) -> bool:
    allowed = {"name", "is_favorite"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return False
    set_clause = ", ".join(f"{k}=?" for k in updates)
    params = list(updates.values()) + [history_id]
    db.execute(
        f"UPDATE {T_HISTORY} SET {set_clause} WHERE id=? AND is_deleted=0",
        tuple(params),
    )
    return True


def delete_history(history_id: int) -> bool:
    db.execute(
        f"UPDATE {T_HISTORY} SET is_deleted=1 WHERE id=?",
        (history_id,),
    )
    return True


def delete_history_batch(ids: list[int]) -> int:
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    cursor = db.execute(
        f"UPDATE {T_HISTORY} SET is_deleted=1 WHERE id IN ({placeholders})",
        tuple(ids),
    )
    return cursor.rowcount


def dump_history() -> list[dict]:
    """导出全部历史记录 (含已删除标记与 id), 供配置导出整体备份。"""
    rows = db.fetch_all(
        f"SELECT id, positive, negative, name, is_favorite, created_at, is_deleted "
        f"FROM {T_HISTORY} ORDER BY id"
    )
    return [dict(r) for r in rows]


def replace_history(rows: list[dict]) -> int:
    """整体覆盖历史记录 (导入语义即覆盖), 返回写入条数。"""
    db.execute(f"DELETE FROM {T_HISTORY}")
    count = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            raw_id = row.get("id")
            db.execute(
                f"INSERT INTO {T_HISTORY} "
                f"(id, positive, negative, name, is_favorite, created_at, is_deleted) "
                f"VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    int(raw_id) if raw_id else None,
                    str(row.get("positive", "") or ""),
                    str(row.get("negative", "") or ""),
                    str(row.get("name", "") or ""),
                    1 if row.get("is_favorite") else 0,
                    int(row.get("created_at") or 0),
                    1 if row.get("is_deleted") else 0,
                ),
            )
            count += 1
        except Exception as e:
            log.warning("[prompt_library] replace_history 跳过条目: %s", e)
    return count
