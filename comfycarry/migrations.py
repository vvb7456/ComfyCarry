"""
ComfyCarry — 数据库 Schema 定义 (集中式)

所有表/索引在此注册为 migration。各业务模块只负责读写，不负责建表。
详细 DDL 设计见 docs/db-schema.md。

注意: migration 函数内 **禁止** 使用 executescript()，必须逐条 execute()。
"""

from .db import db

# ── Migration v1 — 全量建表 ─────────────────────────────────


def _migration_v1(conn):
    """创建项目全部核心表。"""
    stmts = [
        # ── 系统 ──
        """CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )""",

        # ── Prompt Library ──
        """CREATE TABLE IF NOT EXISTS prompt_groups (
            id        INTEGER PRIMARY KEY,
            name      TEXT NOT NULL,
            translate TEXT NOT NULL DEFAULT '',
            color     TEXT NOT NULL DEFAULT '',
            sort      INTEGER NOT NULL DEFAULT 0,
            is_nsfw   INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS prompt_subgroups (
            id        INTEGER PRIMARY KEY,
            group_id  INTEGER NOT NULL,
            name      TEXT NOT NULL,
            translate TEXT NOT NULL DEFAULT '',
            color     TEXT NOT NULL DEFAULT '',
            sort      INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS prompt_tags (
            id          INTEGER PRIMARY KEY,
            subgroup_id INTEGER NOT NULL,
            text        TEXT NOT NULL,
            translate   TEXT NOT NULL DEFAULT '',
            color       TEXT NOT NULL DEFAULT '',
            sort        INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS danbooru_tags (
            id        INTEGER PRIMARY KEY,
            tag       TEXT NOT NULL,
            translate TEXT NOT NULL DEFAULT '',
            category  INTEGER NOT NULL DEFAULT 0,
            hot       INTEGER NOT NULL DEFAULT 0,
            color     TEXT NOT NULL DEFAULT ''
        )""",
        """CREATE TABLE IF NOT EXISTS prompt_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            positive    TEXT NOT NULL DEFAULT '',
            negative    TEXT NOT NULL DEFAULT '',
            name        TEXT NOT NULL DEFAULT '',
            is_favorite INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            is_deleted  INTEGER NOT NULL DEFAULT 0
        )""",

        # ── Download — 任务 ──
        """CREATE TABLE IF NOT EXISTS download_tasks (
            task_id         TEXT PRIMARY KEY,
            resource_key    TEXT NOT NULL DEFAULT '',
            url             TEXT NOT NULL DEFAULT '',
            save_dir        TEXT NOT NULL DEFAULT '',
            filename        TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'queued',
            total_bytes     INTEGER NOT NULL DEFAULT 0,
            completed_bytes INTEGER NOT NULL DEFAULT 0,
            speed           INTEGER NOT NULL DEFAULT 0,
            progress        REAL NOT NULL DEFAULT 0,
            error           TEXT NOT NULL DEFAULT '',
            meta_json       TEXT NOT NULL DEFAULT '{}',
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL,
            completed_at    REAL
        )""",

        # ── Download — 资源 ──
        """CREATE TABLE IF NOT EXISTS download_resources (
            resource_key    TEXT PRIMARY KEY,
            source          TEXT NOT NULL,
            model_id        TEXT NOT NULL,
            version_id      TEXT NOT NULL,
            state           TEXT NOT NULL DEFAULT 'absent',
            active_task_id  TEXT NOT NULL DEFAULT '',
            last_error      TEXT NOT NULL DEFAULT '',
            meta_json       TEXT NOT NULL DEFAULT '{}',
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL,
            installed_at    REAL
        )""",

        # ── Model Index ──
        """CREATE TABLE IF NOT EXISTS models (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            filename            TEXT NOT NULL,
            category            TEXT NOT NULL,
            relative_path       TEXT NOT NULL,
            size_bytes          INTEGER NOT NULL DEFAULT 0,
            file_hash           TEXT NOT NULL DEFAULT '',
            name                TEXT NOT NULL DEFAULT '',
            base_model          TEXT NOT NULL DEFAULT '',
            civitai_model_id    TEXT NOT NULL DEFAULT '',
            civitai_version_id  TEXT NOT NULL DEFAULT '',
            trigger_words_json  TEXT NOT NULL DEFAULT '[]',
            metadata_json       TEXT NOT NULL DEFAULT '{}',
            preview_path        TEXT NOT NULL DEFAULT '',
            disk_modified_at    REAL NOT NULL DEFAULT 0,
            created_at          REAL NOT NULL,
            updated_at          REAL NOT NULL
        )""",

        # ── Prompt Library 索引 ──
        "CREATE INDEX IF NOT EXISTS idx_tags_subgroup      ON prompt_tags(subgroup_id)",
        "CREATE INDEX IF NOT EXISTS idx_subgroups_group     ON prompt_subgroups(group_id)",
        "CREATE INDEX IF NOT EXISTS idx_tags_text           ON prompt_tags(text)",
        "CREATE INDEX IF NOT EXISTS idx_danbooru_tag        ON danbooru_tags(tag)",
        "CREATE INDEX IF NOT EXISTS idx_danbooru_hot        ON danbooru_tags(hot DESC)",
        "CREATE INDEX IF NOT EXISTS idx_history_created     ON prompt_history(created_at DESC)",

        # ── Download 索引 ──
        "CREATE INDEX IF NOT EXISTS idx_dl_tasks_resource   ON download_tasks(resource_key)",
        "CREATE INDEX IF NOT EXISTS idx_dl_tasks_status     ON download_tasks(status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_dl_res_source       ON download_resources(source, model_id, version_id)",
        "CREATE INDEX IF NOT EXISTS idx_dl_res_state        ON download_resources(state, updated_at DESC)",

        # ── Model Index 索引 ──
        "CREATE INDEX IF NOT EXISTS idx_models_category     ON models(category)",
        "CREATE INDEX IF NOT EXISTS idx_models_civitai      ON models(civitai_model_id, civitai_version_id)",
        "CREATE INDEX IF NOT EXISTS idx_models_hash         ON models(file_hash)",

        # ── Model 唯一约束 ──
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_models_path   ON models(category, relative_path)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(1, _migration_v1, "core tables — prompt, download, model")


# ── Migration v2 — Sync Job/Event 模型 ──────────────────────


def _migration_v2(conn):
    """新增 sync_jobs + sync_job_events 表 (Phase C)。"""
    stmts = [
        # ── Sync Jobs ──
        """CREATE TABLE IF NOT EXISTS sync_jobs (
            job_id          TEXT PRIMARY KEY,
            trigger_type    TEXT NOT NULL DEFAULT 'manual',
            trigger_ref     TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'running',
            rule_count      INTEGER NOT NULL DEFAULT 0,
            success_count   INTEGER NOT NULL DEFAULT 0,
            failure_count   INTEGER NOT NULL DEFAULT 0,
            files_synced    INTEGER NOT NULL DEFAULT 0,
            summary_json    TEXT NOT NULL DEFAULT '{}',
            started_at      REAL NOT NULL,
            finished_at     REAL
        )""",

        # ── Sync Job Events ──
        """CREATE TABLE IF NOT EXISTS sync_job_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id          TEXT NOT NULL,
            rule_id         TEXT NOT NULL DEFAULT '',
            level           TEXT NOT NULL DEFAULT 'info',
            key             TEXT NOT NULL,
            params_json     TEXT NOT NULL DEFAULT '{}',
            created_at      REAL NOT NULL
        )""",

        # ── Sync 索引 ──
        "CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, started_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sync_jobs_started ON sync_jobs(started_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sync_events_job ON sync_job_events(job_id, id)",
        "CREATE INDEX IF NOT EXISTS idx_sync_events_created ON sync_job_events(created_at DESC)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(2, _migration_v2, "sync job/event model")
