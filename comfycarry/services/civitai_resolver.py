"""
ComfyCarry — CivitAI Resolver

独立的 CivitAI 模型解析服务, 不依赖 Enhanced-Civicomfy 插件.

功能:
  1. URL/ID 解析 — 支持所有 CivitAI 链接格式
  2. API 调用   — 获取模型版本信息 + 下载链接
  3. 文件选择   — 启发式选择最佳文件 (safetensors 优先)
  4. 目录映射   — CivitAI 模型类型 → ComfyUI 本地路径
  5. 元数据保存 — .weilin-info.json + 预览图 (兼容 WeiLin-Comfyui-Tools)
"""

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs

import requests as http_requests

from ..config import COMFYUI_DIR, MODEL_DIRS
from ..utils import _sha256_file, read_safetensors_metadata
from .download_classify import (
    classify_file,
    suggest_dir_keys,
    MANUAL as CLASSIFY_MANUAL,
    SKIP as CLASSIFY_SKIP,
    FOLLOW_PRIMARY as CLASSIFY_FOLLOW_PRIMARY,
)

logger = logging.getLogger(__name__)

_CIVITAI_API_BASE = "https://civitai.com/api/v1"


class NoDownloadableFiles(RuntimeError):
    """该 version 里没有可下载的模型权重。

    与「API 调用失败」性质不同 (那是 RuntimeError → 502), 这是数据本身如此,
    重试无用, 所以单独一档让路由给出可读的 4xx。

    实测触发场景 (Civitai model 1817671 "Wan Video 2.2"):
      最新的三个 version ("5B Text-Image-to-Video" / "14B Text-to-Video" /
      "14B Image-to-Video") 各自**只含一个训练数据 zip**, 没有任何权重文件。
      版本选择器会把它们列出来, 用户点了却下不到东西。
    """


# CivitAI 模型类型 → ComfyUI MODEL_DIRS key
_TYPE_TO_DIR_KEY = {
    "checkpoint": "checkpoints",
    "lora": "loras",
    "lycoris": "loras",
    "locon": "loras",
    "dora": "loras",
    "controlnet": "controlnet",
    "vae": "vae",
    "upscaler": "upscale_models",
    "embedding": "embeddings",
    "textualinversion": "embeddings",
    "poses": "poses",
    "motionmodule": "animatediff_models",
    "wildcards": "wildcards",
    "workflows": "workflows",
    "detection": "ultralytics",
    "aestheticgradient": "embeddings",
    "other": "checkpoints",
    "clothing": "checkpoints",
    "sdxl": "checkpoints",
    "hypernetwork": "hypernetworks",
}

# 有效模型文件扩展名
_MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"}

# 分离架构关键词。**不再参与目录判定** —— 目录判定已整体迁到
# services/download_classify.py (依据 docs/DOWNLOAD_CLASSIFICATION_SPEC.md,
# 判据为 file.type / model.type / 扩展名, 且下载前定目录、不再归位)。
# 此表仅剩「是否视频架构」等辅助判断在用。
_SPLIT_FILE_BASE_KEYWORDS = ("anima", "flux", "sd 3", "sd3", "hidream", "wan", "hunyuan", "lumina", "pixart", "krea", "z-image", "z image", "zimage", "chroma")


def _is_split_file_base_model(base_model: str) -> bool:
    """baseModel 是否含分离架构关键词。

    历史用途 (下载归位的早期短路径) 已废弃, 见上方注释。
    """
    if not base_model:
        return False
    bm = base_model.lower()
    return any(k in bm for k in _SPLIT_FILE_BASE_KEYWORDS)


# ── 视频架构判定 ───────────────────────────────────────────────────────────
# Civitai baseModel 含 "wan video" 即视为视频架构。当前覆盖 Wan 2.1/2.2 全系
# (T2V-A14B / I2V-A14B / TI2V-5B)。Hunyuan/LTX 视频架构是二期, 届时在此扩展。
# 非视频架构 (图像侧 SDXL/Flux/Anima 等) 走原有单文件路径, 行为不变。
_VIDEO_BASE_MODEL_KEYWORDS = ("wan video",)


def is_video_base_model(base_model: str) -> bool:
    """Civitai baseModel 是否为视频架构 (Wan 2.2 系)。

    视频架构下同一 version 的多个主文件全量下载 (见 select_primary_files);
    非视频架构保持原有单文件收敛行为 (select_primary_file)。
    """
    if not base_model:
        return False
    bm = base_model.lower()
    return any(k in bm for k in _VIDEO_BASE_MODEL_KEYWORDS)


# ── URL/ID 解析 ──────────────────────────────────────────────────────────────

