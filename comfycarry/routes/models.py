"""
ComfyCarry — 模型管理路由

包含:
- CivitAI 搜索代理 (Meilisearch CORS bypass)
- 本地模型管理 (扫描/预览/删除/获取信息)
- Enhanced-Civicomfy 下载代理
"""

import io
import json
import os
import struct
import zlib
from pathlib import Path

import requests
from flask import Blueprint, Response, jsonify, request, send_file
from PIL import Image

from ..config import (
    COMFYUI_DIR,
    COMFYUI_URL,
    MEILI_BEARER,
    MEILI_URL,
    MODEL_DIRS,
    MODEL_EXTENSIONS,
)
from ..utils import _get_api_key, _sha256_file

bp = Blueprint("models", __name__)


# ====================================================================
# CivitAI 搜索代理 (Meilisearch CORS bypass)
# ====================================================================
@bp.route("/api/search", methods=["POST"])
def proxy_search():
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({"error": "No JSON body"}), 400

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MEILI_BEARER}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        resp = requests.post(MEILI_URL, headers=headers, json=data, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 本地模型管理 API
# ====================================================================
@bp.route("/api/local_models")
def api_local_models():
    """扫描本地模型文件"""
    category = request.args.get("category", "all")
    results = []

    dirs_to_scan = MODEL_DIRS if category == "all" else {category: MODEL_DIRS.get(category, "")}

    for cat, rel_dir in dirs_to_scan.items():
        full_dir = os.path.join(COMFYUI_DIR, rel_dir)
        if not os.path.isdir(full_dir):
            continue
        for root, _, files in os.walk(full_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in MODEL_EXTENSIONS:
                    continue
                fpath = os.path.join(root, fname)
                rel_path = os.path.relpath(fpath, os.path.join(COMFYUI_DIR, rel_dir))
                stat = os.stat(fpath)

                # Check for metadata files
                base_no_ext = os.path.splitext(fpath)[0]
                info_path = f"{fpath}.weilin-info.json"
                info_data = None
                if os.path.exists(info_path):
                    try:
                        with open(info_path, "r", encoding="utf-8") as f:
                            info_data = json.load(f)
                    except Exception:
                        pass

                # Check for preview image
                preview = None
                for pext in [".jpg", ".png", ".jpeg", ".webp"]:
                    ppath = base_no_ext + pext
                    if os.path.exists(ppath):
                        preview = os.path.relpath(ppath, COMFYUI_DIR)
                        break

                entry = {
                    "filename": fname,
                    "rel_path": rel_path,
                    "category": cat,
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                    "abs_path": fpath,
                    "has_info": info_data is not None,
                    "has_preview": preview is not None,
                    "preview_path": preview,
                }

                if info_data:
                    entry["name"] = info_data.get("name", fname)
                    entry["base_model"] = info_data.get("baseModel", "")
                    entry["type"] = info_data.get("type", cat)
                    entry["trained_words"] = [
                        w.get("word", "") for w in info_data.get("trainedWords", [])
                    ]
                    entry["links"] = info_data.get("links", [])
                    # CivitAI IDs from raw data
                    raw_civitai = info_data.get("raw", {}).get("civitai", {})
                    entry["civitai_id"] = raw_civitai.get("modelId")
                    entry["civitai_version_id"] = raw_civitai.get("id")
                    entry["version_name"] = raw_civitai.get("name", "")
                    entry["sha256"] = info_data.get("sha256", "")
                    # Images from info (full array)
                    imgs = info_data.get("images", [])
                    entry["images"] = imgs
                    if imgs:
                        entry["civitai_image"] = imgs[0].get("url", "")
                else:
                    entry["name"] = fname
                    entry["base_model"] = ""
                    entry["type"] = cat
                    entry["trained_words"] = []

                results.append(entry)

    results.sort(key=lambda x: x["modified"], reverse=True)
    return jsonify({"models": results, "total": len(results)})


@bp.route("/api/local_models/preview")
def api_model_preview():
    """返回模型预览图"""
    rel = request.args.get("path", "")
    full = Path(COMFYUI_DIR, rel).resolve()
    # 路径安全检查: 必须在 COMFYUI_DIR 内
    if not full.is_relative_to(Path(COMFYUI_DIR).resolve()):
        return jsonify({"error": "路径越界"}), 403
    if full.is_file():
        return send_file(full)
    return "", 404


@bp.route("/api/local_models/delete", methods=["POST"])
def api_delete_model():
    """删除本地模型及其关联文件"""
    data = request.get_json(force=True) or {}
    abs_path = Path(data.get("abs_path", "")).resolve()
    comfy_root = Path(COMFYUI_DIR).resolve()

    # 安全检查: resolve() + is_relative_to()
    if not abs_path.is_relative_to(comfy_root):
        return jsonify({"error": "路径不在 ComfyUI 目录内"}), 403

    if not abs_path.is_file():
        return jsonify({"error": "文件不存在"}), 404

    deleted = [str(abs_path)]
    abs_path.unlink()

    # 删除关联文件
    base_no_ext = abs_path.with_suffix("")
    for suffix in [".weilin-info.json", ".jpg", ".png", ".jpeg", ".webp", ".civitai.info"]:
        companion = Path(str(abs_path) + suffix) if suffix.startswith(".weilin") else base_no_ext.with_suffix(suffix)
        if companion.exists():
            companion.unlink()
            deleted.append(str(companion))

    return jsonify({"ok": True, "deleted": deleted})


@bp.route("/api/local_models/fetch_info", methods=["POST"])
def api_fetch_model_info():
    """通过 SHA256 从 CivitAI 获取模型元数据并保存"""
    data = request.get_json(force=True) or {}
    abs_path = Path(data.get("abs_path", "")).resolve()
    comfy_root = Path(COMFYUI_DIR).resolve()

    # 安全检查: resolve() + is_relative_to()
    if not abs_path.is_relative_to(comfy_root):
        return jsonify({"error": "路径不在 ComfyUI 目录内"}), 403

    if not abs_path.is_file():
        return jsonify({"error": "文件不存在"}), 404

    # 计算 SHA256
    file_hash = _sha256_file(abs_path)
    if not file_hash:
        return jsonify({"error": "无法计算哈希"}), 500

    # 调用 CivitAI API
    api_key = _get_api_key()
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        api_url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
        resp = requests.get(api_url, headers=headers, timeout=30)
        if resp.status_code == 404:
            return jsonify({"error": "CivitAI 未找到该模型", "hash": file_hash}), 404
        resp.raise_for_status()
        civitai_data = resp.json()
    except Exception as e:
        return jsonify({"error": f"API 请求失败: {e}", "hash": file_hash}), 500

    # 构建 weilin-info.json
    info_data = {
        "file": abs_path.name,
        "path": str(abs_path),
        "sha256": file_hash,
        "name": civitai_data.get("model", {}).get("name", ""),
        "type": civitai_data.get("model", {}).get("type", ""),
        "baseModel": civitai_data.get("baseModel", ""),
        "images": [],
        "trainedWords": [],
        "links": [],
        "raw": {"civitai": civitai_data},
    }

    # 版本名
    ver_name = civitai_data.get("name", "")
    if ver_name:
        info_data["name"] += f" - {ver_name}"

    # 触发词
    trigger_words = civitai_data.get("trainedWords", [])
    for w in trigger_words:
        info_data["trainedWords"].append({"word": w, "civitai": True})

    # Links
    model_id = civitai_data.get("modelId")
    version_id = civitai_data.get("id")
    if model_id:
        link = f"https://civitai.com/models/{model_id}"
        if version_id:
            link += f"?modelVersionId={version_id}"
        info_data["links"].append(link)

    # 图片
    for img in civitai_data.get("images", []):
        img_url = img.get("url", "")
        if img_url:
            img_entry = {
                "url": img_url,
                "type": img.get("type", "image"),
                "width": img.get("width"),
                "height": img.get("height"),
                "nsfwLevel": img.get("nsfwLevel"),
            }
            meta = img.get("meta") or {}
            if meta:
                img_entry["positive"] = meta.get("prompt", "")
                img_entry["negative"] = meta.get("negativePrompt", "")
                img_entry["seed"] = meta.get("seed")
                img_entry["sampler"] = meta.get("sampler")
                img_entry["cfg"] = meta.get("cfgScale")
                img_entry["steps"] = meta.get("steps")
                img_entry["model"] = meta.get("Model")
            info_data["images"].append(img_entry)

    # 保存 info json
    info_path = str(abs_path) + ".weilin-info.json"
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info_data, f, sort_keys=False, indent=2, ensure_ascii=False)

    # 下载预览图
    base_no_ext = abs_path.with_suffix("")
    if info_data["images"]:
        first_img_url = info_data["images"][0].get("url", "")
        if first_img_url:
            try:
                with requests.get(first_img_url, timeout=15, stream=True) as img_resp:
                    img_resp.raise_for_status()
                    ct = img_resp.headers.get("Content-Type", "")
                    ext = ".png"
                    if "jpeg" in ct or "jpg" in ct:
                        ext = ".jpeg"
                    elif "webp" in ct:
                        ext = ".webp"
                    preview_path = str(base_no_ext) + ext
                    with open(preview_path, "wb") as pf:
                        for chunk in img_resp.iter_content(4096):
                            pf.write(chunk)
                    info_data["_preview_saved"] = preview_path
            except Exception:
                pass

    return jsonify({"ok": True, "info": info_data, "hash": file_hash})


# ====================================================================
# Enhanced-Civicomfy 下载代理
# ====================================================================
@bp.route("/api/download", methods=["POST"])
def api_download_model():
    """代理请求到 ComfyUI 的 Enhanced-Civicomfy 下载接口"""
    data = request.get_json(force=True) or {}
    api_key = data.get("api_key") or _get_api_key()

    payload = {
        "model_url_or_id": data.get("model_id", ""),
        "model_type": data.get("model_type", "checkpoint"),
        "api_key": api_key,
        "num_connections": data.get("num_connections", 4),
    }
    if data.get("version_id"):
        payload["model_version_id"] = int(data["version_id"])
    if data.get("custom_filename"):
        payload["custom_filename"] = data["custom_filename"]

    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/download", json=payload, timeout=30)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "ComfyUI 未运行，无法下载。请先启动 ComfyUI 服务。"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/download/status")
