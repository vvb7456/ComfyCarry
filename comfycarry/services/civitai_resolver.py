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

_MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"}

# 分离架构关键词。**不再参与目录判定** —— 目录判定已整体迁到
# services/download_classify.py (依据 docs/DOWNLOAD_CLASSIFICATION_SPEC.md,
# 判据为 file.type / model.type / 扩展名, 且下载前定目录、不再归位)。
# 此表仅剩「是否视频架构」等辅助判断在用。
_SPLIT_FILE_BASE_KEYWORDS = ("anima", "flux", "sd 3", "sd3", "hidream", "wan", "hunyuan", "lumina", "pixart", "krea", "z-image", "z image", "zimage", "chroma")


def _is_split_file_base_model(base_model: str) -> bool:
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
    if not base_model:
        return False
    bm = base_model.lower()
    return any(k in bm for k in _VIDEO_BASE_MODEL_KEYWORDS)


# ── URL/ID 解析 ──────────────────────────────────────────────────────────────

def parse_civitai_input(input_str: str) -> dict:
    text = str(input_str).strip()
    if not text:
        raise ValueError("输入为空")

    if text.isdigit():
        return {"model_id": int(text), "version_id": None}

    if re.match(r"^\d+:\d+$", text):
        parts = text.split(":")
        return {"model_id": int(parts[0]), "version_id": int(parts[1])}

    url = text if text.startswith("http") else f"https://{text}"
    try:
        parsed = urlparse(url)
    except Exception:
        raise ValueError(f"无法解析输入: {text}")

    if parsed.hostname and "civitai.com" not in parsed.hostname:
        raise ValueError(f"不是 CivitAI 链接: {parsed.hostname}")

    path = parsed.path.rstrip("/")
    query = parse_qs(parsed.query)

    m = re.match(r"/api/download/models/(\d+)", path)
    if m:
        return {"model_id": None, "version_id": int(m.group(1))}

    m = re.match(r"/api/v\d+/models/(\d+)", path)
    if m:
        return {"model_id": int(m.group(1)), "version_id": None}

    m = re.match(r"/api/v\d+/model-versions/(\d+)", path)
    if m:
        return {"model_id": None, "version_id": int(m.group(1))}

    m = re.match(r"/model-versions/(\d+)", path)
    if m:
        return {"model_id": None, "version_id": int(m.group(1))}

    m = re.match(r"/models/(\d+)", path)
    if m:
        model_id = int(m.group(1))
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
    if not model_id and not version_id:
        raise ValueError("model_id 或 version_id 至少提供一个")

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

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

    version_data = versions[0]
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

    download_url = selected.get("downloadUrl", "")
    if not download_url:
        download_url = f"{_CIVITAI_API_BASE}/download/models/{version_data.get('id')}"

    if api_key and api_key.strip() and "token=" not in download_url:
        sep = "&" if "?" in download_url else "?"
        download_url += f"{sep}token={api_key}"

    # 目录判定按**文件**粒度进行 (见 download_classify), 这里给的是条目级兜底,
    # 仅供 UI 展示与旧调用方兼容。真正落盘用的是 resolve_civitai_download()
    # 里逐文件算出的 dir_key。
    type_lower = model_type.lower()
    save_dir_key = _TYPE_TO_DIR_KEY.get(type_lower, "checkpoints")

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

    if is_video_base_model(base_model):
        sel_files = select_primary_files(files)
        if not sel_files:
            sel_files = [selected]
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
    if not files:
        return None

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
        for f in files:
            if f.get("downloadUrl"):
                return f
        return None

    for f in valid:
        if f.get("primary"):
            return f

    safetensors = [f for f in valid if f.get("name", "").lower().endswith(".safetensors")]
    ckpt = [f for f in valid if f.get("name", "").lower().endswith((".ckpt", ".pt", ".pth"))]

    def _pruned_first(fl):
        return sorted(fl, key=lambda f: (0 if "pruned" in f.get("name", "").lower() else 1))

    if safetensors:
        return _pruned_first(safetensors)[0]

    if ckpt:
        return _pruned_first(ckpt)[0]

    for f in valid:
        if f.get("type") == "Model":
            return f

    return valid[0]


def _filter_valid_model_files(files: list[dict]) -> list[dict]:
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
        valid = [f for f in files if f.get("downloadUrl")]
    return valid


