"""
注意: migration 函数内 **禁止** 使用 executescript()，必须逐条 execute()。
"""

from .db import db


def _migration_v1(conn):
    stmts = [
        """CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )""",

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
            updated_at      REAL NOT NULL
        )""",

        """CREATE TABLE IF NOT EXISTS models (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            real_path             TEXT NOT NULL,
            filename              TEXT NOT NULL,
            category              TEXT NOT NULL,
            relative_path         TEXT NOT NULL,
            storage_type          TEXT NOT NULL DEFAULT 'primary',

            size_bytes            INTEGER NOT NULL DEFAULT 0,
            file_mtime            REAL NOT NULL DEFAULT 0,
            sha256                TEXT NOT NULL DEFAULT '',

            display_name          TEXT NOT NULL DEFAULT '',
            model_type            TEXT NOT NULL DEFAULT '',
            architecture          TEXT NOT NULL DEFAULT 'unknown',
            base_model            TEXT NOT NULL DEFAULT '',

            trigger_words_json    TEXT NOT NULL DEFAULT '[]',
            trigger_sources_json  TEXT NOT NULL DEFAULT '{}',

            source_type           TEXT NOT NULL DEFAULT '',
            source_model_id       TEXT NOT NULL DEFAULT '',
            source_version_id     TEXT NOT NULL DEFAULT '',
            source_version_name   TEXT NOT NULL DEFAULT '',

            details_json          TEXT NOT NULL DEFAULT '{}',
            has_info              INTEGER NOT NULL DEFAULT 0,

            created_at            REAL NOT NULL,
            updated_at            REAL NOT NULL
        )""",

        "CREATE INDEX IF NOT EXISTS idx_tags_subgroup      ON prompt_tags(subgroup_id)",
        "CREATE INDEX IF NOT EXISTS idx_subgroups_group     ON prompt_subgroups(group_id)",
        "CREATE INDEX IF NOT EXISTS idx_tags_text           ON prompt_tags(text)",
        "CREATE INDEX IF NOT EXISTS idx_danbooru_tag        ON danbooru_tags(tag)",
        "CREATE INDEX IF NOT EXISTS idx_danbooru_hot        ON danbooru_tags(hot DESC)",
        "CREATE INDEX IF NOT EXISTS idx_history_created     ON prompt_history(created_at DESC)",

        "CREATE INDEX IF NOT EXISTS idx_dl_tasks_resource   ON download_tasks(resource_key)",
        "CREATE INDEX IF NOT EXISTS idx_dl_tasks_status     ON download_tasks(status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_dl_res_source       ON download_resources(source, model_id, version_id)",
        "CREATE INDEX IF NOT EXISTS idx_dl_res_state        ON download_resources(state, updated_at DESC)",

        "CREATE INDEX IF NOT EXISTS idx_models_category     ON models(category)",
        "CREATE INDEX IF NOT EXISTS idx_models_source       ON models(source_type, source_model_id, source_version_id)",
        "CREATE INDEX IF NOT EXISTS idx_models_hash         ON models(sha256)",

        "CREATE UNIQUE INDEX IF NOT EXISTS uq_models_real_path ON models(real_path)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(1, _migration_v1, "core tables — prompt, download, model")


def _migration_v2(conn):
    stmts = [
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
            rules_json      TEXT NOT NULL DEFAULT '[]',
            started_at      REAL NOT NULL,
            finished_at     REAL
        )""",

        """CREATE TABLE IF NOT EXISTS sync_job_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id          TEXT NOT NULL,
            rule_id         TEXT NOT NULL DEFAULT '',
            level           TEXT NOT NULL DEFAULT 'info',
            key             TEXT NOT NULL,
            params_json     TEXT NOT NULL DEFAULT '{}',
            created_at      REAL NOT NULL
        )""",

        "CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, started_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sync_jobs_started ON sync_jobs(started_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sync_events_job ON sync_job_events(job_id, id)",
        "CREATE INDEX IF NOT EXISTS idx_sync_events_created ON sync_job_events(created_at DESC)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(2, _migration_v2, "sync job/event model")


def _migration_v3(conn):
    stmts = [
        """CREATE TABLE IF NOT EXISTS civitai_favorites (
            fav_key           TEXT PRIMARY KEY,
            model_id          TEXT NOT NULL,
            version_id        TEXT DEFAULT '',
            name              TEXT DEFAULT '',
            model_type        TEXT DEFAULT '',
            image_url         TEXT DEFAULT '',
            version_name      TEXT DEFAULT '',
            base_model        TEXT DEFAULT '',
            all_versions_json TEXT DEFAULT '[]',
            created_at        REAL NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_civitai_fav_model ON civitai_favorites(model_id)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(3, _migration_v3, "civitai favorites")


def _migration_v4(conn):
    stmts = [
        # 入队时刻; 仅 queued/cancelled 行有意义 (取消的行保留以便排查)
        "ALTER TABLE sync_jobs ADD COLUMN queued_at REAL",
        "CREATE INDEX IF NOT EXISTS idx_sync_jobs_queued "
        "ON sync_jobs(status, queued_at)",
    ]
    for sql in stmts:
        conn.execute(sql)


db.register_migration(4, _migration_v4, "sync job queue")


def _migration_v5(conn):
    """download_resources 结构收敛: 去掉 installed_at。

    该字段从未在任何界面显示, 也没有读取方。同时「已下载」不再由本表回答
    (改由磁盘现状派生, 见 services/resource_registry.resolve_state), 故一并去掉。

    用重建而非 ALTER 删列: v1 里的建表是 CREATE TABLE IF NOT EXISTS, 对已建过
    表的库不会生效 —— 结构变更必须落在新 migration 里, 否则旧库永远停在旧结构
    (曾因手工删表导致该表缺失、下载功能整体报错)。
    """
    conn.execute("DROP TABLE IF EXISTS download_resources")
    conn.execute("""
        CREATE TABLE download_resources (
            resource_key    TEXT PRIMARY KEY,
            source          TEXT NOT NULL,
            model_id        TEXT NOT NULL,
            version_id      TEXT NOT NULL,
            state           TEXT NOT NULL DEFAULT 'absent',
            active_task_id  TEXT NOT NULL DEFAULT '',
            last_error      TEXT NOT NULL DEFAULT '',
            meta_json       TEXT NOT NULL DEFAULT '{}',
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL
        )
    """)


db.register_migration(5, _migration_v5, "download resource state (drop installed_at)")