def parse_civitai_input(input_str: str) -> dict:
    """
    解析 CivitAI 模型输入, 支持多种格式:

    格式:
      - 纯数字 model_id: "12345"
      - model_id:version_id: "12345:67890"
      - 完整 URL: "https://civitai.com/models/12345/model-name"
      - URL 带版本: "https://civitai.com/models/12345?modelVersionId=67890"
      - 版本 URL: "https://civitai.com/model-versions/67890"
      - API URL: "https://civitai.com/api/v1/models/12345"
      - 下载 URL: "https://civitai.com/api/download/models/67890"

    Returns:
      {"model_id": int|None, "version_id": int|None}

    Raises:
      ValueError: 无法解析输入
    """
    text = str(input_str).strip()
    if not text:
        raise ValueError("输入为空")

    # 纯数字: model_id
    if text.isdigit():
        return {"model_id": int(text), "version_id": None}

    # model_id:version_id
    if re.match(r"^\d+:\d+$", text):
        parts = text.split(":")
        return {"model_id": int(parts[0]), "version_id": int(parts[1])}

    # URL 解析
    url = text if text.startswith("http") else f"https://{text}"
    try:
        parsed = urlparse(url)
    except Exception:
        raise ValueError(f"无法解析输入: {text}")

    # 验证域名
    if parsed.hostname and "civitai.com" not in parsed.hostname:
        raise ValueError(f"不是 CivitAI 链接: {parsed.hostname}")

    path = parsed.path.rstrip("/")
    query = parse_qs(parsed.query)

    # /api/download/models/{version_id}
    m = re.match(r"/api/download/models/(\d+)", path)
    if m:
        return {"model_id": None, "version_id": int(m.group(1))}

    # /api/v1/models/{model_id}
    m = re.match(r"/api/v\d+/models/(\d+)", path)
    if m:
        return {"model_id": int(m.group(1)), "version_id": None}

    # /api/v1/model-versions/{version_id}
    m = re.match(r"/api/v\d+/model-versions/(\d+)", path)
    if m:
        return {"model_id": None, "version_id": int(m.group(1))}

    # /model-versions/{version_id}
    m = re.match(r"/model-versions/(\d+)", path)
    if m:
        return {"model_id": None, "version_id": int(m.group(1))}

    # /models/{model_id}[/anything]
    m = re.match(r"/models/(\d+)", path)
    if m:
        model_id = int(m.group(1))
        # 检查 ?modelVersionId= 查询参数
        version_id = None
        if "modelVersionId" in query:
            try:
                version_id = int(query["modelVersionId"][0])
            except (ValueError, IndexError):
                pass
        return {"model_id": model_id, "version_id": version_id}

    raise ValueError(f"无法从链接中提取模型 ID: {text}")


# ── CivitAI API 调用 ────────────────────────────────────────────────────────

def fetch_model_info(
    model_id: int | None = None,
    version_id: int | None = None,
    api_key: str = "",
) -> dict:
    """
    从 CivitAI API 获取模型版本信息.

    至少需要 model_id 或 version_id 之一.

    Returns:
      {
        "model_id": int,
        "model_name": str,
        "version_id": int,
        "version_name": str,
        "model_type": str,          # "Checkpoint", "LORA", etc.
        "base_model": str,          # "SD 1.5", "SDXL", etc.
        "files": [...],             # CivitAI files 数组
        "images": [...],            # 预览图
        "trained_words": [...],     # 触发词
        "download_url": str,        # 选中文件的下载链接
        "selected_file": {...},     # 选中的文件对象
        "save_dir_key": str,        # MODEL_DIRS 的 key
        "raw": {...},               # 原始 API 响应
      }

    Raises:
      ValueError: 参数不足
      RuntimeError: API 调用失败
    """
    if not model_id and not version_id:
        raise ValueError("model_id 或 version_id 至少提供一个")

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # 如果有 version_id, 直接查版本
    if version_id:
        api_url = f"{_CIVITAI_API_BASE}/model-versions/{version_id}"
        try:
            r = http_requests.get(api_url, headers=headers, timeout=30)
            if r.status_code == 404:
                raise RuntimeError(f"CivitAI 版本 {version_id} 不存在")
            r.raise_for_status()
            version_data = r.json()
        except http_requests.RequestException as e:
            raise RuntimeError(f"CivitAI API 请求失败: {e}")

        return _parse_version_response(version_data, api_key)

    # 只有 model_id: 获取模型信息, 取最新版本
    api_url = f"{_CIVITAI_API_BASE}/models/{model_id}"
    try:
        r = http_requests.get(api_url, headers=headers, timeout=30)
        if r.status_code == 404:
            raise RuntimeError(f"CivitAI 模型 {model_id} 不存在")
        r.raise_for_status()
        model_data = r.json()
    except http_requests.RequestException as e:
        raise RuntimeError(f"CivitAI API 请求失败: {e}")

    versions = model_data.get("modelVersions", [])
    if not versions:
        raise RuntimeError(f"模型 {model_id} 没有可用版本")

    # 默认选最新版本 (第一个)
    version_data = versions[0]
    # 补充 model 信息到 version_data (版本 API 返回时有, 模型 API 需要手动加)
    version_data["model"] = {
        "id": model_data.get("id"),
        "name": model_data.get("name", ""),
        "type": model_data.get("type", ""),
        "nsfw": model_data.get("nsfw", False),
    }

    return _parse_version_response(version_data, api_key)