def api_download_status():
    """获取 Civicomfy 下载状态"""
    try:
        resp = requests.get(f"{COMFYUI_URL}/civitai/status", timeout=5)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception:
        return jsonify({"queue": [], "active": [], "history": []}), 200


@bp.route("/api/download/cancel", methods=["POST"])
def api_download_cancel():
    """取消指定下载任务"""
    data = request.get_json(force=True) or {}
    download_id = data.get("download_id", "")
    if not download_id:
        return jsonify({"error": "download_id required"}), 400
    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/cancel", json={"download_id": download_id}, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/download/retry", methods=["POST"])
def api_download_retry():
    """重试失败/取消的下载"""
    data = request.get_json(force=True) or {}
    download_id = data.get("download_id", "")
    if not download_id:
        return jsonify({"error": "download_id required"}), 400
    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/retry", json={"download_id": download_id}, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/download/clear_history", methods=["POST"])
def api_download_clear_history():
    """清除下载历史"""
    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/clear_history", json={}, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 工作流模型依赖解析
# ====================================================================

# 节点 class_type → (输入字段, 模型类别)
_MODEL_FIELD_MAP = {
    # Checkpoints
    "CheckpointLoaderSimple":  ("ckpt_name",          "checkpoints"),
    "CheckpointLoader":        ("ckpt_name",          "checkpoints"),
    "unCLIPCheckpointLoader":  ("ckpt_name",          "checkpoints"),
    # LoRA
    "LoraLoader":              ("lora_name",          "loras"),
    "LoraLoaderModelOnly":     ("lora_name",          "loras"),
    # ControlNet
    "ControlNetLoader":        ("control_net_name",   "controlnet"),
    # VAE
    "VAELoader":               ("vae_name",           "vae"),
    # UNET
    "UNETLoader":              ("unet_name",          "unet"),
    # CLIP
    "CLIPLoader":              ("clip_name",          "clip"),
    "DualCLIPLoader":          ("clip_name1",         "clip"),
    "TripleCLIPLoader":        ("clip_name1",         "clip"),
    # CLIP Vision
    "CLIPVisionLoader":        ("clip_name",          "clip_vision"),
    # Upscale
    "UpscaleModelLoader":      ("model_name",         "upscale_models"),
    # Style / IP-Adapter / InstantID
    "StyleModelLoader":        ("style_model_name",   "style_models"),
    "IPAdapterModelLoader":    ("ipadapter_file",     "ipadapter"),
    "InstantIDModelLoader":    ("instantid_file",     "instantid"),
    # Hypernetwork / GLIGEN / PhotoMaker / PuLID
    "HypernetworkLoader":      ("hypernetwork_name",  "hypernetworks"),
    "GLIGENLoader":            ("gligen_name",        "gligen"),
    "PhotoMakerLoader":        ("photomaker_model_name", "photomaker"),
    "PuLIDModelLoader":        ("pulid_file",         "pulid"),
    # Diffusers
    "DiffusersLoader":         ("model_path",         "diffusers"),
}