def select_primary_files(files: list[dict]) -> list[dict]:
    if not files:
        return []
    valid = _filter_valid_model_files(files)
    if not valid:
        return []

    seen = set()
    deduped = []
    for f in valid:
        key = (f.get("name", ""), f.get("downloadUrl", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)
    valid = deduped

    primaries = [f for f in valid if f.get("primary")]
    if primaries:
        return primaries

    def _sort_key(f):
        name = f.get("name", "").lower()
        return (0 if "pruned" in name else 1, name)
    return sorted(valid, key=_sort_key)


# ── 文件名处理 ───────────────────────────────────────────────────────────────

def sanitize_filename(name: str, max_length: int = 200) -> str:
    if not name:
        return "unnamed_model"

    if isinstance(name, bytes):
        try:
            name = name.decode("utf-8")
        except UnicodeDecodeError:
            name = name.decode("latin-1")

    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    name = name.strip(" .")

    if not name:
        return "unnamed_model"

    reserved = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(10)} | {f"LPT{i}" for i in range(10)}
    stem = os.path.splitext(name)[0].upper()
    if stem in reserved:
        name = "_" + name

    if len(name) > max_length:
        base, ext = os.path.splitext(name)
        name = base[: max_length - len(ext)] + ext

    return name


def save_dir_for_key(dir_key: str, base_model: str = "") -> str:
    """baseModel 子文件夹沿用原有约定 (如 models/checkpoints/SDXL 1.0/)。"""
    rel_dir = MODEL_DIRS.get(dir_key, f"models/{dir_key}")
    if base_model and base_model.strip():
        sub = _sanitize_folder_name(base_model.strip())
        if sub:
            rel_dir = os.path.join(rel_dir, sub)
    return os.path.join(COMFYUI_DIR, rel_dir)


def build_download_url(file_obj: dict, version_id, api_key: str = "") -> str:
    """token 走 query 参数而非 Authorization 头 —— Civitai 会 307 到 R2 预签名 URL,
    预签名自带签名, 再带 Authorization 会被 S3 判双重鉴权返 400。
    """
    url = file_obj.get("downloadUrl", "") or f"{_CIVITAI_API_BASE}/download/models/{version_id}"
    if api_key and api_key.strip() and "token=" not in url:
        url += ("&" if "?" in url else "?") + f"token={api_key}"
    return url


def resolve_save_dir(model_type: str, base_model: str = "") -> str:
    """[兼容保留] 仅供旧调用方与 UI 展示用的条目级兜底; 真正的落盘目录由
    resolve_civitai_download() 逐文件判定 (services/download_classify.classify_file)。"""
    dir_key = _TYPE_TO_DIR_KEY.get((model_type or "").lower(), "checkpoints")
    return save_dir_for_key(dir_key, base_model)


def _sanitize_folder_name(name: str) -> str:
    clean = re.sub(r'[/\\:*?"<>|\x00-\x1f]', '_', name)
    clean = clean.strip('. ')
    if '..' in clean:
        clean = clean.replace('..', '_')
    return clean or ""


# ── 文件元数据提取 ────────────────────────────────────────────────────────────

def extract_file_trigger_words(model_path: str) -> list[str]:
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

    trigger = meta.get("modelspec.trigger_phrase", "")
    if trigger:
        for part in trigger.split(","):
            _add(part)

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
            for tag, _ in sorted(merged.items(), key=lambda x: x[1], reverse=True):
                _add(tag)
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"[civitai_resolver] ss_tag_frequency 解析失败: {e}")

    return words


def normalize_version_data(version_data: dict) -> dict:
    """仅提取元数据字段, 不做文件选择或下载 URL 构建。"""
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


