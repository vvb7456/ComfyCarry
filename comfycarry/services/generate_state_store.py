"""内容生成工作区状态的持久层。

单一真相源: 服务端 app_meta 里的一个 JSON 值 (key=generate_state)。
前端 ModelState envelope 原样存取；服务端校验文件地址格式，
生成参数的校验留在前端 (frontend/src/stores/generate.ts 的 restore 链)。

只守结构不变量 (契约见 tests/test_generate_state.py):
  - body 为 object
  - _version 为非 bool 的 int 且 >= 1
  - modelStates 为 object
  - files 中的地址显式声明根目录或使用绝对路径
  - 序列化后体积 <= MAX_BYTES

刻意不校验 activeTask / activeModelTypeByTask: 它们属前端内部状态, 任务类型
会演进 (edit 任务已在 UI 占位), 服务端白名单会随前端改动失效。

写入语义 = 按架构合并 (对齐 ComfyUI app_settings 的读-改-写):
  - modelStates 按顶层架构键浅合并 —— 前端只提交本次改动的架构 (增量),
    因此多设备分别编辑不同架构时互不覆盖;
  - 同一架构内仍是后写入者覆盖 (不做字段级冲突合并);
  - 顶层字段 (当前任务/架构指针) 后写入者覆盖, 未提交的保留。
"""

import json
import logging
import time
from typing import Any

from ..db import db
from ..config import normalize_file_path, FilePathError

log = logging.getLogger(__name__)

KEY = "generate_state"
TABLE = "app_meta"

# 工作区状态体积上限 (序列化后字节数)。参考图只存文件名, 提示词是主要变量;
# 1 MiB 远高于真实用量, 同时挡住异常 payload 把 DB 写爆。
MAX_BYTES = 1024 * 1024


def _serialized_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def validate(payload: Any) -> tuple[dict | None, tuple[str, dict] | None]:
    """校验 envelope。返回 (值, None) 或 (None, (error_key, params))。

    仅守结构不变量，具体生成参数由前端管理。
    """
    if not isinstance(payload, dict):
        return None, ("state_invalid_payload", {})

    version = payload.get("_version")
    # bool 是 int 的子类, 必须显式排除
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        return None, ("state_invalid_version", {})

    if not isinstance(payload.get("modelStates"), dict):
        return None, ("state_invalid_model_states", {})

    for state in payload["modelStates"].values():
        if not isinstance(state, dict) or "files" not in state:
            continue
        if not isinstance(state["files"], list):
            return None, ("state_invalid_file_path", {})
        for file in state["files"]:
            try:
                normalize_file_path(file.get("path") if isinstance(file, dict) else None)
            except FilePathError:
                return None, ("state_invalid_file_path", {})

    if _serialized_size(payload) > MAX_BYTES:
        return None, ("state_too_large", {"limit_bytes": MAX_BYTES})

    return payload, None


def merge_state(existing: Any, incoming: dict) -> dict:
    """把增量 incoming 合并进 existing。

    - 顶层: incoming 覆盖同名键, 未提交的字段保留。
    - modelStates: 按架构键浅合并 —— 未提交的架构保留, 提交的整个架构块覆盖。
    """
    base = existing or {}
    return {**base, **incoming,
            "modelStates": {**base.get("modelStates", {}), **incoming["modelStates"]}}


def load_state() -> dict | None:
    """读取 envelope; 无数据 / 非 object / JSON 损坏 → None。"""
    row = db.fetch_one(f"SELECT value FROM {TABLE} WHERE key = ?", (KEY,))
    if row is None:
        return None
    return _decode_state(row[0])


def _decode_state(raw: str) -> dict | None:
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("[generate-state] 存储值 JSON 损坏, 按无数据处理")
        return None
    return value if isinstance(value, dict) else None


def save_state(payload: Any) -> tuple[dict | None, tuple[str, dict] | None]:
    """校验、合并、落库。updated_at 由服务端盖章。

    日常自动保存走这条路径 (按架构合并, 多设备分别编辑不同架构不互相覆盖)。

    返回 (stored, None) 或 (None, err)。体积校验在合并**之后**再做一次 ——
    否则分次提交的小块可以累积到超过上限。
    """
    valid, err = validate(payload)
    if err:
        return None, err

    with db.transaction() as conn:
        row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (KEY,)).fetchone()
        stored = merge_state(_decode_state(row[0]) if row else None, valid)
        return _write(conn, stored)


def replace_state(payload: Any) -> tuple[dict | None, tuple[str, dict] | None]:
    """校验后**完整替换** (不做合并)。用于设置导入。

    「导入配置」语义是「让本实例变成配置包的样子」, 若沿用合并, 目标实例自有
    而配置包没有的架构会残留, 结果既非源也非目标。校验不通过时不触碰既有数据。
    """
    valid, err = validate(payload)
    if err:
        return None, err

    with db.transaction() as conn:
        return _write(conn, dict(valid))


def _write(conn, stored: dict) -> tuple[dict | None, tuple[str, dict] | None]:
    # 体积上限不含服务端管理的 updated_at —— 否则边界值会因盖章而莫名越限,
    # 客户端也无从预知。先摘掉再校验, 通过后再盖。
    stored.pop("updated_at", None)
    if _serialized_size(stored) > MAX_BYTES:
        return None, ("state_too_large", {"limit_bytes": MAX_BYTES})
    stored["updated_at"] = time.time()

    conn.execute(
        f"INSERT OR REPLACE INTO {TABLE} (key, value) VALUES (?, ?)",
        (KEY, json.dumps(stored, ensure_ascii=False)),
    )
    return stored, None