# 额外字段 (同一节点有多个模型字段)
_EXTRA_FIELDS = {
    "DualCLIPLoader":   [("clip_name2", "clip")],
    "TripleCLIPLoader": [("clip_name2", "clip"), ("clip_name3", "clip")],
}

# 已知节点的 widget 字段索引映射 (用于 workflow 编辑器格式解析)
# key=字段名, value=widgets_values 数组中的索引位置
_WIDGET_INDEX_MAP = {
    "CheckpointLoaderSimple": {"ckpt_name": 0},
    "CheckpointLoader":       {"ckpt_name": 0},
    "unCLIPCheckpointLoader": {"ckpt_name": 0},
    "LoraLoader":             {"lora_name": 0},
    "LoraLoaderModelOnly":    {"lora_name": 0},
    "ControlNetLoader":       {"control_net_name": 0},
    "VAELoader":              {"vae_name": 0},
    "UNETLoader":             {"unet_name": 0},
    "CLIPLoader":             {"clip_name": 0},
    "DualCLIPLoader":         {"clip_name1": 0, "clip_name2": 1},
    "TripleCLIPLoader":       {"clip_name1": 0, "clip_name2": 1, "clip_name3": 2},
    "CLIPVisionLoader":       {"clip_name": 0},
    "UpscaleModelLoader":     {"model_name": 0},
    "StyleModelLoader":       {"style_model_name": 0},
    "IPAdapterModelLoader":   {"ipadapter_file": 0},
    "InstantIDModelLoader":   {"instantid_file": 0},
    "HypernetworkLoader":     {"hypernetwork_name": 0},
    "GLIGENLoader":           {"gligen_name": 0},
    "PhotoMakerLoader":       {"photomaker_model_name": 0},
    "PuLIDModelLoader":       {"pulid_file": 0},
    "DiffusersLoader":        {"model_path": 0},
}