def enrich_model_by_hash(
    model_path: str,
    api_key: str = "",
    local_model_id: int | None = None,
) -> dict | None:
    abs_path = Path(model_path).resolve()
    if not abs_path.is_file():
        logger.warning(f"[civitai_resolver] enrich: 文件不存在 {abs_path}")
        return None

    from .model_meta_store import get_or_compute_model_sha256
    from ..db import db

    if local_model_id is None:
        row = db.fetch_one(
            "SELECT id FROM models WHERE real_path = ?",
            (str(abs_path),),
        )
        if row is None:
            logger.warning(f"[civitai_resolver] enrich: 模型索引中不存在 {abs_path}")
            return None
        local_model_id = int(row["id"])

    # Reuse the indexed hash while size + mtime still match.  A newly
    # computed hash is persisted before the remote request, including the
    # CivitAI 404 path, so retries do not scan a multi-GB file again.
    sha256 = get_or_compute_model_sha256(local_model_id, abs_path, _sha256_file)
    if not sha256:
        logger.warning(f"[civitai_resolver] enrich: SHA256 计算失败 {abs_path}")
        return None

    # Extract local trigger words before contacting CivitAI.  They remain
    # useful even when the hash is not present in the remote catalogue.
    file_words = extract_file_trigger_words(str(abs_path))

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        url = f"{_CIVITAI_API_BASE}/model-versions/by-hash/{sha256}"
        resp = http_requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 404:
            logger.info(f"[civitai_resolver] enrich: CivitAI 未找到 {sha256[:16]}...")
            from .model_meta_store import enrich_model
            enrich_model(
                model_id=local_model_id,
                source_data={},
                sha256=sha256,
                file_trigger_words=file_words,
            )
            return None
        resp.raise_for_status()
        version_data = resp.json()
    except Exception as e:
        logger.warning(f"[civitai_resolver] enrich: API 失败 {e}")
        return None

    info = normalize_version_data(version_data)

    # 从 safetensors 文件头提取训练触发词
    # 更新预览图 (by-hash 返回的 images 可能更丰富)
    download_preview_image(str(abs_path), info.get("images", []))

    from .model_meta_store import enrich_model
    detail = enrich_model(
        model_id=local_model_id,
        source_data=info,
        sha256=sha256,
        file_trigger_words=file_words,
    )

    logger.info(f"[civitai_resolver] enrich 完成: {abs_path.name}")
    return detail


def download_preview_image(model_path: str, images: list[dict]) -> str | None:
    if not images:
        return None

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
    parsed = parse_civitai_input(input_str)
    model_id = parsed["model_id"]
    vid = version_id or parsed["version_id"]

    info = fetch_model_info(
        model_id=model_id,
        version_id=vid,
        api_key=api_key,
    )

    base_model = info.get("base_model", "")
    entry_type = info.get("model_type", "")

    selected = info["selected_file"]
    if info.get("is_video"):
        sel_files = info.get("selected_files") or [selected]
    else:
        sel_files = [selected]

    # 关键: 粒度是**文件**不是版本 —— 同一 version 可以同时含主权重 + VAE,
    # 共用一个 save_dir 会让 VAE 落进 diffusion_models/ 从而在 UI 里消失。
    file_entries = []
    pending = []
    skipped = []
    for i, f in enumerate(sel_files):
        fname = f.get("name", "model.safetensors")
        # custom_filename 仅作用于第一个文件, 其余用 Civitai 原名 (避免重名)
        if i == 0 and custom_filename:
            fname = custom_filename
        fname = sanitize_filename(fname)

        dir_key = (dir_keys or {}).get(fname) or (dir_keys or {}).get(f.get("name", ""))
        if not dir_key:
            dir_key = classify_file(
                model_type=entry_type,
                file_type=f.get("type", ""),
                filename=f.get("name", "") or fname,
                base_model=base_model,
            )

        if dir_key == CLASSIFY_SKIP:
            skipped.append(fname)
            continue
        if dir_key == CLASSIFY_FOLLOW_PRIMARY:
            # .yaml/.json 伴随文件跟随主文件 —— 主文件目录稍后回填
            dir_key = None
        if dir_key == CLASSIFY_MANUAL:
            # token 已在 furl 的 query 参数里 (见上方拼接), 探针不带 Authorization
            # 头 —— 跟随 307 到 R2 预签名 URL 时带 auth 会触发 S3 双重鉴权 400。
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
                    from .header_probe import ProbeAuthError
                    if isinstance(e, ProbeAuthError):
                        raise
                    probe_dir = None
                    logger.debug(f"[civitai_resolver] 探针失败, 落回 MANUAL: {e}")

                if probe_dir:
                    dir_key = probe_dir

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

    display_name = info["model_name"]
    if info["version_name"]:
        display_name += f" - {info['version_name']}"

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
