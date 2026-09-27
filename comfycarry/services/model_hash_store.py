"""工作区文件指纹表：键为表一 files 中的原路径，值为实际文件的 SHA256。

辅助文件不一定进入模型索引；有索引的复用哈希缓存，其余直接读取文件。
导入后尚未补齐的文件保留原指纹，便于再次导出。
"""

import json
import os
import logging
from typing import Any

from ..db import db
from ..config import resolve_file_path

log = logging.getLogger(__name__)

KEY = "generate_model_hashes"
TABLE = "app_meta"
MODELS_TABLE = "models"


def referenced_paths(state: Any) -> set[str]:
    if not isinstance(state, dict):
        return set()
    model_states = state.get("modelStates")
    if not isinstance(model_states, dict):
        return set()
    return {
        file["path"] for model_state in model_states.values()
        if isinstance(model_state, dict)
        for file in model_state.get("files", [])
        if isinstance(file, dict) and isinstance(file.get("path"), str) and file["path"]
    }


def scan_model_hashes(state: Any) -> dict[str, str]:
    """表二直接以表一的原路径为键，不使用模型索引的分类路径。"""
    from ..utils import _sha256_file
    from .model_meta_store import get_or_compute_model_sha256

    result: dict[str, str] = {}
    indexed = db.table_exists(MODELS_TABLE)
    for path in referenced_paths(state):
        real_path = os.path.realpath(resolve_file_path(path))
        row = db.fetch_one("SELECT id FROM models WHERE real_path = ?", (real_path,)) if indexed else None
        sha = (get_or_compute_model_sha256(int(row["id"]), real_path, _sha256_file)
               if row else _sha256_file(real_path))
        if sha:
            result[path] = sha.upper()
    return result


def load_hashes() -> dict[str, str]:
    """读取指纹表; 无数据 / 损坏 / 非 object → {}。"""
    if not db.table_exists(TABLE):
        return {}
    row = db.fetch_one(f"SELECT value FROM {TABLE} WHERE key = ?", (KEY,))
    if row is None:
        return {}
    try:
        value = json.loads(row[0])
    except (ValueError, TypeError):
        log.warning("[model-hashes] 存储值 JSON 损坏, 按空表处理")
        return {}
    if not isinstance(value, dict):
        return {}
    return {str(k): str(v) for k, v in value.items() if isinstance(v, str)}


def replace_hashes(payload: object) -> dict[str, str]:
    """整体替换 (不合并)。非 object 按空表落库。"""
    value = payload if isinstance(payload, dict) else {}
    if not db.table_exists(TABLE):
        return {}
    db.execute(
        f"INSERT OR REPLACE INTO {TABLE} (key, value) VALUES (?, ?)",
        (KEY, json.dumps(value, ensure_ascii=False)),
    )
    return {str(k): str(v) for k, v in value.items() if isinstance(v, str)}


def export_hashes(state: Any) -> dict[str, str]:
    """只导出表一引用的原路径，缺失文件沿用相同路径下保存的指纹。"""
    paths = referenced_paths(state)
    merged = {path: sha for path, sha in load_hashes().items() if path in paths}
    for key, sha in scan_model_hashes(state).items():
        merged[key] = sha
    return merged