def _parse_version_response(version_data: dict, api_key: str = "") -> dict:
    """解析 CivitAI 版本 API 响应, 返回标准化结构

    视频架构 (is_video_base_model) 下额外产出:
      - selected_files: list[dict]  全部主文件 (多文件全量下载)
      - pair_group: str            分组标识 (同 version 多文件属于一组, 事实性分组)

    v7: 不再产出 pairs —— high/low 角色曾靠文件名嗅探推断, 而两段权重在文件层面
    无法区分, 猜出来的角色是噪声, 已整体移除。
    非视频架构保持原样 (selected_file 单数, 无 selected_files/pair_group)。
    """
    model_info = version_data.get("model", {})
    model_type = model_info.get("type", "Checkpoint")
    files = version_data.get("files", [])
    base_model = version_data.get("baseModel", "")

    selected = select_primary_file(files)
    if not selected:
        raise RuntimeError("该版本没有可下载的模型文件")

    # 构建下载 URL (带 API key)
    download_url = selected.get("downloadUrl", "")
    if not download_url:
        # 备用: 通过版本 ID 构建
        download_url = f"{_CIVITAI_API_BASE}/download/models/{version_data.get('id')}"

    # 附加 API key (仅当有有效 key 时)
    if api_key and api_key.strip() and "token=" not in download_url:
        sep = "&" if "?" in download_url else "?"
        download_url += f"{sep}token={api_key}"

    # 目录判定按**文件**粒度进行 (见 download_classify), 这里给的是条目级兜底,
    # 仅供 UI 展示与旧调用方兼容。真正落盘用的是 resolve_civitai_download()
    # 里逐文件算出的 dir_key。
    type_lower = model_type.lower()
    save_dir_key = _TYPE_TO_DIR_KEY.get(type_lower, "checkpoints")

    # Early Access / 付费检测
    availability = version_data.get("availability", "Public")
    ea_config = version_data.get("earlyAccessConfig") or {}

    result = {
        "model_id": model_info.get("id") or version_data.get("modelId"),
        "model_name": model_info.get("name", "Unknown"),
        "version_id": version_data.get("id"),
        "version_name": version_data.get("name", ""),
        "model_type": model_type,
        "base_model": base_model,
        "files": files,
        "images": version_data.get("images", []),
        "trained_words": version_data.get("trainedWords", []),
        "download_url": download_url,
        "selected_file": selected,
        "save_dir_key": save_dir_key,
        "availability": availability,
        "early_access_config": ea_config,
        "raw": version_data,
    }

    # 视频架构: 多文件全量下载 (同 version 的全部主文件)
    # 非视频架构 (图像侧 SDXL/Flux/Anima 等) 不进入此分支, 行为完全不变。
    if is_video_base_model(base_model):
        sel_files = select_primary_files(files)
        if not sel_files:
            sel_files = [selected]
        # 分组标识: model_id + version_id (前端据此把同 version 多文件聚为一组)
        mid = result["model_id"]
        vid = version_data.get("id")
        pair_group = f"civitai:{mid}:{vid}" if mid and vid else ""
        result["selected_files"] = sel_files
        result["pair_group"] = pair_group
        result["is_video"] = True
    else:
        result["is_video"] = False

    return result


# ── 文件选择 ─────────────────────────────────────────────────────────────────

def select_primary_file(files: list[dict]) -> dict | None:
    """
    从 CivitAI files 数组中选择最佳下载文件.

    优先级:
      1. primary 标记的文件
      2. safetensors (pruned 优先)
      3. safetensors (非 pruned)
      4. ckpt (pruned 优先)
      5. ckpt (非 pruned)
      6. Model 类型的第一个文件
      7. 任何第一个有效文件

    跳过: type="Config" 的文件、零大小文件
    """
    if not files:
        return None

    # 过滤: 跳过 config 文件和零大小文件
    valid = []
    for f in files:
        if f.get("type") == "Config":
            continue
        name = f.get("name", "")
        ext = os.path.splitext(name)[1].lower()
        if ext not in _MODEL_EXTENSIONS and f.get("type") != "Model":
            continue
        if f.get("sizeKB", 0) <= 0 and not f.get("downloadUrl"):
            continue
        valid.append(f)

    if not valid:
        # 降级: 返回第一个有下载链接的
        for f in files:
            if f.get("downloadUrl"):
                return f
        return None

    # 1. primary 标记
    for f in valid:
        if f.get("primary"):
            return f

    # 分类
    safetensors = [f for f in valid if f.get("name", "").lower().endswith(".safetensors")]
    ckpt = [f for f in valid if f.get("name", "").lower().endswith((".ckpt", ".pt", ".pth"))]

    def _pruned_first(fl):
        """pruned 优先排序"""
        return sorted(fl, key=lambda f: (0 if "pruned" in f.get("name", "").lower() else 1))

    # 2-3. safetensors
    if safetensors:
        return _pruned_first(safetensors)[0]

    # 4-5. ckpt
    if ckpt:
        return _pruned_first(ckpt)[0]

    # 6. Model 类型
    for f in valid:
        if f.get("type") == "Model":
            return f

    # 7. 第一个有效文件
    return valid[0]


def _filter_valid_model_files(files: list[dict]) -> list[dict]:
    """过滤 Civitai files 数组, 返回有效模型文件 (跳过 Config / 零大小 / 非模型扩展)。

    与 select_primary_file 的过滤逻辑一致, 抽出供复数版复用。
    """
    valid = []
    for f in files:
        if f.get("type") == "Config":
            continue
        name = f.get("name", "")
        ext = os.path.splitext(name)[1].lower()
        if ext not in _MODEL_EXTENSIONS and f.get("type") != "Model":
            continue
        if f.get("sizeKB", 0) <= 0 and not f.get("downloadUrl"):
            continue
        valid.append(f)
    if not valid:
        # 降级: 取所有有下载链接的
        valid = [f for f in files if f.get("downloadUrl")]
    return valid