def _extract_metadata_from_image(file_bytes: bytes, filename: str) -> dict:
    """从 ComfyUI 生成的图片文件中提取 prompt/workflow 元数据

    支持格式:
      - PNG (静态): tEXt chunk — keys 'prompt' / 'workflow'
      - PNG (APNG): 自定义 'comf' chunk — key\\x00value 格式
      - WebP: EXIF 0x0110 (Model) / 0x010F (Make) — "key:json"
      - SVG: <metadata> CDATA 中的 JSON

    Returns: {"prompt": dict|None, "workflow": dict|None, "format": str}
    """
    ext = os.path.splitext(filename)[1].lower()
    result = {"prompt": None, "workflow": None, "format": ext.lstrip(".")}

    try:
        if ext == ".svg":
            return _extract_metadata_from_svg(file_bytes, result)
        elif ext in (".png", ".webp", ".jpg", ".jpeg"):
            img = Image.open(io.BytesIO(file_bytes))

            if ext == ".png":
                # 静态 PNG: tEXt chunks
                if hasattr(img, "text") and img.text:
                    for key in ("prompt", "workflow"):
                        if key in img.text:
                            try:
                                result[key] = json.loads(img.text[key])
                            except (json.JSONDecodeError, TypeError):
                                pass

                # APNG: 自定义 'comf' chunk (tEXt 可能为空)
                if not result["prompt"] and not result["workflow"]:
                    result = _parse_apng_comf_chunks(file_bytes, result)

            elif ext == ".webp":
                # WebP: EXIF tags (Model=0x0110, Make=0x010F, ...)
                exif = img.getexif()
                for tag_id in (0x0110, 0x010F, 0x010E, 0x010D):
                    if tag_id in exif:
                        raw = exif[tag_id]
                        if isinstance(raw, str) and ":" in raw:
                            key, val = raw.split(":", 1)
                            key = key.strip().lower()
                            if key in ("prompt", "workflow"):
                                try:
                                    result[key] = json.loads(val)
                                except (json.JSONDecodeError, TypeError):
                                    pass

            elif ext in (".jpg", ".jpeg"):
                # JPEG: ComfyUI 核心不支持, 但某些第三方节点
                # 可能在 EXIF UserComment 中存储
                exif = img.getexif()
                # 尝试与 WebP 相同的 tag
                for tag_id in (0x0110, 0x010F):
                    if tag_id in exif:
                        raw = exif[tag_id]
                        if isinstance(raw, str) and ":" in raw:
                            key, val = raw.split(":", 1)
                            key = key.strip().lower()
                            if key in ("prompt", "workflow"):
                                try:
                                    result[key] = json.loads(val)
                                except (json.JSONDecodeError, TypeError):
                                    pass
            img.close()
    except Exception:
        pass

    return result


