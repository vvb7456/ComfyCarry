"""
ComfyCarry — 提示词库业务层

只读标签三层查询 + 自动补全 + 历史/收藏 CRUD。
翻译服务和数据初始化在后续模块中实现。
"""

import logging
import time

from ..db import db

log = logging.getLogger(__name__)

# ── 表名常量 ────────────────────────────────────────────────
T_GROUPS = "prompt_groups"
T_SUBGROUPS = "prompt_subgroups"
T_TAGS = "prompt_tags"
T_DANBOORU = "danbooru_tags"
T_HISTORY = "prompt_history"


# ── Migration — 注册到 db 层 ────────────────────────────────

def _migration_v1(conn):
    """创建提示词库核心表 + 索引 + app_meta。

    注意: 不能用 executescript() — 它会隐式 COMMIT 当前事务，
    破坏 db.migrate() 的事务包裹。必须逐条 execute()。
    """
    stmts = [
        """CREATE TABLE IF NOT EXISTS prompt_groups (
            id        INTEGER PRIMARY KEY,
            name      TEXT NOT NULL,
            translate TEXT DEFAULT '',
            color     TEXT DEFAULT '',
            sort      INTEGER DEFAULT 0,
            is_nsfw   INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS prompt_subgroups (
            id        INTEGER PRIMARY KEY,
            group_id  INTEGER NOT NULL,
            name      TEXT NOT NULL,
            translate TEXT DEFAULT '',
            color     TEXT DEFAULT '',
            sort      INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS prompt_tags (
            id          INTEGER PRIMARY KEY,
            subgroup_id INTEGER NOT NULL,
            text        TEXT NOT NULL,
            translate   TEXT DEFAULT '',
            color       TEXT DEFAULT '',
            sort        INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS danbooru_tags (
            id        INTEGER PRIMARY KEY,
            tag       TEXT NOT NULL,
            translate TEXT DEFAULT '',
            category  INTEGER DEFAULT 0,
            hot       INTEGER DEFAULT 0,
            color     TEXT DEFAULT ''
        )""",
        """CREATE TABLE IF NOT EXISTS prompt_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            positive    TEXT NOT NULL DEFAULT '',
            negative    TEXT NOT NULL DEFAULT '',
            name        TEXT DEFAULT '',
            is_favorite INTEGER DEFAULT 0,
            created_at  INTEGER NOT NULL,
            is_deleted  INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        )""",
        "CREATE INDEX IF NOT EXISTS idx_tags_subgroup ON prompt_tags(subgroup_id)",
        "CREATE INDEX IF NOT EXISTS idx_subgroups_group ON prompt_subgroups(group_id)",
        "CREATE INDEX IF NOT EXISTS idx_tags_text ON prompt_tags(text)",
        "CREATE INDEX IF NOT EXISTS idx_danbooru_tag ON danbooru_tags(tag)",
        "CREATE INDEX IF NOT EXISTS idx_danbooru_hot ON danbooru_tags(hot DESC)",
        "CREATE INDEX IF NOT EXISTS idx_history_created ON prompt_history(created_at DESC)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(1, _migration_v1, "prompt_library tables")


# ── 状态查询 ────────────────────────────────────────────────

def get_status() -> dict:
    """返回标签库初始化状态 + 各表行数"""
    groups = db.row_count(T_GROUPS) if db.table_exists(T_GROUPS) else 0
    tags = db.row_count(T_TAGS) if db.table_exists(T_TAGS) else 0
    danbooru = db.row_count(T_DANBOORU) if db.table_exists(T_DANBOORU) else 0
    history = 0
    if db.table_exists(T_HISTORY):
        row = db.fetch_one(
            f"SELECT COUNT(*) FROM {T_HISTORY} WHERE is_deleted=0"
        )
        history = row[0] if row else 0

    # 检查 app_meta 中的导入完成标记
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


# ── 标签库只读查询 ──────────────────────────────────────────

def get_groups() -> list[dict]:
    """获取所有一级分类"""
    rows = db.fetch_all(
        f"SELECT id, name, translate, color, is_nsfw FROM {T_GROUPS} ORDER BY sort, id"
    )
    return [dict(r) for r in rows]


def get_subgroups(group_id: int) -> list[dict]:
    """获取指定分类下的子分类"""
    rows = db.fetch_all(
        f"SELECT id, name, translate, color, group_id "
        f"FROM {T_SUBGROUPS} WHERE group_id=? ORDER BY sort, id",
        (group_id,),
    )
    return [dict(r) for r in rows]


def get_tags(subgroup_id: int) -> list[dict]:
    """获取指定子分类下的标签（颜色继承: tag → subgroup → group）"""
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
    """获取完整三层树形结构"""
    groups = get_groups()
    for g in groups:
        subs = get_subgroups(g["id"])
        for s in subs:
            s["tags"] = get_tags(s["id"])
        g["subgroups"] = subs
    return groups


def resolve_tags(texts: list[str]) -> dict[str, dict]:
    """
    批量解析 tag 文本 → {color, translate}。
    先查 prompt_tags（含颜色继承），再查 danbooru_tags 补充。
    返回 {text: {color, translate}} 字典，未匹配的 text 不包含在结果中。
    """
    if not texts:
        return {}

    result: dict[str, dict] = {}
    remaining: list[str] = []

    # Pass 1: prompt_tags (颜色继承)
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

    # 找出未匹配的 (也尝试下划线形式)
    for t in texts:
        if t not in result:
            remaining.append(t)

    # Pass 2: danbooru_tags 补充
    if remaining:
        # 尝试原始形式和下划线形式
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


# ── 自动补全 ────────────────────────────────────────────────

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

# Tier-based scoring: tier × 100000 + log_hot_bonus - length
# hot_bonus 范围 0~99999，永远无法跨越 tier
_TIER_BASE = 100_000
_HOT_SCALE = 6400  # ln(6M+1) * 6400 ≈ 99862 < 100000
_LIBRARY_BOOST = 50000  # 精选标签库加成，确保零热度 library > 低热度 danbooru


def _rank_score(r: dict) -> int:
    """
    计算最终排序分数:
      tier × 100000 + library_boost + ln(hot+1)*6400 - len(text)

    library_boost 确保精选标签在同 tier 内排在大多数 danbooru 标签前面，
    除非 danbooru 标签真的非常热门 (hot > ~2400 时 hot_bonus 才超过 50000)。
    """
    tier = r.get("match_tier", 0)
    hot = r.get("hot", 0)
    hot_bonus = min(99999, int(math.log(hot + 1) * _HOT_SCALE))
    source_bonus = _LIBRARY_BOOST if r.get("source") == "library" else 0
    return tier * _TIER_BASE + source_bonus + hot_bonus - len(r["text"])


def autocomplete(query: str, limit: int = 20) -> list[dict]:
    """
    多级匹配度自动补全。先查 prompt_tags，不足时补充 danbooru_tags。
    返回 [{text, desc, color, source, score, hot}]，按综合评分降序，最多 limit 条。

    评分公式: match_tier × 100000 + library_boost + ln(hot+1) × 6400 - len(text)
    - match_tier 决定大数量级 (相关性优先)
    - library_boost 精选标签库加成 50000 (精选标签 > 大部分 danbooru)
    - ln(hot) 在同 tier 内按热度排序 (对数压缩，高热度不会碾压)
    - len(text) 微调同热度时短名优先
    """
    query = query.strip()
    if not query or len(query) > 200:
        return []

    # Pass 1: 用户标签库
    params_tags = (query, query, query, query, query, query, query, query, limit)
    tag_results = db.fetch_all(_AUTOCOMPLETE_SQL_TAGS, params_tags)
    results = [dict(r) for r in tag_results]
    seen = {r["text"] for r in results}

    # Pass 2: Danbooru 补充
    remaining = limit - len(results)
    if remaining > 0:
        params_dan = (query, query, query, query, query, query, query, query, remaining)
        dan_results = db.fetch_all(_AUTOCOMPLETE_SQL_DANBOORU, params_dan)
        for r in dan_results:
            d = dict(r)
            if d["text"] not in seen:
                results.append(d)
                seen.add(d["text"])

    # 计算最终分数并排序
    for r in results:
        r["score"] = _rank_score(r)
    results.sort(key=lambda x: x["score"], reverse=True)

    # 清理内部字段
    for r in results:
        r.pop("match_tier", None)

    return results[:limit]


# ── 历史 / 收藏 ────────────────────────────────────────────

def add_history(positive: str, negative: str = "") -> int:
    """新增一条历史记录，返回 id"""
    cursor = db.execute(
        f"INSERT INTO {T_HISTORY} (positive, negative, created_at) VALUES (?, ?, ?)",
        (positive, negative, int(time.time())),
    )
    return cursor.lastrowid


def list_history(
    history_type: str = "all",
    page: int = 1,
    size: int = 20,
) -> dict:
    """
    分页查询历史/收藏。
    history_type: "all" | "history" | "favorite"
    返回 {items: [...], total: int, page: int, size: int}
    """
    where = "WHERE is_deleted=0"
    params: list = []
    if history_type == "history":
        where += " AND is_favorite=0"
    elif history_type == "favorite":
        where += " AND is_favorite=1"

    # 总数
    count_row = db.fetch_one(f"SELECT COUNT(*) FROM {T_HISTORY} {where}", tuple(params))
    total = count_row[0] if count_row else 0

    # 分页
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
    """更新历史记录 (支持 name, is_favorite 字段)"""
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
    """软删除一条历史记录"""
    db.execute(
        f"UPDATE {T_HISTORY} SET is_deleted=1 WHERE id=?",
        (history_id,),
    )
    return True


def delete_history_batch(ids: list[int]) -> int:
    """批量软删除，返回影响行数"""
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    cursor = db.execute(
        f"UPDATE {T_HISTORY} SET is_deleted=1 WHERE id IN ({placeholders})",
        tuple(ids),
    )
    return cursor.rowcount