def select_primary_files(files: list[dict]) -> list[dict]:
    """视频架构下从 Civitai files 数组选出全部主文件。

    沿用 select_primary_file 的优先级 (primary 标记 → safetensors (pruned 优先)
    → ckpt → Model 类型), 但 **不再收敛到一个文件**。

    规则:
      1. 取所有有效模型文件 (_filter_valid_model_files)
      2. 去重: 同名 + 同 downloadUrl 的重复条目 (Civitai 偶有冗余下载链接)
      3. 保留 primary 标记的; 若无 primary, 保留全部有效 safetensors/ckpt/Model
      4. 仍按 pruned 优先排序 (稳定性)

    返回: 文件对象列表 (可能为 1 个或多个)。空数组表示无可用文件。
    非视频架构不应调用此函数 (走 select_primary_file 单数版)。
    """
    if not files:
        return []
    valid = _filter_valid_model_files(files)
    if not valid:
        return []

    # 去重: 同名同 downloadUrl 视为同一文件 (实测 DaSiWa/Pussy 案例有冗余条目)
    seen = set()
    deduped = []
    for f in valid:
        key = (f.get("name", ""), f.get("downloadUrl", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)
    valid = deduped

    # primary 标记的文件优先 (Civitai 正常 version 只有一个 primary)
    primaries = [f for f in valid if f.get("primary")]
    if primaries:
        # 多个 primary 时全部保留 (理论上少见, 但防御性处理)
        return primaries

    # 无 primary: 保留全部有效文件, 按 pruned 优先 + 原序稳定排序
    def _sort_key(f):
        name = f.get("name", "").lower()
        return (0 if "pruned" in name else 1, name)
    return sorted(valid, key=_sort_key)


# ── 文件名处理 ───────────────────────────────────────────────────────────────

def sanitize_filename(name: str, max_length: int = 200) -> str:
    """
    清理文件名, 移除不安全字符.

    规则:
      - 替换 < > : " / \\ | ? * 和控制字符为 _
      - 保留字母、数字、中文、. - _ 空格
      - 去掉收尾空格和点号
      - 限制长度 (保留扩展名)
    """
    if not name:
        return "unnamed_model"

    # 尝试 bytes 解码
    if isinstance(name, bytes):
        try:
            name = name.decode("utf-8")
        except UnicodeDecodeError:
            name = name.decode("latin-1")

    # 替换不安全字符
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    name = name.strip(" .")

    if not name:
        return "unnamed_model"

    # Windows 保留名称
    reserved = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(10)} | {f"LPT{i}" for i in range(10)}
    stem = os.path.splitext(name)[0].upper()
    if stem in reserved:
        name = "_" + name

    # 长度限制 (保留扩展名)
    if len(name) > max_length:
        base, ext = os.path.splitext(name)
        name = base[: max_length - len(ext)] + ext

    return name


def save_dir_for_key(dir_key: str, base_model: str = "") -> str:
    """MODEL_DIRS 的 key + base_model → 本地绝对路径。

    baseModel 子文件夹沿用原有约定 (如 models/checkpoints/SDXL 1.0/)。
    """
    rel_dir = MODEL_DIRS.get(dir_key, f"models/{dir_key}")
    if base_model and base_model.strip():
        sub = _sanitize_folder_name(base_model.strip())
        if sub:
            rel_dir = os.path.join(rel_dir, sub)
    return os.path.join(COMFYUI_DIR, rel_dir)


def build_download_url(file_obj: dict, version_id, api_key: str = "") -> str:
    """构造单个文件的下载 URL: file.downloadUrl 优先, 缺失时按 version_id 兜底,
    有 api_key 且 URL 里尚无 token 时追加 token query 参数。

    token 走 query 参数而非 Authorization 头 —— Civitai 会 307 到 R2 预签名 URL,
    预签名自带签名, 再带 Authorization 会被 S3 判双重鉴权返 400。
    """
    url = file_obj.get("downloadUrl", "") or f"{_CIVITAI_API_BASE}/download/models/{version_id}"
    if api_key and api_key.strip() and "token=" not in url:
        url += ("&" if "?" in url else "?") + f"token={api_key}"
    return url


def resolve_save_dir(model_type: str, base_model: str = "") -> str:
    """[兼容保留] CivitAI 条目级类型 + base_model → 本地绝对路径。

    真正的落盘目录由 resolve_civitai_download() 逐文件判定
    (services/download_classify.classify_file)。本函数仅供旧调用方与
    UI 展示用的条目级兜底。
    """
    dir_key = _TYPE_TO_DIR_KEY.get((model_type or "").lower(), "checkpoints")
    return save_dir_for_key(dir_key, base_model)


def _sanitize_folder_name(name: str) -> str:
    """清理文件夹名称，保留原始 baseModel 字符串但移除文件系统不安全字符"""
    clean = re.sub(r'[/\\:*?"<>|\x00-\x1f]', '_', name)
    clean = clean.strip('. ')
    # 防止残留的目录穿越序列
    if '..' in clean:
        clean = clean.replace('..', '_')
    return clean or ""


