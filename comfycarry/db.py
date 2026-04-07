"""
ComfyCarry — 统一 SQLite 数据库层

单一 .comfycarry.db 文件，WAL 模式，线程安全。
各模块通过 register_migration() 注册自己的表结构，
应用启动时 migrate() 按版本号顺序执行。
"""

import atexit
import logging
import sqlite3
import threading
from pathlib import Path

log = logging.getLogger(__name__)

DB_PATH = Path("/workspace/.comfycarry.db")


class Database:
    """统一 SQLite 管理 — 连接 + migration + 事务辅助"""

    def __init__(self, db_path: Path = DB_PATH):
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._migrations: dict[int, tuple[str, callable]] = {}  # {version: (name, up_fn)}
        atexit.register(self.close)

    # ── 连接管理 ────────────────────────────────────────────

    def _ensure_conn(self) -> sqlite3.Connection:
        """获取连接 (lazy init + WAL + PRAGMA)。调用者必须已持有 _lock。"""
        if self._conn is None:
            self._conn = sqlite3.connect(
                str(self._db_path),
                timeout=10,
                check_same_thread=False,
                isolation_level=None,  # 手动事务控制 (autocommit)
            )
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA cache_size=-2000")   # 2 MB
            self._conn.execute("PRAGMA busy_timeout=5000")   # 5s 重试
            self._conn.execute("PRAGMA foreign_keys=ON")
            # 确保 schema_version 表存在
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_version "
                "(version INTEGER PRIMARY KEY)"
            )
            log.info("[db] SQLite 连接已建立: %s (WAL)", self._db_path)
        return self._conn

    def close(self):
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn = None
                log.info("[db] SQLite 连接已关闭")

    # ── Migration ───────────────────────────────────────────

    def register_migration(self, version: int, up_fn: callable, name: str = ""):
        """注册一个 migration。version 必须唯一且递增。"""
        if version in self._migrations:
            raise ValueError(f"Migration v{version} 已注册: {self._migrations[version][0]}")
        self._migrations[version] = (name or f"migration_{version}", up_fn)

    def migrate(self):
        """按版本号顺序执行未应用的 migration。应在 app 启动时调用一次。"""
        if not self._migrations:
            return
        with self._lock:
            conn = self._ensure_conn()
            row = conn.execute(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version"
            ).fetchone()
            current = row[0]
            pending = sorted(v for v in self._migrations if v > current)
            if not pending:
                log.debug("[db] 数据库 schema 已是最新 (v%d)", current)
                return
            for v in pending:
                name, up_fn = self._migrations[v]
                log.info("[db] 执行 migration v%d: %s", v, name)
                try:
                    conn.execute("BEGIN")
                    up_fn(conn)
                    conn.execute(
                        "INSERT INTO schema_version (version) VALUES (?)", (v,)
                    )
                    conn.execute("COMMIT")
                except Exception:
                    conn.execute("ROLLBACK")
                    log.exception("[db] Migration v%d 失败, 已回滚", v)
                    raise
            log.info("[db] 数据库已迁移到 v%d", pending[-1])

    # ── 查询辅助 ────────────────────────────────────────────

    def execute(self, sql: str, params=()) -> sqlite3.Cursor:
        """执行单条 SQL (线程安全，写操作自动包事务)。"""
        with self._lock:
            conn = self._ensure_conn()
            is_write = not sql.lstrip().upper().startswith("SELECT")
            if is_write:
                conn.execute("BEGIN")
            try:
                cursor = conn.execute(sql, params)
                if is_write:
                    conn.execute("COMMIT")
                return cursor
            except Exception:
                if is_write:
                    conn.execute("ROLLBACK")
                raise

    def execute_many(self, sql: str, seq) -> sqlite3.Cursor:
        """批量插入 (线程安全)。"""
        with self._lock:
            conn = self._ensure_conn()
            conn.execute("BEGIN")
            try:
                cursor = conn.executemany(sql, seq)
                conn.execute("COMMIT")
                return cursor
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def fetch_one(self, sql: str, params=()) -> sqlite3.Row | None:
        """查询单行。"""
        with self._lock:
            conn = self._ensure_conn()
            return conn.execute(sql, params).fetchone()

    def fetch_all(self, sql: str, params=()) -> list[sqlite3.Row]:
        """查询多行。"""
        with self._lock:
            conn = self._ensure_conn()
            return conn.execute(sql, params).fetchall()

    def execute_script(self, sql: str):
        """执行多条 SQL (仅用于数据导入)。在事务中执行。
        注意: executescript() 会先隐式 COMMIT 已有事务，然后执行 SQL。
        我们用 BEGIN 包裹整个 script 来确保原子性。
        """
        with self._lock:
            conn = self._ensure_conn()
            # executescript 内部会先 COMMIT 任何挂起事务，
            # 再逐条执行。我们在 SQL 前后加 BEGIN/COMMIT 来包裹。
            wrapped = f"BEGIN;\n{sql}\nCOMMIT;"
            try:
                conn.executescript(wrapped)
            except Exception:
                try:
                    conn.execute("ROLLBACK")
                except Exception:
                    pass
                raise

    def get_schema_version(self) -> int:
        """获取当前 schema 版本号。"""
        row = self.fetch_one(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version"
        )
        return row[0] if row else 0

    def table_exists(self, table_name: str) -> bool:
        """检查表是否存在。"""
        row = self.fetch_one(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        )
        return row is not None

    def row_count(self, table_name: str) -> int:
        """获取表行数。表名由内部控制，不接受外部输入。"""
        # 防御: 只允许字母/数字/下划线的表名
        if not table_name.replace("_", "").isalnum():
            raise ValueError(f"非法表名: {table_name}")
        row = self.fetch_one(f"SELECT COUNT(*) FROM {table_name}")
        return row[0] if row else 0


# ── 全局单例 ────────────────────────────────────────────────
db = Database()
