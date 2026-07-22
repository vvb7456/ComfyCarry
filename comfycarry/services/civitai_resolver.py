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

logger = logging.getLogger(__name__)

_CIVITAI_API_BASE = "https://civitai.com/api/v1"

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

# 分离架构 (split-file): UNet 主权重 应进 diffusion_models 而非 checkpoints。
# §4.2 废弃盲重定向: CivitAI 整合包与 UNet 都标 "Checkpoint"、baseModel 相同,
# 下载前无法区分 → 一律先落 checkpoints/, 下载完成后读文件头判 detect_packaging
# 再归位 (保留 baseModel 子文件夹逻辑)。
# _SPLIT_FILE_BASE_KEYWORDS 仅用于 §4.2 完成钩子做"是否需要重新归位"的早期短路径:
# baseModel 不含任何分离架构关键词的 Checkpoint 不必读头, 直接保留在 checkpoints/。
_SPLIT_FILE_BASE_KEYWORDS = ("anima", "flux", "sd 3", "sd3", "hidream", "wan", "hunyuan", "lumina", "pixart", "krea", "z-image", "z image", "zimage", "chroma")


def _is_split_file_base_model(base_model: str) -> bool:
    """baseModel 是否含分离架构关键词 (用于完成钩子早期短路径)。

    §4.2: 不再用此函数做下载前盲重定向 — 整合包与 UNet baseModel 相同无法区分。
    仅在下载完成后, baseModel 不含任何分离架构关键词的 Checkpoint 不必读头,
    直接保留在 checkpoints/。
    """
    if not base_model:
        return False
    bm = base_model.lower()
    return any(k in bm for k in _SPLIT_FILE_BASE_KEYWORDS)


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
    """解析 CivitAI 版本 API 响应, 返回标准化结构"""
    model_info = version_data.get("model", {})
    model_type = model_info.get("type", "Checkpoint")
    files = version_data.get("files", [])

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

    # 模型类型 → 本地目录 key
    type_lower = model_type.lower()
    save_dir_key = _TYPE_TO_DIR_KEY.get(type_lower, "checkpoints")

    # §4.2 废弃盲重定向: 不再按 baseModel 把 Checkpoint 一律送 diffusion_models。
    # CivitAI 整合包与 UNet 主权重 baseModel 相同、type 都是 "Checkpoint",
    # 下载前无法区分。改为一律先落 checkpoints/, 下载完成后由完成钩子读文件头
    # 判 detect_packaging 再归位 (见 downloads.py:_on_civitai_complete)。
    # baseModel 子文件夹逻辑由 resolve_save_dir() 处理。

    # Early Access / 付费检测
    availability = version_data.get("availability", "Public")
    ea_config = version_data.get("earlyAccessConfig") or {}

    return {
        "model_id": model_info.get("id") or version_data.get("modelId"),
        "model_name": model_info.get("name", "Unknown"),
        "version_id": version_data.get("id"),
        "version_name": version_data.get("name", ""),
        "model_type": model_type,
        "base_model": version_data.get("baseModel", ""),
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


def resolve_save_dir(model_type: str, base_model: str = "") -> str:
    """
    CivitAI 模型类型 + base_model → 本地绝对路径.

    §4.2: 不再按 baseModel 把 Checkpoint 盲重定向到 diffusion_models —
    下载前无法区分整合包 vs UNet。改为永远按 CivitAI type 落 checkpoints/,
    真正的目录在下载完成后由 _on_civitai_complete 读文件头判 detect_packaging 修正。

    Args:
        model_type: CivitAI 类型字符串 (如 "Checkpoint", "LORA")
        base_model: CivitAI baseModel 字符串 (如 "SDXL 1.0", "Pony")

    Returns:
        绝对路径 (如 "/workspace/ComfyUI/models/checkpoints/SDXL 1.0")
    """
    type_lower = model_type.lower()
    dir_key = _TYPE_TO_DIR_KEY.get(type_lower, "checkpoints")

    # §4.2: 盲重定向已废弃 — 完成钩子按内容归位 (见 downloads.py)
    # 仅 baseModel 为分离架构关键词的 Checkpoint 才需后续归位判定,
    # 其余 (SDXL/Pony/SD1.5 整合包) 直接保留 checkpoints/。
    # 下载初始目录统一用 _TYPE_TO_DIR_KEY (Checkpoint → checkpoints/)。

    rel_dir = MODEL_DIRS.get(dir_key, f"models/{dir_key}")

    # 追加 baseModel 子文件夹
    if base_model and base_model.strip():
        sub = _sanitize_folder_name(base_model.strip())
        if sub:
            rel_dir = os.path.join(rel_dir, sub)

    return os.path.join(COMFYUI_DIR, rel_dir)


def _sanitize_folder_name(name: str) -> str:
    """清理文件夹名称，保留原始 baseModel 字符串但移除文件系统不安全字符"""
    clean = re.sub(r'[/\\:*?"<>|\x00-\x1f]', '_', name)
    clean = clean.strip('. ')
    # 防止残留的目录穿越序列
    if '..' in clean:
        clean = clean.replace('..', '_')
    return clean or ""


# ── 下载归位 (§4.2) ─────────────────────────────────────────────────────────
# 下载完成后按文件头判 detect_packaging, 把整合包/UNet 主权重落对目录。
#   - 整合包 (含 TE+VAE key) → checkpoints/
#   - 拆分 (UNet-only) → diffusion_models/
# 非 safetensors / 读头失败 → 保持原位 + warn (用户可手动处理)。
# baseModel 子文件夹跟随 (保持与 resolve_save_dir 的初始落盘一致)。
#
# 关键: ComfyUI 加载节点目录绑定 — CheckpointLoaderSimple 只读 checkpoints/,
#       UNETLoader 只读 diffusion_models/。文件必须物理落对目录。

def relocate_after_download(model_path: str, base_model: str) -> tuple[str, str]:
    """下载完成后按内容归位。

    Args:
        model_path: 下载完成的文件绝对路径
        base_model: CivitAI baseModel 字符串 (用于子文件夹定位)

    Returns:
        (new_path, action): action ∈ {'kept', 'moved_ckpt', 'moved_split', 'skip_unreadable'}。
        new_path 为归位后的最终绝对路径 (可能与入参相同)。
    """
    abs_path = Path(model_path).resolve()
    if not abs_path.is_file():
        return str(abs_path), 'skip_unreadable'

    # 短路径 1: 非 safetensors (gguf/.ckpt 等) → 默认 split, 但 gguf 在本计划不主动归位
    # (Phase 5 dev 硬件约束: UNetLoaderGGUF 为后续独立扩展)。
    if not abs_path.name.lower().endswith('.safetensors'):
        # GGUF 实践中恒 UNet-only → 应落 diffusion_models/, 但 GGUF 加载节点路径独立,
        # 当前不做物理移动 (UnetLoaderGGUF 读 models/unet/ 旧路径, 不在此处处理)。
        return str(abs_path), 'skip_unreadable'

    # 读头判形态
    from .arch_detect import detect_packaging_from_file
    pkg = detect_packaging_from_file(str(abs_path))

    # 当前所在目录 key
    try:
        rel = abs_path.relative_to(COMFYUI_DIR)
    except ValueError:
        return str(abs_path), 'skip_unreadable'

    parts = rel.parts  # ('models', 'checkpoints', '<baseModel sub>', filename) 等
    if len(parts) < 2 or parts[0] != 'models':
        return str(abs_path), 'skip_unreadable'

    current_dir_key = parts[1]
    want_key = 'checkpoints' if pkg == 'checkpoint' else 'diffusion_models'

    if current_dir_key == want_key:
        return str(abs_path), 'kept'

    # 需要移动: 构建目标目录 (保留 baseModel 子文件夹)
    rel_dir = MODEL_DIRS.get(want_key, f'models/{want_key}')
    sub = _sanitize_folder_name(base_model.strip()) if base_model and base_model.strip() else ''
    if sub:
        target_dir = os.path.join(COMFYUI_DIR, rel_dir, sub)
    else:
        target_dir = os.path.join(COMFYUI_DIR, rel_dir)
    os.makedirs(target_dir, exist_ok=True)
    new_path = os.path.join(target_dir, abs_path.name)

    # 同名冲突: 若目标已存在且大小一致, 视为已归位 (移除源副本); 否则覆盖目标。
    try:
        if os.path.exists(new_path):
            try:
                if os.path.getsize(new_path) == os.path.getsize(abs_path):
                    os.remove(str(abs_path))
                    logger.info(f"[civitai_resolver] 归位: 目标已存在同尺寸, 移除源副本 {abs_path.name}")
                    return new_path, 'moved_ckpt' if pkg == 'checkpoint' else 'moved_split'
            except OSError:
                pass
            os.replace(new_path, new_path + '.bak')  # 备份冲突文件
        os.rename(str(abs_path), new_path)
    except OSError as e:
        logger.warning(f"[civitai_resolver] 归位失败 {abs_path} → {new_path}: {e}")
        return str(abs_path), 'skip_unreadable'

    action = 'moved_ckpt' if pkg == 'checkpoint' else 'moved_split'
    logger.info(f"[civitai_resolver] 归位: {abs_path.name} {current_dir_key} → {want_key} ({action})")
    return new_path, action


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

    Returns:
      {
        "url": str,           # 下载直链
        "filename": str,      # 保存文件名
        "save_dir": str,      # 保存目录绝对路径
        "model_type": str,    # MODEL_DIRS key
        "display_name": str,  # 显示名称
        "info": {...},        # fetch_model_info 返回的完整信息
      }

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

    # 3. 文件名
    selected = info["selected_file"]
    filename = custom_filename or selected.get("name", "model.safetensors")
    filename = sanitize_filename(filename)

    # 4. 保存目录 (按 baseModel 子文件夹分类)
    save_dir = resolve_save_dir(info["model_type"], info.get("base_model", ""))

    # 5. 显示名称
    display_name = info["model_name"]
    if info["version_name"]:
        display_name += f" - {info['version_name']}"

    return {
        "url": info["download_url"],
        "filename": filename,
        "save_dir": save_dir,
        "model_type": info["save_dir_key"],
        "display_name": display_name,
        "info": info,
    }