# ── 归位逻辑已删除 ──────────────────────────────────────────────────────────
# 旧实现 relocate_after_download() 在下载完成后读文件头判内容角色, 再物理移动
# 文件 (算目标目录 / 建目录 / 处理同名冲突 / 改 sidecar / 搬预览图)。
#
# 已整体废弃: 目录改为**下载前**按元数据逐文件判定
# (services/download_classify.classify_file, 契约见
#  docs/DOWNLOAD_CLASSIFICATION_SPEC.md)。判不出来的交给用户选, 不再事后补救。
#
# update_sidecar_path() 保留 —— 它与归位无关, 供其他改路径的场景复用。
def update_sidecar_path(old_path: str, new_path: str) -> None:
    """更新 .weilin-info.json sidecar 的 path 字段 (归位后路径变化)。

    sidecar 与预览图都在原位 — 归位后把它们一并迁到新目录。
    """
    old_info = f"{old_path}.weilin-info.json"
    new_info = f"{new_path}.weilin-info.json"
    try:
        if os.path.exists(old_info):
            with open(old_info, 'r', encoding='utf-8') as f:
                data = json.load(f)
            # 更新 path / file 字段
            if 'path' in data:
                data['path'] = new_path
            if 'file' in data:
                # file 字段是相对路径, 不变 (除非跨 models 根, 这里只在 checkpoints↔diffusion_models 间)
                pass
            with open(new_info, 'w', encoding='utf-8') as f:
                json.dump(data, f, sort_keys=False, indent=2, ensure_ascii=False)
            if old_info != new_info:
                os.remove(old_info)
    except Exception as e:
        logger.warning(f"[civitai_resolver] sidecar 路径更新失败: {e}")

    # 预览图 (.png/.jpg/.jpeg/.webp) 一并迁移
    old_base = old_path
    for pext in ('.png', '.jpg', '.jpeg', '.webp'):
        op = old_base + pext
        np_ = new_path + pext
        if os.path.exists(op):
            try:
                if os.path.exists(np_) and op != np_:
                    os.remove(np_)
                if op != np_:
                    os.rename(op, np_)
            except OSError:
                pass


# ── 文件元数据提取 ────────────────────────────────────────────────────────────

def extract_file_trigger_words(model_path: str) -> list[str]:
    """
    从 safetensors 文件 __metadata__ 中提取触发词.

    优先级:
      1. modelspec.trigger_phrase — 明确的触发短语 (逗号分隔)
      2. ss_tag_frequency — kohya 训练标签频率 (按总频次降序)
    返回去重有序的触发词列表。
    """
    if not model_path.endswith(".safetensors"):
        return []

    meta = read_safetensors_metadata(model_path)
    if not meta:
        logger.debug(f"[civitai_resolver] 无文件元数据: {Path(model_path).name}")
        return []

    words: list[str] = []
    seen: set[str] = set()

    def _add(w: str):
        w = w.strip()
        if w and w not in seen:
            seen.add(w)
            words.append(w)

    # 1. modelspec.trigger_phrase
    trigger = meta.get("modelspec.trigger_phrase", "")
    if trigger:
        for part in trigger.split(","):
            _add(part)

    # 2. ss_tag_frequency (kohya 训练标签)
    tag_freq_raw = meta.get("ss_tag_frequency", "")
    if tag_freq_raw:
        try:
            tag_freq = json.loads(tag_freq_raw) if isinstance(tag_freq_raw, str) else tag_freq_raw
            # 结构: { "dataset_name": { "tag": count, ... }, ... }
            merged: dict[str, int] = {}
            if isinstance(tag_freq, dict):
                for _ds, tags in tag_freq.items():
                    if isinstance(tags, dict):
                        for tag, cnt in tags.items():
                            tag = tag.strip()
                            if tag:
                                merged[tag] = merged.get(tag, 0) + (cnt if isinstance(cnt, (int, float)) else 0)
            # 按频次降序
            for tag, _ in sorted(merged.items(), key=lambda x: x[1], reverse=True):
                _add(tag)
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"[civitai_resolver] ss_tag_frequency 解析失败: {e}")

    return words


# ── 元数据保存 ───────────────────────────────────────────────────────────────

