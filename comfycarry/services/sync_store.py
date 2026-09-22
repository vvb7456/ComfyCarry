"""
ComfyCarry — Sync 持久化层
"""

import json
import logging
import math
import time

from ..db import db

log = logging.getLogger(__name__)


def create_job(job_id: str, *, trigger_type: str = "manual",
               trigger_ref: str = "", rule_count: int = 0,
               rules: list[dict] | None = None,
               status: str = "running",
               queued_at: float | None = None) -> None:
    """rules 是本次执行规则的展示快照 (SyncJobRuleSnapshot 列表)。落库为
    rules_json, 规则后续被编辑/删除也不影响历史回看。

    status 默认保持 'running' (不经队列的直接执行); 'queued' 时才写
    queued_at, 并用入队时刻占位 started_at (执行员接手时覆盖为真实开始时间)。
    """
    now = time.time()
    rules_json = json.dumps(rules or [], ensure_ascii=False)
    queue_ts = None
    if status == "queued":
        queue_ts = queued_at if queued_at is not None else now
    db.execute(
        """INSERT INTO sync_jobs
               (job_id, trigger_type, trigger_ref, status, rule_count,
                rules_json, started_at, queued_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (job_id, trigger_type, trigger_ref, status, rule_count,
         rules_json, now, queue_ts),
    )


def mark_job_running(job_id: str) -> bool:
    """条件 UPDATE (WHERE status='queued') 是取消竞态安全的关键: 执行员
    「读 DB 判状态」与「真正开跑」之间存在窗口, cancel 接口可能已把行
    改成 cancelled; 无条件 UPDATE 会把行改回 running 继续执行。未命中
    (已被取消/停止清队) 时返回 False, 执行员据此跳过该任务且不改库。
    """
    cursor = db.execute(
        "UPDATE sync_jobs SET status = 'running', started_at = ? "
        "WHERE job_id = ? AND status = 'queued'",
        (time.time(), job_id),
    )
    return cursor.rowcount > 0


def cancel_queued_job(job_id: str) -> bool:
    """条件 UPDATE 保证只取消尚未开始执行的行; 执行中/已结束的行不命中。
    """
    cursor = db.execute(
        "UPDATE sync_jobs SET status = 'cancelled', finished_at = ? "
        "WHERE job_id = ? AND status = 'queued'",
        (time.time(), job_id),
    )
    return cursor.rowcount > 0


def cancel_all_queued_jobs() -> int:
    cursor = db.execute(
        "UPDATE sync_jobs SET status = 'cancelled', finished_at = ? "
        "WHERE status = 'queued'",
        (time.time(),),
    )
    return cursor.rowcount


def has_active_watch_job() -> bool:
    row = db.fetch_one(
        "SELECT 1 FROM sync_jobs WHERE trigger_type = 'watch' "
        "AND status IN ('queued', 'running') LIMIT 1",
    )
    return row is not None


def count_queued_jobs() -> int:
    row = db.fetch_one(
        "SELECT COUNT(*) FROM sync_jobs WHERE status = 'queued'",
    )
    return row[0] if row else 0


def reconcile_orphan_jobs() -> int:
    now = time.time()
    cursor = db.execute(
        "UPDATE sync_jobs SET status = 'interrupted', "
        "finished_at = COALESCE(finished_at, ?) "
        "WHERE status IN ('queued', 'running')",
        (now,),
    )
    return cursor.rowcount


def finish_job(job_id: str, *, status: str = "success",
               success_count: int = 0, failure_count: int = 0,
               files_synced: int = 0,
               summary: dict | None = None) -> None:
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
    db.execute(
        """UPDATE sync_jobs SET success_count = ?, failure_count = ?
           WHERE job_id = ? AND status = 'running'""",
        (success_count, failure_count, job_id),
    )


def get_job(job_id: str) -> dict | None:
    row = db.fetch_one(
        "SELECT * FROM sync_jobs WHERE job_id = ?", (job_id,),
    )
    return _row_to_dict(row) if row else None


def get_jobs_page(*, page: int = 1, limit: int = 5,
                  finished: bool = False) -> tuple[list[dict], int, int]:
    """finished=True 时只返回已结束的行, 供 Hero 取「上一条已完成任务」,
    避免新排序把排队任务顶到第一条。
    """
    where = "WHERE finished_at IS NOT NULL" if finished else ""
    row = db.fetch_one(f"SELECT COUNT(*) FROM sync_jobs {where}")
    total = row[0] if row else 0
    limit = max(int(limit), 1)
    page = max(int(page), 1)
    if total == 0:
        page = 1
    else:
        max_page = max(1, math.ceil(total / limit))
        if page > max_page:
            page = max_page
    offset = (page - 1) * limit
    rows = db.fetch_all(
        "SELECT * FROM sync_jobs "
        f"{where} "
        "ORDER BY "
        "CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, "
        "CASE WHEN status = 'queued' THEN queued_at ELSE NULL END ASC, "
        "CASE WHEN status = 'queued' THEN NULL ELSE started_at END DESC, "
        "job_id DESC "
        "LIMIT ? OFFSET ?",
        (limit, offset),
    )
    return [_row_to_dict(r) for r in rows], total, page


def delete_job(job_id: str) -> None:
    """删除 job 及其事件。watch 空跑 (零传输) 的任务不留档用。"""
    db.execute("DELETE FROM sync_job_events WHERE job_id = ?", (job_id,))
    db.execute("DELETE FROM sync_jobs WHERE job_id = ?", (job_id,))


def delete_old_jobs(max_age_seconds: int = 7 * 86400) -> int:
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


def add_event(job_id: str, key: str, *, rule_id: str = "",
              level: str = "info", params: dict | None = None) -> None:
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
    rows = db.fetch_all(
        "SELECT * FROM sync_job_events "
        "WHERE job_id = ? AND id > ? "
        "ORDER BY id ASC LIMIT ?",
        (job_id, after_id, limit),
    )
    return [_row_to_dict(r) for r in rows]


def _row_to_dict(row) -> dict:
    d = dict(row)
    for key in list(d.keys()):
        if key.endswith("_json"):
            try:
                d[key.removesuffix("_json")] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                # rules_json 是数组字段, 损坏时兜底为 []; 其余 ({}) 结构
                d[key.removesuffix("_json")] = [] if key == "rules_json" else {}
            del d[key]
    return d