def _parse_apng_comf_chunks(data: bytes, result: dict) -> dict:
    """解析 APNG 中的自定义 'comf' chunk"""
    if len(data) < 8 or data[:8] != b'\x89PNG\r\n\x1a\n':
        return result
    pos = 8
    while pos + 8 <= len(data):
        try:
            length = struct.unpack(">I", data[pos:pos + 4])[0]
            chunk_type = data[pos + 4:pos + 8]
            chunk_data = data[pos + 8:pos + 8 + length]
            # CRC 4 bytes after chunk data
            pos += 12 + length

            if chunk_type == b'comf' and b'\x00' in chunk_data:
                sep = chunk_data.index(b'\x00')
                key = chunk_data[:sep].decode("latin-1", errors="replace")
                val = chunk_data[sep + 1:].decode("latin-1", errors="replace")
                if key in ("prompt", "workflow"):
                    try:
                        result[key] = json.loads(val)
                    except (json.JSONDecodeError, TypeError):
                        pass
            elif chunk_type == b'IEND':
                # 不要在 IEND 后退出, comf chunks 可能在 IEND 之后
                continue
        except (struct.error, IndexError):
            break
    return result


def _extract_metadata_from_svg(data: bytes, result: dict) -> dict:
    """从 SVG 的 <metadata> 标签中提取 ComfyUI 工作流元数据"""
    try:
        text = data.decode("utf-8", errors="replace")
        import re
        # ComfyUI SVG 格式: <metadata><![CDATA[{json}]]></metadata>
        match = re.search(
            r'<metadata>\s*<!\[CDATA\[(.*?)\]\]>\s*</metadata>',
            text, re.DOTALL
        )
        if match:
            meta_json = json.loads(match.group(1))
            if isinstance(meta_json, dict):
                result["prompt"] = meta_json.get("prompt")
                result["workflow"] = meta_json.get("workflow")
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return result


def _extract_models_from_prompt(prompt: dict) -> list[dict]:
    """从 ComfyUI prompt JSON 中提取模型引用列表"""
    seen = set()
    models = []

    for _node_id, node in prompt.items():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type", "")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue

        # 主字段
        if class_type in _MODEL_FIELD_MAP:
            field, category = _MODEL_FIELD_MAP[class_type]
            name = inputs.get(field)
            if name and isinstance(name, str) and name not in seen:
                seen.add(name)
                models.append({"name": name, "type": category, "field": field, "node": class_type})

        # 额外字段 (如 DualCLIPLoader 的 clip_name2)
        if class_type in _EXTRA_FIELDS:
            for field, category in _EXTRA_FIELDS[class_type]:
                name = inputs.get(field)
                if name and isinstance(name, str) and name not in seen:
                    seen.add(name)
                    models.append({"name": name, "type": category, "field": field, "node": class_type})

        # Fallback: 对于未知节点，扫描 inputs 中以模型扩展名结尾的值
        if class_type not in _MODEL_FIELD_MAP:
            for field, val in inputs.items():
                if not isinstance(val, str) or val in seen:
                    continue
                if any(val.lower().endswith(ext) for ext in MODEL_EXTENSIONS):
                    seen.add(val)
                    models.append({"name": val, "type": "unknown", "field": field, "node": class_type})

    return models


def _extract_models_from_workflow(workflow: dict) -> list[dict]:
    """从 ComfyUI workflow 编辑器格式中提取模型引用列表

    将 workflow.nodes 中的 widgets_values 通过 _WIDGET_INDEX_MAP
    映射为 pseudo_prompt，然后委托给 _extract_models_from_prompt()
    """
    nodes = workflow.get("nodes", [])
    pseudo_prompt = {}

    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        ct = node.get("type", "")
        node_id = str(node.get("id", f"_auto_{i}"))
        widgets = node.get("widgets_values", [])
        if not isinstance(widgets, list):
            continue

        inputs_dict = {}

        if ct in _WIDGET_INDEX_MAP:
            idx_map = _WIDGET_INDEX_MAP[ct]
            for field, idx in idx_map.items():
                if idx < len(widgets) and isinstance(widgets[idx], str):
                    inputs_dict[field] = widgets[idx]
        else:
            for j, val in enumerate(widgets):
                if isinstance(val, str) and any(val.lower().endswith(ext) for ext in MODEL_EXTENSIONS):
                    inputs_dict[f"_unknown_field_{j}"] = val

        if inputs_dict:
            pseudo_prompt[node_id] = {"class_type": ct, "inputs": inputs_dict}

    return _extract_models_from_prompt(pseudo_prompt)