def save_model_metadata(
    model_path: str,
    info: dict,
    sha256: str = "",
    file_trigger_words: list[str] | None = None,
) -> str:
    """
    保存模型元数据为 .weilin-info.json (兼容 WeiLin-Comfyui-Tools 格式).

    Args:
        model_path: 模型文件绝对路径
        info: fetch_model_info() 返回的信息
        sha256: SHA256 哈希 (可选, 下载后计算)
        file_trigger_words: 从 safetensors 文件提取的触发词 (可选)

    Returns:
        info 文件路径
    """
    abs_path = Path(model_path).resolve()
    comfy_root = Path(COMFYUI_DIR).resolve()

    # 计算 weilin 兼容的相对路径
    try:
        rel_from_comfy = abs_path.relative_to(comfy_root)
        rel_parts = rel_from_comfy.parts
        # 路径格式: models/<type>/[subdir/]filename — 去掉前两级得到相对路径
        if len(rel_parts) > 2 and rel_parts[0] == "models":
            file_rel = str(Path(*rel_parts[2:]))
        else:
            file_rel = abs_path.name
    except ValueError:
        file_rel = abs_path.name

    raw = info.get("raw", {})
    model_name = info.get("model_name", "")
    version_name = info.get("version_name", "")
    display_name = f"{model_name} - {version_name}" if version_name else model_name

    info_data = {
        "file": file_rel,
        "path": str(abs_path),
        "sha256": sha256.upper() if sha256 else "",
        "name": display_name,
        "type": info.get("model_type", ""),
        "baseModel": info.get("base_model", ""),
        "images": [],
        "trainedWords": [],
        "links": [],
        "raw": {"civitai": raw},
    }

    # 触发词 (normalize: 按逗号拆分不规范条目, 去重保序)
    seen_words: set[str] = set()
    for w in info.get("trained_words", []):
        parts = [p.strip() for p in w.split(",") if p.strip()]
        for part in parts:
            if part not in seen_words:
                seen_words.add(part)
                info_data["trainedWords"].append({"word": part, "civitai": True})

    # 文件元数据触发词 (去重: 跳过已有的 CivitAI 词)
    for w in (file_trigger_words or []):
        if w not in seen_words:
            seen_words.add(w)
            info_data["trainedWords"].append({"word": w, "civitai": False})

    # Links
    model_id = info.get("model_id")
    version_id = info.get("version_id")
    if model_id:
        link = f"https://civitai.com/models/{model_id}"
        if version_id:
            link += f"?modelVersionId={version_id}"
        info_data["links"].append(link)
        info_data["links"].append(f"{_CIVITAI_API_BASE}/model-versions/{version_id}")

    # 图片 (weilin 兼容格式)
    for img in info.get("images", []):
        img_url = img.get("url", "")
        if not img_url:
            continue
        img_id = os.path.splitext(os.path.basename(img_url))[0] if img_url else None
        img_entry = {
            "url": img_url,
            "civitaiUrl": f"https://civitai.com/images/{img_id}" if img_id else None,
            "type": img.get("type", "image"),
            "width": img.get("width"),
            "height": img.get("height"),
            "nsfwLevel": img.get("nsfwLevel"),
        }
        meta = img.get("meta") or {}
        if meta:
            img_entry["seed"] = meta.get("seed")
            img_entry["positive"] = meta.get("prompt", "")
            img_entry["negative"] = meta.get("negativePrompt", "")
            img_entry["steps"] = meta.get("steps")
            img_entry["sampler"] = meta.get("sampler")
            img_entry["cfg"] = meta.get("cfgScale")
            img_entry["model"] = meta.get("Model")
            img_entry["resources"] = meta.get("resources")
        info_data["images"].append(img_entry)

    # 写入文件 (原子替换: 先写临时文件再 rename, 防止中途崩溃留下损坏 JSON)
    info_path = str(abs_path) + ".weilin-info.json"
    tmp_path = info_path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(info_data, f, sort_keys=False, indent=2, ensure_ascii=False)
        os.replace(tmp_path, info_path)
    except Exception as e:
        logger.warning(f"[civitai_resolver] 保存元数据失败: {e}")
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return None

    logger.info(f"[civitai_resolver] 已保存元数据: {info_path}")
    return info_path


def normalize_version_data(version_data: dict) -> dict:
    """
    将 CivitAI 版本 API 原始响应转换为 save_model_metadata() 期望的 info 格式.

    适用于 by-hash / model-versions / models 等任何返回版本级数据的 API 响应。
    不做文件选择或下载 URL 构建, 仅提取元数据字段。
    """
    model_info = version_data.get("model", {})
    return {
        "model_id": model_info.get("id") or version_data.get("modelId"),
        "model_name": model_info.get("name", "Unknown"),
        "version_id": version_data.get("id"),
        "version_name": version_data.get("name", ""),
        "model_type": model_info.get("type", ""),
        "base_model": version_data.get("baseModel", ""),
        "images": version_data.get("images", []),
        "trained_words": version_data.get("trainedWords", []),
        "raw": version_data,
    }


def enrich_model_by_hash(model_path: str, api_key: str = "") -> str | None:
    """
    通过 SHA256 by-hash API 获取完整元数据并保存 (含 modelId + images.meta).

    用于下载完成后的异步二次丰富, 以及 fetch_info 手动触发。

    Returns:
        info 文件路径, 或 None (失败时)
    """
    abs_path = Path(model_path).resolve()
    if not abs_path.is_file():
        logger.warning(f"[civitai_resolver] enrich: 文件不存在 {abs_path}")
        return None

    # SHA256
    sha256 = _sha256_file(str(abs_path))
    if not sha256:
        logger.warning(f"[civitai_resolver] enrich: SHA256 计算失败 {abs_path}")
        return None

    # by-hash API
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        url = f"{_CIVITAI_API_BASE}/model-versions/by-hash/{sha256}"
        resp = http_requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 404:
            logger.info(f"[civitai_resolver] enrich: CivitAI 未找到 {sha256[:16]}...")
            return None
        resp.raise_for_status()
        version_data = resp.json()
    except Exception as e:
        logger.warning(f"[civitai_resolver] enrich: API 失败 {e}")
        return None

    info = normalize_version_data(version_data)

    # 从 safetensors 文件头提取训练触发词
    file_words = extract_file_trigger_words(str(abs_path))

    # 保存元数据 (覆写已有的 weilin-info.json)
    info_path = save_model_metadata(str(abs_path), info, sha256=sha256, file_trigger_words=file_words)

    # 更新预览图 (by-hash 返回的 images 可能更丰富)
    download_preview_image(str(abs_path), info.get("images", []))

    logger.info(f"[civitai_resolver] enrich 完成: {abs_path.name}")
    return info_path


