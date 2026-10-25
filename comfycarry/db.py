"""
ComfyCarry — 统一 SQLite 数据库层

单一 .comfycarry.db 文件，WAL 模式，线程安全。
应用启动时 initialize() 创建当前完整表结构。
"""

import atexit
import logging
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from .config import WORKSPACE_ROOT

log = logging.getLogger(__name__)

DB_PATH = WORKSPACE_ROOT / ".comfycarry.db"


class Database:

    def __init__(self, db_path: str | Path = DB_PATH):
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        atexit.register(self.close)

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

    def initialize(self):
        from .schema import create_schema

        with self.transaction() as conn:
            create_schema(conn)

    @contextmanager
    def transaction(self):
        with self._lock:
            conn = self._ensure_conn()
            conn.execute("BEGIN")
            try:
                yield conn
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def execute(self, sql: str, params=()) -> sqlite3.Cursor:
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
        with self._lock:
            conn = self._ensure_conn()
            return conn.execute(sql, params).fetchone()

    def fetch_all(self, sql: str, params=()) -> list[sqlite3.Row]:
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

    def row_count(self, table_name: str) -> int:
        """获取表行数。表名由内部控制，不接受外部输入。"""
        # 防御: 只允许字母/数字/下划线的表名
        if not table_name.replace("_", "").isalnum():
            raise ValueError(f"非法表名: {table_name}")
        row = self.fetch_one(f"SELECT COUNT(*) FROM {table_name}")
        return row[0] if row else 0


db = Database()
