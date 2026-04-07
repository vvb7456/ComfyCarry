"""
ComfyCarry — 提示词库数据初始化/导入

从预处理好的 SQLite 数据库导入标签和 Danbooru 数据。
该 DB 由离线脚本将 WeiLin 开源 SQL 数据转换而来，已包含全部处理:
  - ID 重分配 (自增整数外键)
  - 颜色转换 (rgba→hex)
  - 魔法系过滤
  - NSFW 合并
  - Danbooru 49K 标签

数据获取:
  - 生产环境: 从 GitHub Release 下载 DB 文件
  - 开发环境: data/ 目录下本地文件 (fallback)
"""

import hashlib
import logging
import sqlite3
import tempfile
from pathlib import Path

import requests

from ..db import db

log = logging.getLogger(__name__)

# 预处理 DB 路径 (仓库内)
_SCRIPT_DIR = Path(__file__).resolve().parent
_DATA_DB = _SCRIPT_DIR.parent.parent / "data" / "comfycarry-prompt-library.db"

# 远程下载
_DOWNLOAD_URL = "https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/data/comfycarry-prompt-library.db"
_DOWNLOAD_SHA256 = "651f6734acd96a3b684c99e1b5913c186cfb30ae94f4b5995c623be368735e6c"

# 导入表和字段映射
_IMPORT_TABLES = [
    {
        "source": "prompt_groups",
        "target": "prompt_groups",
        "columns": "id, name, translate, color, sort, is_nsfw",
    },
    {
        "source": "prompt_subgroups",
        "target": "prompt_subgroups",
        "columns": "id, group_id, name, translate, color, sort",
    },
    {
        "source": "prompt_tags",
        "target": "prompt_tags",
        "columns": "id, subgroup_id, text, translate, color, sort",
    },
    {
        "source": "danbooru_tags",
        "target": "danbooru_tags",
        "columns": "id, tag, translate, category, hot, color",
    },
]


def check_source() -> dict:
    """检查远程 DB 下载 URL 是否可用"""
    remote_ok = bool(_DOWNLOAD_URL)
    return {
        "available": remote_ok,
        "download_url": _DOWNLOAD_URL or None,
    }


def download_source(progress_cb=None) -> Path:
    """
    从 GitHub Release 下载预处理 DB 文件并写入本地缓存路径。
    每次调用都会重新下载覆盖。
    返回 DB 文件路径。
    """
    if not _DOWNLOAD_URL:
        raise RuntimeError("Download URL not configured")

    log.info("[prompt_library_init] Downloading from %s", _DOWNLOAD_URL)
    if progress_cb:
        progress_cb("downloading", 0, 1)

    # 流式下载到临时文件
    _DATA_DB.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd = tempfile.NamedTemporaryFile(
        dir=_DATA_DB.parent, suffix=".tmp", delete=False
    )
    tmp_path = Path(tmp_fd.name)

    try:
        resp = requests.get(_DOWNLOAD_URL, stream=True, timeout=120)
        resp.raise_for_status()

        sha = hashlib.sha256()
        for chunk in resp.iter_content(chunk_size=65536):
            tmp_fd.write(chunk)
            sha.update(chunk)
        tmp_fd.close()

        # SHA256 校验
        if _DOWNLOAD_SHA256:
            actual = sha.hexdigest()
            if actual != _DOWNLOAD_SHA256:
                raise RuntimeError(
                    f"SHA256 mismatch: expected {_DOWNLOAD_SHA256}, got {actual}"
                )
            log.info("[prompt_library_init] SHA256 verified")

        # 原子移动到目标路径
        tmp_path.rename(_DATA_DB)
        log.info("[prompt_library_init] Downloaded to %s", _DATA_DB)

        if progress_cb:
            progress_cb("downloaded", 1, 1)

        return _DATA_DB

    except Exception:
        # 清理失败的临时文件
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def import_all(progress_cb=None) -> dict:
    """
    从预处理 DB 一键导入全部数据。
    progress_cb(step: str, done: int, total: int)
    """
    if not _DATA_DB.is_file():
        raise FileNotFoundError(f"Prompt library data not found: {_DATA_DB}")

    src = sqlite3.connect(str(_DATA_DB), timeout=10)
    src.row_factory = sqlite3.Row

    try:
        total_steps = len(_IMPORT_TABLES)
        result = {}

        for i, spec in enumerate(_IMPORT_TABLES):
            table = spec["target"]
            columns = spec["columns"]
            step_name = table

            if progress_cb:
                progress_cb(step_name, i, total_steps)

            # 读取源数据
            rows = src.execute(
                f"SELECT {columns} FROM {spec['source']}"
            ).fetchall()

            # 清空目标表
            db.execute(f"DELETE FROM {table}")

            # 分批导入
            batch_size = 1000
            col_count = len(columns.split(","))
            placeholders = ",".join("?" * col_count)

            for start in range(0, len(rows), batch_size):
                batch = rows[start : start + batch_size]
                db.execute_many(
                    f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                    [tuple(r) for r in batch],
                )

            result[table] = len(rows)
            log.info("[prompt_library_init] %s: %d rows", table, len(rows))

        if progress_cb:
            progress_cb("done", total_steps, total_steps)

        # 写入导入完成标记
        db.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)",
            ("prompt_library_imported", "true"),
        )

        log.info("[prompt_library_init] Import complete: %s", result)
        return result

    finally:
        src.close()
