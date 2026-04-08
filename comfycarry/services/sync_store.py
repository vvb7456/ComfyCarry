"""
ComfyCarry — Sync 持久化层

负责 sync_jobs 和 sync_job_events 两张表的读写。
被 sync_engine 调用，route 通过 store 查询历史。
"""

import json
import logging
import time

from ..db import db

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
#  Job CRUD
# ═══════════════════════════════════════════════════════════════

def create_job(job_id: str, *, trigger_type: str = "manual",
               trigger_ref: str = "", rule_count: int = 0) -> None:
    """创建新的 sync job 记录。"""
    now = time.time()
    db.execute(
        """INSERT INTO sync_jobs
               (job_id, trigger_type, trigger_ref, status, rule_count,
                started_at)
           VALUES (?, ?, ?, 'running', ?, ?)""",
        (job_id, trigger_type, trigger_ref, rule_count, now),
    )


def finish_job(job_id: str, *, status: str = "success",
               success_count: int = 0, failure_count: int = 0,
               files_synced: int = 0,
               summary: dict | None = None) -> None:
    """标记 job 完成 (success/failed/partial/cancelled)。"""
    now = time.time()
    summary_json = json.dumps(summary or {}, ensure_ascii=False)
    db.execute(
        """UPDATE sync_jobs SET
               status = ?, success_count = ?, failure_count = ?,
               files_synced = ?, summary_json = ?, finished_at = ?
           WHERE job_id = ?""",
        (status, success_count, failure_count, files_synced,
         summary_json, now, job_id),
    )


def update_job_progress(job_id: str, *,
                        success_count: int, failure_count: int) -> None:
    """增量更新运行中 job 的进度计数 (每条规则执行完后调用)。"""
    db.execute(
        """UPDATE sync_jobs SET success_count = ?, failure_count = ?
           WHERE job_id = ? AND status = 'running'""",
        (success_count, failure_count, job_id),
    )


def get_job(job_id: str) -> dict | None:
    """读取单个 job。"""
    row = db.fetch_one(
        "SELECT * FROM sync_jobs WHERE job_id = ?", (job_id,),
    )
    return _row_to_dict(row) if row else None


def get_recent_jobs(limit: int = 30) -> list[dict]:
    """读取最近 N 个 job (按开始时间倒序)。"""
    rows = db.fetch_all(
        "SELECT * FROM sync_jobs ORDER BY started_at DESC LIMIT ?",
        (limit,),
    )
    return [_row_to_dict(r) for r in rows]


def get_running_job() -> dict | None:
    """读取当前正在运行的 job (最多一个)。"""
    row = db.fetch_one(
        "SELECT * FROM sync_jobs WHERE status = 'running' "
        "ORDER BY started_at DESC LIMIT 1",
    )
    return _row_to_dict(row) if row else None


def delete_old_jobs(max_age_seconds: int = 7 * 86400) -> int:
    """清理超龄 job 及其关联 events。返回删除的 job 数。"""
    cutoff = time.time() - max_age_seconds
    # 先删 events
    db.execute(
        "DELETE FROM sync_job_events WHERE job_id IN "
        "(SELECT job_id FROM sync_jobs WHERE finished_at IS NOT NULL "
        "AND finished_at < ?)",
        (cutoff,),
    )
    cursor = db.execute(
        "DELETE FROM sync_jobs WHERE finished_at IS NOT NULL "
        "AND finished_at < ?",
        (cutoff,),
    )
    return cursor.rowcount


# ═══════════════════════════════════════════════════════════════
#  Event CRUD
# ═══════════════════════════════════════════════════════════════

def add_event(job_id: str, key: str, *, rule_id: str = "",
              level: str = "info", params: dict | None = None) -> None:
    """写入一条结构化事件。"""
    now = time.time()
    params_json = json.dumps(params or {}, ensure_ascii=False)
    db.execute(
        """INSERT INTO sync_job_events
               (job_id, rule_id, level, key, params_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (job_id, rule_id, level, key, params_json, now),
    )


def get_events(job_id: str, *, limit: int = 500,
               after_id: int = 0) -> list[dict]:
    """读取某个 job 的事件 (支持游标分页)。"""
    rows = db.fetch_all(
        "SELECT * FROM sync_job_events "
        "WHERE job_id = ? AND id > ? "
        "ORDER BY id ASC LIMIT ?",
        (job_id, after_id, limit),
    )
    return [_row_to_dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════

def _row_to_dict(row) -> dict:
    """sqlite3.Row → dict, 自动解析 *_json 字段。"""
    d = dict(row)
    for key in list(d.keys()):
        if key.endswith("_json"):
            try:
                d[key.removesuffix("_json")] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                d[key.removesuffix("_json")] = {}
            del d[key]
    return d