def download_preview_image(model_path: str, images: list[dict]) -> str | None:
    """
    下载模型预览图.

    Args:
        model_path: 模型文件绝对路径
        images: CivitAI images 数组

    Returns:
        预览图路径, 或 None
    """
    if not images:
        return None

    # 选第一张非视频图
    img_url = None
    for img in images:
        if img.get("type", "image") != "video" and img.get("url"):
            img_url = img["url"]
            break
    if not img_url:
        return None

    base_no_ext = Path(model_path).with_suffix("")
    try:
        with http_requests.get(img_url, timeout=15, stream=True) as r:
            r.raise_for_status()
            ct = r.headers.get("Content-Type", "")
            if "video" in ct:
                logger.warning(f"[civitai_resolver] 预览图 URL 返回视频类型: {ct}")
                return None
            ext = ".png"
            if "jpeg" in ct or "jpg" in ct:
                ext = ".jpeg"
            elif "webp" in ct:
                ext = ".webp"
            preview_path = str(base_no_ext) + ext
            with open(preview_path, "wb") as pf:
                for chunk in r.iter_content(8192):
                    pf.write(chunk)
        logger.info(f"[civitai_resolver] 已保存预览图: {preview_path}")
        return preview_path
    except Exception as e:
        logger.warning(f"[civitai_resolver] 预览图下载失败: {e}")
        return None


# ── 完整解析流程 (高层 API) ──────────────────────────────────────────────────

