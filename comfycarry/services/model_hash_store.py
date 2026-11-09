"""工作区文件指纹表：键为表一 files 中的原路径，值为实际文件的 SHA256。

所有本地文件均通过 models 表统一维护与缓存 SHA256。
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
    """表二直接以表一的原路径为键，统一通过模型索引表读取或计算并缓存哈希。"""
    from ..utils import _sha256_file
    from .model_meta_store import (
        get_or_compute_model_sha256,
        reconcile_model_index,
        register_downloaded_model,
    )

    paths = referenced_paths(state)
    if not paths:
        return {}

    reconciled = False
    result: dict[str, str] = {}
    for path in paths:
        real_path = os.path.realpath(resolve_file_path(path))
        row = db.fetch_one("SELECT id FROM models WHERE real_path = ?", (real_path,))
        if not row and os.path.isfile(real_path):
            if not reconciled:
                reconcile_model_index(min_interval=0)
                reconciled = True
                row = db.fetch_one("SELECT id FROM models WHERE real_path = ?", (real_path,))
            if row:
                model_id = int(row["id"])
            else:
                detail = register_downloaded_model(real_path, "auxiliary", {}, "", [])
                model_id = int(detail["id"]) if detail.get("id") is not None else None
        else:
            model_id = int(row["id"]) if row else None
        if model_id is None:
            continue
        sha = get_or_compute_model_sha256(model_id, real_path, _sha256_file)
        if sha:
            result[path] = sha.upper()
    return result


def load_hashes() -> dict[str, str]:
    """读取指纹表; 无数据 / 损坏 / 非 object → {}。"""
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
