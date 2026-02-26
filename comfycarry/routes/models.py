"""
ComfyCarry — 模型管理路由

包含:
- CivitAI 搜索代理 (Meilisearch CORS bypass)
- 本地模型管理 (扫描/预览/删除/获取信息)
- Enhanced-Civicomfy 下载代理
"""

import json
import os
from pathlib import Path

import requests
from flask import Blueprint, Response, jsonify, request, send_file

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
    "CheckpointLoaderSimple":  ("ckpt_name",          "checkpoints"),
    "CheckpointLoader":        ("ckpt_name",          "checkpoints"),
    "unCLIPCheckpointLoader":  ("ckpt_name",          "checkpoints"),
    "LoraLoader":              ("lora_name",          "loras"),
    "LoraLoaderModelOnly":     ("lora_name",          "loras"),
    "ControlNetLoader":        ("control_net_name",   "controlnet"),
    "VAELoader":               ("vae_name",           "vae"),
    "UNETLoader":              ("unet_name",          "unet"),
    "CLIPLoader":              ("clip_name",          "clip"),
    "DualCLIPLoader":          ("clip_name1",         "clip"),
    "UpscaleModelLoader":      ("model_name",         "upscale_models"),
    "StyleModelLoader":        ("style_model_name",   "style_models"),
    "IPAdapterModelLoader":    ("ipadapter_file",     "ipadapter"),
    "InstantIDModelLoader":    ("instantid_file",     "instantid"),
}

# DualCLIPLoader has two clip fields
_EXTRA_FIELDS = {
    "DualCLIPLoader": [("clip_name2", "clip")],
}


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

    return models


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
        # workflow 编辑器格式: nodes 数组中有 widgets_values
        # 尝试从 workflow.nodes 重建简化 prompt
        nodes = workflow.get("nodes", [])
        pseudo_prompt = {}
        for node in nodes:
            if not isinstance(node, dict):
                continue
            ct = node.get("type", "")
            node_id = str(node.get("id", ""))
            inputs_raw = node.get("widgets_values", [])
            input_defs = node.get("inputs", [])
            # 尝试将 widgets_values 映射到字段名
            # 简化做法: 如果 class_type 在映射表中, 只需找到对应值
            if ct in _MODEL_FIELD_MAP:
                field, category = _MODEL_FIELD_MAP[ct]
                # widgets_values 中的第一个字符串通常是模型名
                for val in (inputs_raw if isinstance(inputs_raw, list) else []):
                    if isinstance(val, str) and (
                        val.endswith(('.safetensors', '.ckpt', '.pt', '.pth', '.bin'))
                        or '/' in val  # 子目录的模型名
                        or val.count('.') >= 1  # 有扩展名
                    ):
                        pseudo_prompt[node_id] = {
                            "class_type": ct,
                            "inputs": {field: val}
                        }
                        break
            # DualCLIPLoader extra fields
            if ct in _EXTRA_FIELDS:
                for field, category in _EXTRA_FIELDS[ct]:
                    for val in (inputs_raw if isinstance(inputs_raw, list) else []):
                        if isinstance(val, str) and (
                            val.endswith(('.safetensors', '.ckpt', '.pt', '.pth', '.bin'))
                            or '/' in val
                        ):
                            if node_id not in pseudo_prompt:
                                pseudo_prompt[node_id] = {"class_type": ct, "inputs": {}}
                            pseudo_prompt[node_id]["inputs"][field] = val
                            break

        models = _extract_models_from_prompt(pseudo_prompt)
    else:
        return jsonify({"error": "需要 prompt 或 workflow 字段"}), 400

    # 检查本地存在性
    for m in models:
        m["exists"] = _check_model_exists(m["name"], m["type"])

    missing = sum(1 for m in models if not m["exists"])
    return jsonify({"models": models, "total": len(models), "missing": missing})
