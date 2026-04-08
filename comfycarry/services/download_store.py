"""
ComfyCarry — Download 持久化层

负责 download_tasks 和 download_resources 两张表的读写。
被 resource_registry 和 download_engine 调用，route 不直接访问。
"""

import json
import logging
import time

from ..db import db

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
#  Resource CRUD
# ═══════════════════════════════════════════════════════════════

def upsert_resource(resource_key: str, source: str, model_id: str,
                    version_id: str, state: str, *,
                    active_task_id: str = "",
                    last_error: str = "",
                    meta: dict | None = None,
                    installed_at: float | None = None) -> None:
    """插入或更新 download_resources 记录。"""
    now = time.time()
    meta_json = json.dumps(meta or {}, ensure_ascii=False)
    db.execute(
        """INSERT INTO download_resources
               (resource_key, source, model_id, version_id, state,
                active_task_id, last_error, meta_json,
                created_at, updated_at, installed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(resource_key) DO UPDATE SET
               state = excluded.state,
               active_task_id = excluded.active_task_id,
               last_error = excluded.last_error,
               meta_json = CASE WHEN excluded.meta_json != '{}' THEN excluded.meta_json
                                ELSE download_resources.meta_json END,
               updated_at = excluded.updated_at,
               installed_at = COALESCE(excluded.installed_at, download_resources.installed_at)
        """,
        (resource_key, source, model_id, version_id, state,
         active_task_id, last_error, meta_json,
         now, now, installed_at),
    )


def get_resource(resource_key: str) -> dict | None:
    """读取单条 resource，返回 dict 或 None。"""
    row = db.fetch_one(
        "SELECT * FROM download_resources WHERE resource_key = ?",
        (resource_key,),
    )
    return _row_to_dict(row) if row else None


def get_all_resources() -> list[dict]:
    """读取所有非 absent 状态的 resource。"""
    rows = db.fetch_all(
        "SELECT * FROM download_resources WHERE state != 'absent' "
        "ORDER BY updated_at DESC",
    )
    return [_row_to_dict(r) for r in rows]


def delete_resource(resource_key: str) -> None:
    """删除 resource 记录。"""
    db.execute("DELETE FROM download_resources WHERE resource_key = ?",
               (resource_key,))


# ═══════════════════════════════════════════════════════════════
#  Task CRUD
# ═══════════════════════════════════════════════════════════════

def upsert_task(task_id: str, *, resource_key: str = "",
                url: str = "", save_dir: str = "", filename: str = "",
                status: str = "queued",
                total_bytes: int = 0, completed_bytes: int = 0,
                speed: int = 0, progress: float = 0,
                error: str = "", meta: dict | None = None,
                completed_at: float | None = None) -> None:
    """插入或更新 download_tasks 记录。"""
    now = time.time()
    meta_json = json.dumps(meta or {}, ensure_ascii=False)
    db.execute(
        """INSERT INTO download_tasks
               (task_id, resource_key, url, save_dir, filename, status,
                total_bytes, completed_bytes, speed, progress,
                error, meta_json, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(task_id) DO UPDATE SET
               status = excluded.status,
               total_bytes = excluded.total_bytes,
               completed_bytes = excluded.completed_bytes,
               speed = excluded.speed,
               progress = excluded.progress,
               error = excluded.error,
               updated_at = excluded.updated_at,
               completed_at = COALESCE(excluded.completed_at, download_tasks.completed_at)
        """,
        (task_id, resource_key, url, save_dir, filename, status,
         total_bytes, completed_bytes, speed, progress,
         error, meta_json, now, now, completed_at),
    )


def get_task(task_id: str) -> dict | None:
    """读取单条 task。"""
    row = db.fetch_one(
        "SELECT * FROM download_tasks WHERE task_id = ?",
        (task_id,),
    )
    return _row_to_dict(row) if row else None


def get_recent_tasks(limit: int = 100) -> list[dict]:
    """读取最近 N 条 task (按创建时间倒序)。"""
    rows = db.fetch_all(
        "SELECT * FROM download_tasks ORDER BY created_at DESC LIMIT ?",
        (limit,),
    )
    return [_row_to_dict(r) for r in rows]


def get_tasks_by_resource(resource_key: str) -> list[dict]:
    """读取某个 resource 的所有关联 task。"""
    rows = db.fetch_all(
        "SELECT * FROM download_tasks WHERE resource_key = ? "
        "ORDER BY created_at DESC",
        (resource_key,),
    )
    return [_row_to_dict(r) for r in rows]


def delete_task(task_id: str) -> None:
    """删除单条 task。"""
    db.execute("DELETE FROM download_tasks WHERE task_id = ?", (task_id,))


def clear_terminal_tasks(max_age_seconds: int = 86400) -> int:
    """清除超过 max_age 的终态任务，返回删除行数。"""
    cutoff = time.time() - max_age_seconds
    cursor = db.execute(
        "DELETE FROM download_tasks "
        "WHERE status IN ('complete', 'failed', 'cancelled') "
        "AND updated_at < ?",
        (cutoff,),
    )
    return cursor.rowcount


# ═══════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════

def _row_to_dict(row) -> dict:
    """将 sqlite3.Row 转换为普通 dict，并解析 *_json 字段。"""
    d = dict(row)
    for key in list(d.keys()):
        if key.endswith("_json"):
            try:
                d[key.removesuffix("_json")] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                d[key.removesuffix("_json")] = {}
            del d[key]
    return d
