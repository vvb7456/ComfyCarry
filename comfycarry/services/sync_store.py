"""
ComfyCarry — Sync 持久化层

负责 sync_jobs 和 sync_job_events 两张表的读写。
被 sync_engine 调用，route 通过 store 查询历史。
"""

import json
import logging
import math
import time

from ..db import db

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
#  Job CRUD
# ═══════════════════════════════════════════════════════════════

def create_job(job_id: str, *, trigger_type: str = "manual",
               trigger_ref: str = "", rule_count: int = 0,
               rules: list[dict] | None = None,
               status: str = "running",
               queued_at: float | None = None) -> None:
    """创建新的 sync job 记录。

    rules 是本次执行规则的展示快照 (SyncJobRuleSnapshot 列表)。落库为
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
    """把排队中的 job 置为 running 并覆盖 started_at 为真实开始时刻。

    条件 UPDATE (WHERE status='queued') 是取消竞态安全的关键: 执行员
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
    """取消排队中的 job (queued_at 保留)。返回是否命中。

    条件 UPDATE 保证只取消尚未开始执行的行; 执行中/已结束的行不命中。
    """
    cursor = db.execute(
        "UPDATE sync_jobs SET status = 'cancelled', finished_at = ? "
        "WHERE job_id = ? AND status = 'queued'",
        (time.time(), job_id),
    )
    return cursor.rowcount > 0


def cancel_all_queued_jobs() -> int:
    """把所有排队中的 job 置为 cancelled (用户「停止」清队)。返回行数。"""
    cursor = db.execute(
        "UPDATE sync_jobs SET status = 'cancelled', finished_at = ? "
        "WHERE status = 'queued'",
        (time.time(),),
    )
    return cursor.rowcount


def has_active_watch_job() -> bool:
    """是否存在排队中或执行中的 watch 任务 (供 watch 调度去重)。"""
    row = db.fetch_one(
        "SELECT 1 FROM sync_jobs WHERE trigger_type = 'watch' "
        "AND status IN ('queued', 'running') LIMIT 1",
    )
    return row is not None


def count_queued_jobs() -> int:
    """排队中的 job 数。"""
    row = db.fetch_one(
        "SELECT COUNT(*) FROM sync_jobs WHERE status = 'queued'",
    )
    return row[0] if row else 0


def reconcile_orphan_jobs() -> int:
    """启动对账: 把进程重启前残留的 queued/running 任务置为 interrupted。

    finished_at 原本为空时补 now。返回处理的行数 (便于日志)。
    """
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


def get_jobs_page(*, page: int = 1, limit: int = 5,
                  finished: bool = False) -> tuple[list[dict], int, int]:
    """分页读取 job。返回 (jobs, total, 归一化后的 page)。

    - finished=True 只返回已结束 (finished_at IS NOT NULL) 的行, 供 Hero
      取「上一条已完成任务」, 避免新排序把排队任务顶到第一条。
    - 排序三层: running 最前; 其次 queued (按 queued_at ASC, 先入队在上);
      其余按 started_at DESC (新在上); job_id DESC 兜底。
    - page / limit 小于 1 时兜底为 1; 超出末页归一化到最后一页。
    - 空集合 page 固定为 1。
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
                # rules_json 是数组字段, 损坏时兜底为 []; 其余 ({}) 结构
                d[key.removesuffix("_json")] = [] if key == "rules_json" else {}
            del d[key]
    return d