def _check_model_exists(name: str, category: str) -> bool:
    """检查模型文件是否存在于本地"""
    rel_dir = MODEL_DIRS.get(category, "")
    if not rel_dir:
        # 未知类别 — 搜索所有目录
        for _cat, rd in MODEL_DIRS.items():
            full = os.path.join(COMFYUI_DIR, rd, name)
            if os.path.isfile(full):
                return True
        return False
    full = os.path.join(COMFYUI_DIR, rel_dir, name)
    return os.path.isfile(full)


@bp.route("/api/models/parse-workflow", methods=["POST"])
def api_parse_workflow():
    """
    解析工作流 JSON，提取模型引用并检查本地是否存在

    Body: { "prompt": {...} }   — ComfyUI prompt 格式
      或  { "workflow": {...} } — ComfyUI workflow 编辑器格式 (自动从中提取 prompt)

    Response: {
        "models": [
            {"name": "xx.safetensors", "type": "checkpoints", "exists": true, "node": "CheckpointLoaderSimple"},
            ...
        ],
        "total": 4,
        "missing": 2
    }
    """
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    prompt = data.get("prompt")
    workflow = data.get("workflow")

    if prompt and isinstance(prompt, dict):
        models = _extract_models_from_prompt(prompt)
    elif workflow and isinstance(workflow, dict):
        models = _extract_models_from_workflow(workflow)
    else:
        return jsonify({"error": "需要 prompt 或 workflow 字段"}), 400

    # 检查本地存在性
    for m in models:
        m["exists"] = _check_model_exists(m["name"], m["type"])

    missing = sum(1 for m in models if not m["exists"])
    return jsonify({"models": models, "total": len(models), "missing": missing})


# ====================================================================
#  文件上传解析 — 从图片/SVG 中提取工作流元数据并解析模型依赖
# ====================================================================

_ALLOWED_IMAGE_EXTS = {".png", ".webp", ".jpg", ".jpeg", ".svg"}
_MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB


@bp.route("/api/models/parse-image", methods=["POST"])
def api_parse_image():
    """
    从上传的图片文件中提取 ComfyUI 工作流元数据并解析模型依赖

    支持: PNG (含 APNG)、WebP、SVG、JPEG (有限)

    Body: multipart/form-data
      - file: 图片文件

    Response: {
        "format": "png",
        "has_prompt": true,
        "has_workflow": true,
        "models": [...],
        "total": 4,
        "missing": 2
    }
    """
    if "file" not in request.files:
        return jsonify({"error": "需要上传文件 (field name: file)"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "文件名为空"}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in _ALLOWED_IMAGE_EXTS:
        return jsonify({
            "error": f"不支持的文件格式: {ext}",
            "supported": list(_ALLOWED_IMAGE_EXTS),
        }), 400

    file_bytes = f.read()
    if len(file_bytes) > _MAX_UPLOAD_SIZE:
        return jsonify({"error": f"文件过大 (最大 {_MAX_UPLOAD_SIZE // 1024 // 1024} MB)"}), 400

    # 提取元数据
    meta = _extract_metadata_from_image(file_bytes, f.filename)

    prompt = meta.get("prompt")
    workflow = meta.get("workflow")

    if not prompt and not workflow:
        return jsonify({
            "error": "未在文件中找到 ComfyUI 工作流元数据",
            "format": meta.get("format", ext.lstrip(".")),
            "hint": "文件可能不是由 ComfyUI 生成，或元数据已被清除",
        }), 404

    # 复用共享解析逻辑
    models = []
    if prompt and isinstance(prompt, dict):
        models = _extract_models_from_prompt(prompt)
    elif workflow and isinstance(workflow, dict):
        models = _extract_models_from_workflow(workflow)

    # 检查本地存在性
    for m in models:
        m["exists"] = _check_model_exists(m["name"], m["type"])

    missing = sum(1 for m in models if not m["exists"])
    return jsonify({
        "format": meta.get("format", ext.lstrip(".")),
        "has_prompt": prompt is not None,
        "has_workflow": workflow is not None,
        "models": models,
        "total": len(models),
        "missing": missing,
    })