def resolve_civitai_download(
    input_str: str,
    model_type: str = "",
    version_id: int | None = None,
    api_key: str = "",
    custom_filename: str = "",
    dir_keys: dict[str, str] | None = None,
) -> dict:
    """
    完整的 CivitAI 下载解析流程: 输入 → API 查询 → 文件选择 → 下载参数.

    这是前端 POST /api/download 的替代实现.

    Args:
        input_str: 模型 URL、ID 或 "model_id:version_id"
        model_type: 模型类型提示 (可选, CivitAI 端会自动识别)
        version_id: 指定版本 ID (覆盖从 input_str 解析的版本)
        api_key: CivitAI API Key
        custom_filename: 自定义文件名 (可选)
        dir_keys: {filename: MODEL_DIRS_key} —— 用户在目录选择 modal 里的裁决,
                  前端二次提交时带回。命中的文件跳过判定直接用该目录。

    Returns:
      ① 全部文件都判得出 →
        {
          "url": str,          # 第一个文件 (兼容现有单 task 提交)
          "filename": str,
          "save_dir": str,
          "model_type": str,   # 第一个文件的 dir_key
          "display_name": str, "info": {...}, "is_video": bool,
          "files": [           # **每个文件各自的目录** (逐文件判定)
            {"url","filename","dir_key","save_dir","model_type",
             "pair_group","original_file"}, ...
          ],
          "pair_group": str,   # 仅视频架构
        }

      ② 有文件判不出 → **不提交下载**, 交给前端弹目录选择:
        {
          "needs_classification": True,
          "pending_files": [   # 待用户裁决
            {"filename","size_kb","model_type","file_type","base_model",
             "suggested_dir_keys": [...]}, ...
          ],
          "resolved_files": [...],   # 已判定的部分, 用户裁决后一并提交
          "civitai_url": str,        # 详情页, 用户据此判断文件用途
          "display_name": str, "info": {...}, "is_video": bool,
        }

      custom_filename 仅作用于第一个文件 (多文件场景下其余用 Civitai 原名)。
      判定契约见 docs/DOWNLOAD_CLASSIFICATION_SPEC.md。

    Raises:
        ValueError: 输入无效
        RuntimeError: API 调用失败
    """
    # 1. 解析输入
    parsed = parse_civitai_input(input_str)
    model_id = parsed["model_id"]
    vid = version_id or parsed["version_id"]

    # 2. API 查询
    info = fetch_model_info(
        model_id=model_id,
        version_id=vid,
        api_key=api_key,
    )

    base_model = info.get("base_model", "")
    entry_type = info.get("model_type", "")

    # 3. 待下载文件集合
    #    视频架构取同 version 全部主文件; 其余保持原有单文件收敛行为。
    selected = info["selected_file"]
    if info.get("is_video"):
        sel_files = info.get("selected_files") or [selected]
    else:
        sel_files = [selected]

    # 4. 逐文件判定目录 (契约见 docs/DOWNLOAD_CLASSIFICATION_SPEC.md)
    #    关键: 粒度是**文件**不是版本 —— 同一 version 可以同时含主权重 + VAE,
    #    共用一个 save_dir 会让 VAE 落进 diffusion_models/ 从而在 UI 里消失。
    file_entries = []
    pending = []          # 机器判不出的, 交给用户选目录
    skipped = []          # 判为非资产 (训练数据等) 而跳过的
    for i, f in enumerate(sel_files):
        fname = f.get("name", "model.safetensors")
        # custom_filename 仅作用于第一个文件, 其余用 Civitai 原名 (避免重名)
        if i == 0 and custom_filename:
            fname = custom_filename
        fname = sanitize_filename(fname)

        # 用户已裁决的优先 (前端二次提交时带回), 否则走判定
        dir_key = (dir_keys or {}).get(fname) or (dir_keys or {}).get(f.get("name", ""))
        if not dir_key:
            dir_key = classify_file(
                model_type=entry_type,
                file_type=f.get("type", ""),
                filename=f.get("name", "") or fname,
                base_model=base_model,
            )

        if dir_key == CLASSIFY_SKIP:
            skipped.append(fname)          # 训练集等非资产, 不下载
            continue
        if dir_key == CLASSIFY_FOLLOW_PRIMARY:
            # .yaml/.json 伴随文件跟随主文件 —— 主文件目录稍后回填
            dir_key = None
        if dir_key == CLASSIFY_MANUAL:
            # 探针: 在 MANUAL 分支内、pending.append 之前用一次 HTTP Range
            # 请求拉文件头判定目录。仅对 .safetensors/.sft + Checkpoint 和
            # .gguf + 任意 model_type 触发; 其余原样走 MANUAL。
            # token 已在 furl 的 query 参数里 (见上方拼接), 探针不带 Authorization
            # 头 —— 跟随 307 到 R2 预签名 URL 时带 auth 会触发 S3 双重鉴权 400。
            # 401 → ProbeAuthError 向上冒泡 (路由层 toast 且不建任务);
            # 其它失败 → 落回 pending (现有 409 + DownloadDirModal 流程)。
            probe_ext = os.path.splitext(fname)[1].lower()
            probe_applicable = (
                (probe_ext in (".safetensors", ".sft") and entry_type.lower() == "checkpoint")
                or probe_ext == ".gguf"
            )
            if probe_applicable:
                probe_furl = build_download_url(f, info.get("version_id"), api_key)

                try:
                    from .header_probe import probe_download_url, classify_from_probe
                    head_bytes = probe_download_url(probe_furl)
                    probe_dir = classify_from_probe(head_bytes, probe_ext, entry_type)
                except Exception as e:
                    # 401 不在此吞 —— 让它向上冒泡到路由层 (ProbeAuthError)。
                    # 这里只接「判不出」的失败: 超时 / 网络错 / 非预期格式 / 解析失败。
                    from .header_probe import ProbeAuthError
                    if isinstance(e, ProbeAuthError):
                        raise
                    probe_dir = None
                    logger.debug(f"[civitai_resolver] 探针失败, 落回 MANUAL: {e}")

                if probe_dir:
                    dir_key = probe_dir
                # probe_dir 为 None → dir_key 仍为 MANUAL, 落回下方 pending

            if dir_key == CLASSIFY_MANUAL:
                pending.append({
                    "filename": fname,
                    "size_kb": f.get("sizeKB"),
                    "model_type": entry_type,
                    "file_type": f.get("type", ""),
                    "base_model": base_model,
                    "suggested_dir_keys": suggest_dir_keys(
                        entry_type, f.get("type", ""), f.get("name", "") or fname, base_model
                    ),
                })
                continue

        furl = build_download_url(f, info.get("version_id"), api_key)

        file_entries.append({
            "url": furl,
            "filename": fname,
            "dir_key": dir_key,
            "save_dir": save_dir_for_key(dir_key, base_model) if dir_key else "",
            "model_type": dir_key or "",
            "pair_group": info.get("pair_group", ""),
            "original_file": f,
        })

    # 伴随文件回填: 跟随第一个有确定目录的主文件
    primary_dir = next((e["save_dir"] for e in file_entries if e["save_dir"]), "")
    primary_key = next((e["dir_key"] for e in file_entries if e["dir_key"]), "")
    for e in file_entries:
        if not e["save_dir"]:
            e["save_dir"] = primary_dir
            e["dir_key"] = primary_key
            e["model_type"] = primary_key

    # 5. 显示名称
    display_name = info["model_name"]
    if info["version_name"]:
        display_name += f" - {info['version_name']}"

    # 有文件判不出 → 不提交下载, 让前端弹目录选择。
    # 一次性把整组待定文件交出去, 用户选完带 dir_keys 重新调用本函数。
    if pending:
        mid = info.get("model_id")
        vid_ = info.get("version_id")
        civitai_url = f"https://civitai.com/models/{mid}" if mid else ""
        if civitai_url and vid_:
            civitai_url += f"?modelVersionId={vid_}"
        return {
            "needs_classification": True,
            "pending_files": pending,
            "resolved_files": file_entries,     # 已判定的部分, 用户裁决后一并提交
            "civitai_url": civitai_url,
            "display_name": display_name,
            "info": info,
            "is_video": info.get("is_video", False),
        }

    if not file_entries:
        if skipped:
            raise NoDownloadableFiles(
                f"「{info.get('version_name') or '该版本'}」只包含训练数据等附件"
                f"({', '.join(skipped[:3])}), 没有模型权重。"
                f"请在版本列表里选择带权重文件的版本。"
            )
        raise NoDownloadableFiles("该版本没有可下载的模型文件")

    first = file_entries[0]
    result = {
        "url": first["url"],
        "filename": first["filename"],
        "save_dir": first["save_dir"],
        "model_type": first["dir_key"],
        "display_name": display_name,
        "info": info,
        "is_video": info.get("is_video", False),
        "files": file_entries,
    }
    if info.get("is_video"):
        result["pair_group"] = info.get("pair_group", "")

    return result
