"""配置引用模型文件的 SHA256 指纹表 (表2) 及其扫描器。

导出/导入配置时携带 (key=generate_model_hashes), 键为
``"<category>/<relative_path>"``, 值为大写十六进制 SHA256。表内**不记来源**:
"从哪取字节" 是导入端的检索策略 (本机白名单哈希索引 → civitai by-hash → unknown),
与后端无关, 后端只负责把这张不透明 JSON 整体存取。

两种来源分开:
  - 存量表: 上次导入留下的指纹。记录的是**源实例**引用的文件, 本实例可能从未
    下载过; 导出时须原样带走, 否则迁移链在第二跳就丢失信息。
  - 现扫: 本实例当前工作区状态引用到、且 models 表里已有的文件指纹。

扫描刻意不判断插槽、不过滤 enabled: 深度遍历 modelStates 子树里的全部字符串,
按 relative_path 命中即收 —— 多收无害, 漏收才致命。
"""

import json
import logging
from typing import Any, Iterator

from ..db import db

log = logging.getLogger(__name__)

KEY = "generate_model_hashes"
TABLE = "app_meta"
MODELS_TABLE = "models"


def _iter_strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _iter_strings(item)


def scan_model_hashes(state: Any) -> dict[str, str]:
    """扫描工作区状态引用的模型文件, 返回 {"<category>/<relative_path>": sha}。

    每个去重后的字符串按 relative_path 等值匹配 models 表; 命中行的每一条各
    产出一个键 (同名文件落在不同 category 时各自成键)。文件不在磁盘或哈希算
    不出 → 省略该键。
    """
    if not isinstance(state, dict):
        return {}
    model_states = state.get("modelStates")
    if not isinstance(model_states, dict):
        return {}
    if not db.table_exists(TABLE) or not db.table_exists(MODELS_TABLE):
        return {}

    names = {name for name in _iter_strings(model_states) if name and name.strip()}
    if not names:
        return {}

    from ..utils import _sha256_file
    from .model_meta_store import get_or_compute_model_sha256

    result: dict[str, str] = {}
    for name in names:
        rows = db.fetch_all(
            # 兜底 filename: 配置引用可能是裸文件名 (如 face_yolov8m.pt), 而登记行
            # 的 relative_path 是相对其扫描根的路径 (如 bbox/face_yolov8m.pt ——
            # 父根 ultralytics 先于子根 bbox 被扫, 归属 category=ultralytics)。
            # 等值匹配会漏行 → 键被省略 → 导入端永远查不到指纹。
            "SELECT id, real_path, category, relative_path FROM models "
            "WHERE relative_path = ? OR filename = ?",
            (name, name),
        )
        for row in rows:
            # get_or_compute 同时承担「缓存是否仍匹配磁盘」与「现算」:
            # 缓存有效即直接用, 文件缺失/算不出返回 None → 该键省略。
            sha = get_or_compute_model_sha256(
                int(row["id"]), row["real_path"], _sha256_file
            )
            if not sha:
                continue
            result[f"{row['category']}/{row['relative_path']}"] = sha.upper()
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
    """导出用并集: 现扫结果 ∪ 存量表中现扫未产出的键 (现扫优先)。"""
    merged = dict(load_hashes())
    for key, sha in scan_model_hashes(state).items():
        merged[key] = sha
    return merged
