"""
ComfyCarry — 模型管理路由

包含:
- CivitAI 搜索代理 (Meilisearch CORS bypass)
- 本地模型管理 (扫描/预览/删除/获取信息)
- Enhanced-Civicomfy 下载代理
"""

import json
import os
import re
import subprocess
import threading
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
from ..utils import _get_api_key, _run_cmd, _sha256_file

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
# HuggingFace 模型直接下载
# ====================================================================
_hf_download_procs: dict[str, subprocess.Popen] = {}  # filename → Popen

@bp.route("/api/models/download-hf", methods=["POST"])
def api_download_hf():
    """通过 aria2c 下载 HuggingFace 模型到对应 MODEL_DIRS 目录"""
    data = request.get_json(force=True) or {}
    url = data.get("url", "").strip()
    filename = data.get("filename", "").strip()
    model_type = data.get("type", "").strip()

    if not url or not filename:
        return jsonify({"error": "url 和 filename 必填"}), 400

    # 确定保存目录
    rel_dir = MODEL_DIRS.get(model_type)
    if not rel_dir:
        # fallback: 放到 models/<type>
        rel_dir = f"models/{model_type}" if model_type else "models/other"

    save_dir = Path(COMFYUI_DIR) / rel_dir
    save_dir.mkdir(parents=True, exist_ok=True)
    dest = save_dir / filename

    if dest.exists():
        return jsonify({"ok": True, "msg": f"{filename} 已存在，跳过下载"}), 200

    # aria2c 后台下载
    def _do_download():
        try:
            cmd = [
                "aria2c", "-x", "8", "-s", "8",
                "--file-allocation=falloc",
                "-d", str(save_dir),
                "-o", filename,
                url,
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _hf_download_procs[filename] = proc
            proc.wait(timeout=3600)
        except Exception:
            pass
        finally:
            _hf_download_procs.pop(filename, None)

    t = threading.Thread(target=_do_download, daemon=True)
    t.start()

    return jsonify({"ok": True, "msg": f"已开始下载 {filename} → {rel_dir}/"}), 200


@bp.route("/api/models/download-hf/status")
def api_download_hf_status():
    """查询 HF 模型文件是否已下载完成"""
    filename = request.args.get("filename", "").strip()
    model_type = request.args.get("type", "").strip()

    if not filename:
        return jsonify({"error": "filename required"}), 400

    rel_dir = MODEL_DIRS.get(model_type, f"models/{model_type}" if model_type else "models/other")
    dest = Path(COMFYUI_DIR) / rel_dir / filename

    downloading = filename in _hf_download_procs
    exists = dest.exists() and not downloading  # 下载完成后才算存在

    return jsonify({"exists": exists, "downloading": downloading})


@bp.route("/api/models/download-hf/cancel", methods=["POST"])
def api_download_hf_cancel():
    """取消 HF 模型下载"""
    data = request.get_json(force=True) or {}
    filename = data.get("filename", "").strip()

    if not filename:
        return jsonify({"error": "filename required"}), 400

    proc = _hf_download_procs.pop(filename, None)
    if proc:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        return jsonify({"ok": True, "msg": f"已取消 {filename}"})

    return jsonify({"ok": True, "msg": "未找到活跃下载"})


# ====================================================================
# 工作流模型依赖解析
# ====================================================================
#
# 两层检测 + 两个特殊节点精确匹配:
#
# 层 1: /object_info 动态检测 + 白名单
#   — 主检测: combo 列表中含模型扩展名 → 自动识别为模型字段
#   — 白名单: combo 为空/仅含哨兵值时, 查 _MODEL_FIELD_WHITELIST 精确匹配
#   — 零误报: 不做任何启发式回退, 未知插件仅在有模型文件时可检测
#
# 层 2: 内联语法正则
#   — <lora:name:weight>  (rgthree Power Prompt / Impact Pack / Easy-Use)
#   — <wlr:name:w1:w2>    (WeiLin Prompt Editor)
#
# 特殊节点精确匹配:
#   — WeiLinPromptUI / WeiLinPromptUIOnlyLoraStack
#     LoRA 信息存储在 STRING 输入 lora_str 中, JSON 编码
#   — Power Lora Loader (rgthree)
#     LoRA 信息存储在 lora_N kwargs 中, dict 格式 {"lora": "name", ...}
#
# 不涉及:
#   — 预设映射类节点 (IPAdapter Unified 等) — 用户选预设不选文件
#   — STRING 绝对路径输入 (InstantID 等) — 非标准模型引用
#   — API 模型名 (Kling 等) — 非本地文件
#   — 自动下载类节点 (Florence2/layerdiffuse 等) — 运行时自动获取

# ── 哨兵值: 非模型文件的 combo 占位项, 提取时跳过 ──
_SENTINEL_VALUES = frozenset({
    "None", "none", "Baked VAE", "pixel_space",
    "(use same)",
})

# ── 模型字段白名单 ──────────────────────────────────────────
# {class_type: {field_name: folder_paths_category}}
# 仅在 /object_info combo 主检测 (模型扩展名) 无法覆盖时生效
# (例如本地未安装对应模型导致 combo 为空/仅含哨兵值)
#
# 维护规则:
#   — 只列出使用 folder_paths.get_filename_list() 的真实模型选择字段
#   — 排除 API 模型名 (Kling)、insightface 包名、自动下载类显示名
#   — 新插件/冷门插件: 等用户反馈后再添加, 也用白名单方式, 不做回退
_MODEL_FIELD_WHITELIST: dict[str, dict[str, str]] = {
    # ── ComfyUI 内置 ──
    "CLIPLoader":                {"clip_name": "clip"},
    "CLIPVisionLoader":          {"clip_name": "clip_vision"},
    "ControlNetLoader":          {"control_net_name": "controlnet"},
    "DiffControlNetLoader":      {"control_net_name": "controlnet"},
    "DiffusersLoader":           {"model_path": "diffusers"},
    "GLIGENLoader":              {"gligen_name": "gligen"},
    "LoraLoader":                {"lora_name": "loras"},
    "LoraLoaderModelOnly":       {"lora_name": "loras"},
    "StyleModelLoader":          {"style_model_name": "style_models"},
    "UNETLoader":                {"unet_name": "unet"},
    "VAELoader":                 {"vae_name": "vae"},
    # ── ComfyUI extras ──
    "CreateHookLora":            {"lora_name": "loras"},
    "CreateHookLoraModelOnly":   {"lora_name": "loras"},
    "HypernetworkLoader":        {"hypernetwork_name": "hypernetworks"},
    "LatentUpscaleModelLoader":  {"model_name": "upscale_models"},
    "LoraLoaderBypass":          {"lora_name": "loras"},
    "LoraLoaderBypassModelOnly": {"lora_name": "loras"},
    "PhotoMakerLoader":          {"photomaker_model_name": "photomaker"},
    "UpscaleModelLoader":        {"model_name": "upscale_models"},
    # ── ComfyUI-Advanced-ControlNet ──
    "ACN_SparseCtrlMergedLoaderAdvanced": {"control_net_name": "controlnet"},
    "ControlNetLoaderAdvanced":           {"control_net_name": "controlnet"},
    "DiffControlNetLoaderAdvanced":       {"control_net_name": "controlnet"},
    # ── ComfyUI-AnimateDiff-Evolved ──
    "ADE_AnimateDiffLoaderGen1":              {"model_name": "animatediff_models"},
    "ADE_AnimateDiffLoaderV1Advanced":        {"model_name": "animatediff_models"},
    "ADE_AnimateDiffLoaderWithContext":        {"model_name": "animatediff_models"},
    "ADE_InjectI2VIntoAnimateDiffModel":      {"model_name": "animatediff_models"},
    "ADE_InjectPIAIntoAnimateDiffModel":      {"model_name": "animatediff_models"},
    "ADE_LoadAnimateDiffModel":               {"model_name": "animatediff_models"},
    "ADE_LoadAnimateDiffModelWithCameraCtrl": {"model_name": "animatediff_models"},
    "ADE_LoadAnimateLCMI2VModel":             {"model_name": "animatediff_models"},
    "ADE_RegisterLoraHook":                   {"lora_name": "loras"},
    "ADE_RegisterLoraHookModelOnly":          {"lora_name": "loras"},
    "AnimateDiffLoaderV1":                    {"model_name": "animatediff_models"},
    # ── ComfyUI-IC-Light ──
    "LoadAndApplyICLightUnet": {"model_path": "unet"},
    # ── ComfyUI-Impact-Pack ──
    "ONNXDetectorProvider": {"model_name": "onnx"},
    "SAMLoader":            {"model_name": "sams"},
    # ── ComfyUI-Inspire-Pack ──
    "LoadDiffusionModelShared //Inspire":      {"model_name": "diffusion_models"},
    "LoraBlockInfo //Inspire":                 {"lora_name": "loras"},
    "LoraLoaderBlockWeight //Inspire":         {"lora_name": "loras"},
    "MakeLBW //Inspire":                       {"lora_name": "loras"},
    "XY Input: Lora Block Weight //Inspire":   {"lora_name": "loras"},
    # ── ComfyUI-KJNodes ──
    "DiTBlockLoraLoader":    {"lora_name": "loras"},
    "DiffusionModelLoaderKJ": {"model_name": "diffusion_models"},
    "DiffusionModelSelector": {"model_name": "diffusion_models"},
    "GGUFLoaderKJ":          {"model_name": "unet_gguf", "extra_model_name": "unet_gguf"},
    "LTX2LoraLoaderAdvanced": {"lora_name": "loras"},
    "LoraReduceRankKJ":      {"lora_name": "loras"},
    "VAELoaderKJ":           {"vae_name": "vae"},
    # ── ComfyUI_IPAdapter_plus ──
    "IPAdapterModelLoader":  {"ipadapter_file": "ipadapter"},
    # ── AuraSR-ComfyUI ──
    "AuraSR.AuraSRUpscaler": {"model_name": "upscale_models"},
    # ── efficiency-nodes-comfyui ──
    "Eff. Loader SDXL":      {"base_ckpt_name": "checkpoints", "refiner_ckpt_name": "checkpoints", "vae_name": "vae"},
    "Efficient Loader":      {"ckpt_name": "checkpoints", "lora_name": "loras", "vae_name": "vae"},
    "HighRes-Fix Script":    {"control_net_name": "controlnet", "hires_ckpt_name": "checkpoints"},
    "XY Input: LoRA Plot":   {"lora_name": "loras"},
    # ── was-node-suite-comfyui ──
    "Diffusers Model Loader": {"model_path": "diffusers"},
    "Load Lora":             {"lora_name": "loras"},
    "Lora Loader":           {"lora_name": "loras"},
    "Upscale Model Loader":  {"model_name": "upscale_models"},
    # ── ComfyUI-Easy-Use (基础加载器) ──
    "easy a1111Loader":        {"ckpt_name": "checkpoints", "lora_name": "loras", "vae_name": "vae"},
    "easy cascadeLoader":      {"clip_name": "clip", "lora_name": "loras", "stage_b": "checkpoints", "stage_c": "checkpoints"},
    "easy comfyLoader":        {"ckpt_name": "checkpoints", "lora_name": "loras", "vae_name": "vae"},
    "easy controlnetLoader":   {"control_net_name": "controlnet"},
    "easy controlnetLoader++": {"control_net_name": "controlnet"},
    "easy controlnetLoaderADV": {"control_net_name": "controlnet"},
    "easy controlnetNames":    {"controlnet_name": "controlnet"},
    "easy fluxLoader":         {"ckpt_name": "checkpoints", "lora_name": "loras", "vae_name": "vae"},
    "easy fullCascadeKSampler": {"decode_vae_name": "vae", "encode_vae_name": "vae"},
    "easy fullLoader":         {"ckpt_name": "checkpoints", "lora_name": "loras", "vae_name": "vae"},
    "easy hiresFix":           {"model_name": "upscale_models"},
    "easy hunyuanDiTLoader":   {"ckpt_name": "checkpoints", "lora_name": "loras", "vae_name": "vae"},
    "easy instantIDApply":     {"control_net_name": "controlnet"},
    "easy instantIDApplyADV":  {"control_net_name": "controlnet"},
    "easy kolorsLoader":       {"lora_name": "loras", "unet_name": "unet", "vae_name": "vae"},
    "easy LLLiteLoader":       {"model_name": "controlnet"},
    "easy loraNames":          {"lora_name": "loras"},
    "easy mochiLoader":        {"ckpt_name": "checkpoints", "vae_name": "vae"},
    "easy pixArtLoader":       {"ckpt_name": "checkpoints", "clip_name": "clip", "lora_name": "loras", "vae_name": "vae"},
    "easy preSamplingCascade": {"decode_vae_name": "vae", "encode_vae_name": "vae"},
    "easy samLoaderPipe":      {"model_name": "sams"},
    "easy sv3dLoader":         {"ckpt_name": "checkpoints", "vae_name": "vae"},
    "easy svdLoader":          {"ckpt_name": "checkpoints", "clip_name": "clip", "vae_name": "vae"},
    "easy ultralyticsDetectorPipe": {"model_name": "ultralytics"},
    "easy XYInputs: ControlNet":    {"control_net_name": "controlnet"},
    "easy zero123Loader":      {"ckpt_name": "checkpoints", "vae_name": "vae"},
}
# ComfyUI-Easy-Use: loraStack (1-10) / loraSwitcher (1-50)
_MODEL_FIELD_WHITELIST["easy loraStack"] = {f"lora_{i}_name": "loras" for i in range(1, 11)}
_MODEL_FIELD_WHITELIST["easy loraSwitcher"] = {f"lora_{i}_name": "loras" for i in range(1, 51)}

# ── 补充: 主检测覆盖的 checkpoint 字段 (防止空模型目录时漏检) ──
_MODEL_FIELD_WHITELIST.update({
    # ComfyUI 内置
    "CheckpointLoader":                         {"ckpt_name": "checkpoints"},
    "CheckpointLoaderSimple":                    {"ckpt_name": "checkpoints"},
    "unCLIPCheckpointLoader":                    {"ckpt_name": "checkpoints"},
    # ComfyUI extras
    "CreateHookModelAsLora":                     {"ckpt_name": "checkpoints"},
    "CreateHookModelAsLoraModelOnly":             {"ckpt_name": "checkpoints"},
    "ImageOnlyCheckpointLoader":                 {"ckpt_name": "checkpoints"},
    "LTXAVTextEncoderLoader":                    {"ckpt_name": "checkpoints"},
    "LTXVAudioVAELoader":                        {"ckpt_name": "checkpoints"},
    # ComfyUI-AnimateDiff-Evolved
    "ADE_RegisterModelAsLoraHook":               {"ckpt_name": "checkpoints"},
    "ADE_RegisterModelAsLoraHookModelOnly":       {"ckpt_name": "checkpoints"},
    "CheckpointLoaderSimpleWithNoiseSelect":      {"ckpt_name": "checkpoints"},
    # ComfyUI-Inspire-Pack
    "CheckpointLoaderSimpleShared //Inspire":     {"ckpt_name": "checkpoints"},
    "MakeBasicPipe //Inspire":                    {"ckpt_name": "checkpoints"},
    "StableCascade_CheckpointLoader //Inspire":   {"stage_b": "checkpoints", "stage_c": "checkpoints"},
    # ComfyUI-KJNodes
    "CheckpointLoaderKJ":                        {"ckpt_name": "checkpoints"},
    "LoadResAdapterNormalization":                {"resadapter_path": "checkpoints"},
    # rgthree-comfy
    "Context Big (rgthree)":                     {"ckpt_name": "checkpoints"},
    # was-node-suite-comfyui
    "Checkpoint Loader":                         {"ckpt_name": "checkpoints"},
    "Checkpoint Loader (Simple)":                {"ckpt_name": "checkpoints"},
    "unCLIP Checkpoint Loader":                  {"ckpt_name": "checkpoints"},
    # ComfyUI-Easy-Use
    "easy ckptNames":                            {"ckpt_name": "checkpoints"},
    "easy XYInputs: ModelMergeBlocks":            {"ckpt_name_1": "checkpoints", "ckpt_name_2": "checkpoints"},
    # ── 批量测试新增 (v3.0.1) ──
    # ComfyUI 内置 — CLIP 多模型加载
    "DualCLIPLoader":                {"clip_name1": "text_encoders", "clip_name2": "text_encoders"},
    "TripleCLIPLoader":              {"clip_name1": "text_encoders", "clip_name2": "text_encoders", "clip_name3": "text_encoders"},
    # ComfyUI-Impact-Pack — Ultralytics
    "UltralyticsDetectorProvider":   {"model_name": "ultralytics"},
    # ComfyUI-Impact-Subpack
    "UltralyticsDetectorSEGSProvider": {"model_name": "ultralytics"},
    # comfyui-art-venture
    "Checkpoint Loader with Name (Image Saver)": {"ckpt_name": "checkpoints"},
    # SeedVR2
    "SeedVR2LoadVAEModel":           {"model": "vae"},
    "SeedVR2LoadDiTModel":           {"model": "diffusion_models"},
    # pysssss — LoraLoader 变体 (字段名与标准 LoraLoader 相同)
    "LoraLoader|pysssss":            {"lora_name": "loras"},
    # SD-WEBUI-style LoRA 加载器
    "SDLoraLoader":                  {"lora_name": "loras"},
    # LyCORIS 加载器
    "LycorisLoaderNode":             {"model_name": "loras"},
    # KJNodes GGUF
    "UnetLoaderGGUF":                {"unet_name": "diffusion_models"},
    # ECHO — checkpoint 加载器别名
    "ECHOCheckpointLoaderSimple":    {"ckpt_name": "checkpoints"},
    # ComfyRoll
    "CR Upscale Image":              {"upscale_model": "upscale_models"},
})
# ComfyUI-Easy-Use: XYInputs Checkpoint (ckpt_name_1 ~ ckpt_name_10)
_MODEL_FIELD_WHITELIST["easy XYInputs: Checkpoint"] = {
    f"ckpt_name_{i}": "checkpoints" for i in range(1, 11)
}
# efficiency-nodes: XY Input Checkpoint (ckpt_name_1 ~ ckpt_name_50)
_MODEL_FIELD_WHITELIST["XY Input: Checkpoint"] = {
    f"ckpt_name_{i}": "checkpoints" for i in range(1, 51)
}
# ComfyRoll LoRA Stack (lora_name_1 ~ lora_name_3)
_MODEL_FIELD_WHITELIST["CR LoRA Stack"] = {
    f"lora_name_{i}": "loras" for i in range(1, 4)
}
# ComfyRoll Random LoRA Stack (lora_name_1 ~ lora_name_5)
_MODEL_FIELD_WHITELIST["CR Random LoRA Stack"] = {
    f"lora_name_{i}": "loras" for i in range(1, 6)
}
# Impact-Pack LoRA Stacker (lora_name_1 ~ lora_name_49)
_MODEL_FIELD_WHITELIST["LoRA Stacker"] = {
    f"lora_name_{i}": "loras" for i in range(1, 50)
}
# rgthree Lora Loader Stack (lora_01 ~ lora_20)
_MODEL_FIELD_WHITELIST["Lora Loader Stack (rgthree)"] = {
    f"lora_{i:02d}": "loras" for i in range(1, 21)
}
# LorasForFluxParams+ (lora_1 ~ lora_10)
_MODEL_FIELD_WHITELIST["LorasForFluxParams+"] = {
    f"lora_{i}": "loras" for i in range(1, 11)
}

# ── 准确性测试新增 (v3.0.2) ──
_MODEL_FIELD_WHITELIST.update({
    # GGUF 系列
    "ClipLoaderGGUF":               {"clip_name": "text_encoders"},
    # LongCLIP
    "LongCLIPTextEncodeFlux":       {"clip_name": "text_encoders"},
    # 信息/选择器/保存器 (引用了真实模型路径)
    "LoraInfo":                     {"lora_name": "loras"},
    "PWLoraSelector":               {"lora_name": "loras"},
    "SDLoraSelector":               {"lora_name": "loras"},
    "Checkpoint Selector":          {"ckpt_name": "checkpoints"},
    "CheckpointLoader|pysssss":     {"ckpt_name": "checkpoints"},
    "SDPromptSaver":                {"model_name": "checkpoints"},
    "Save Image w/Metadata":        {"modelname": "checkpoints"},
    "LF_CivitAIMetadataSetup":      {"hires_upscaler": "upscale_models"},
    # Impact-Pack 检测器
    "MMDetDetectorProvider":        {"model_name": "mmdets_bbox"},
    # 人脸修复
    "FaceRestoreModelLoader":       {"model_name": "facerestore_models"},
    # PuLID
    "PulidFluxModelLoader":         {"model_name": "pulid"},
    # Upscaler
    "MaraScottMcBoatyUpscalerRefiner_v5": {"upscale_model": "upscale_models"},
    # 视频插帧
    "RIFE VFI":                     {"ckpt_name": "custom_nodes"},
    # ReActor
    "ReActorFaceSwap":              {"face_model": "facerestore_models"},
    # UUID 自定义节点 (CogVideoX-Fun 等)
    "65c22b29-59aa-496b-89c6-55a603658670": {"unet_name": "diffusion_models"},
})


# ── 内联引用正则 ──
_LORA_TAG_RE = re.compile(
    r"<lora:([^:>]+?)(?::[^>]*)?>", re.IGNORECASE
)
_WLR_TAG_RE = re.compile(
    r"<wlr:([^:]+):[^>]+>", re.IGNORECASE
)

# ── /object_info 内存缓存 ──
_object_info_cache: dict | None = None
# {class_type: {field_name: set(combo_values)}} — 仅包含模型文件 combo 字段
_model_field_cache: dict | None = None


def _refresh_object_info() -> dict | None:
    """从 ComfyUI 获取 /object_info 并构建模型字段映射缓存"""
    global _object_info_cache, _model_field_cache
    try:
        resp = requests.get(f"{COMFYUI_URL}/object_info", timeout=15)
        resp.raise_for_status()
        _object_info_cache = resp.json()
    except Exception:
        return _object_info_cache

    field_map: dict[str, dict[str, set]] = {}
    for ct, info in _object_info_cache.items():
        node_inputs = info.get("input", {})
        fields: dict[str, set] = {}
        for section in ("required", "optional"):
            for fname, fspec in node_inputs.get(section, {}).items():
                if not isinstance(fspec, (list, tuple)) or not fspec:
                    continue
                # 兼容新旧两种 /object_info combo 格式:
                #   旧: [["opt1","opt2",...], {...}]  →  fspec[0] 是 list
                #   新: ["COMBO", {"options":["opt1",...],...}]  →  fspec[0]=="COMBO"
                options = fspec[0]
                if isinstance(options, str) and options == "COMBO":
                    if (len(fspec) > 1 and isinstance(fspec[1], dict)):
                        options = fspec[1].get("options", [])
                    else:
                        continue
                if not isinstance(options, list):
                    continue
                # combo 选项中有模型扩展名 → 这是模型文件字段
                if any(
                    isinstance(o, str)
                    and any(o.lower().endswith(e) for e in MODEL_EXTENSIONS)
                    for o in options[:20]
                ):
                    fields[fname] = set(options)
                # 白名单: combo 为空或仅含哨兵值时, 查静态白名单
                elif (ct in _MODEL_FIELD_WHITELIST
                      and fname in _MODEL_FIELD_WHITELIST[ct]):
                    fields[fname] = set(options)
        if fields:
            field_map[ct] = fields

    _model_field_cache = field_map
    return _object_info_cache


# ── 类别推断 (仅用于 UI 显示标签) ──
_CATEGORY_HINTS = (
    ("checkpoint", "checkpoints"), ("ckpt", "checkpoints"),
    ("lora", "loras"),
    ("vae", "vae"),
    ("unet", "diffusion_models"), ("diffusion_model", "diffusion_models"),
    ("clip_vision", "clip_vision"),
    ("clip", "text_encoders"), ("text_encoder", "text_encoders"),
    ("controlnet", "controlnet"), ("control_net", "controlnet"),
    ("upscale", "upscale_models"),
    ("hypernetwork", "hypernetworks"),
    ("embedding", "embeddings"),
    ("gligen", "gligen"),
    ("style_model", "style_models"),
    ("ipadapter", "ipadapter"),
    ("photomaker", "photomaker"),
    ("animatediff", "animatediff_models"),
    ("sam", "sams"), ("onnx", "onnx"),
    ("gguf", "diffusion_models"),
    # 通用: 放在最后, _infer_category 优先使用更具体的关键词
    ("model", "unknown"),
)


def _infer_category(class_type: str, field_name: str) -> str:
    """从字段名 / 节点类型名推断模型类别 (关键词启发式, 仅作回退)"""
    fl, cl = field_name.lower(), class_type.lower()
    # 字段名匹配 (跳过过于泛化的 model, 优先用 class_type 上下文)
    for kw, cat in _CATEGORY_HINTS:
        if kw != "model" and kw in fl:
            return cat
    # 节点类型名匹配
    for kw, cat in _CATEGORY_HINTS:
        if kw in cl:
            return cat
    return "unknown"


def _get_category(class_type: str, field_name: str) -> str:
    """获取模型类别 — 白名单精确值优先, 找不到时回退到关键词推断"""
    wl = _MODEL_FIELD_WHITELIST.get(class_type)
    if wl and field_name in wl:
        return wl[field_name]
    return _infer_category(class_type, field_name)


# ── 扫描辅助函数 ──

def _scan_inline_loras(inputs: dict, ct: str, seen: set, out: list):
    """层 2: 扫描所有 STRING 输入中的 <lora:> 和 <wlr:> 标签"""
    for fname, val in inputs.items():
        if not isinstance(val, str) or len(val) < 7:
            continue
        for m in _LORA_TAG_RE.finditer(val):
            name = m.group(1).strip()
            if not name or name in seen:
                continue
            if not any(name.lower().endswith(e) for e in MODEL_EXTENSIONS):
                name += ".safetensors"
            if name in seen:
                continue
            seen.add(name)
            out.append({"name": name, "type": "loras",
                        "node": ct, "field": fname})
        for m in _WLR_TAG_RE.finditer(val):
            name = m.group(1).strip()
            if not name or name in seen:
                continue
            if not any(name.lower().endswith(e) for e in MODEL_EXTENSIONS):
                name += ".safetensors"
            if name in seen:
                continue
            seen.add(name)
            out.append({"name": name, "type": "loras",
                        "node": ct, "field": fname})


def _handle_weilin(inputs: dict, ct: str, seen: set, out: list):
    """特殊处理: WeiLin Lora Stack / Prompt Editor 的 JSON 编码 LoRA"""
    for key in ("lora_str", "temp_lora_str", "positive"):
        val = inputs.get(key, "")
        if not isinstance(val, str) or not val.strip():
            continue
        lora_list = None
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                lora_list = parsed
            elif isinstance(parsed, dict) and "lora" in parsed:
                lora_list = parsed["lora"]
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(lora_list, list):
            continue
        for item in lora_list:
            if isinstance(item, dict) and "lora" in item:
                name = item["lora"]
                if (isinstance(name, str) and name
                        and name not in seen
                        and name not in _SENTINEL_VALUES):
                    seen.add(name)
                    out.append({"name": name, "type": "loras",
                                "node": ct, "field": key})


def _handle_power_lora(inputs: dict, ct: str, seen: set, out: list):
    """特殊处理: rgthree Power Lora Loader 的 dict 嵌套 LoRA"""
    for key, val in inputs.items():
        if not key.upper().startswith("LORA_") or not isinstance(val, dict):
            continue
        name = val.get("lora", "")
        if (isinstance(name, str) and name
                and name not in seen
                and name not in _SENTINEL_VALUES):
            seen.add(name)
            out.append({"name": name, "type": "loras",
                        "node": ct, "field": f"{key}.lora"})


# ── 主提取函数 ──

def _extract_models_from_prompt(prompt: dict) -> tuple[list[dict], list[dict]]:
    """从 ComfyUI prompt JSON 提取模型依赖

    返回: (models, missing_nodes)
    - models:        模型引用列表, 每项含 name/type/exists/node/field
    - missing_nodes: 未安装的节点列表, 每项含 class_type/node_id
    """
    if _model_field_cache is None:
        _refresh_object_info()
    field_map = _model_field_cache or {}

    models: list[dict] = []
    missing_nodes: list[dict] = []
    seen: set[str] = set()
    seen_missing: set[str] = set()

    for nid, node in prompt.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue

        # ── 层 1: /object_info 精确检测 ──
        if ct in field_map:
            for fname, combo_set in field_map[ct].items():
                val = inputs.get(fname)
                if (isinstance(val, str) and val
                        and val not in seen
                        and val not in _SENTINEL_VALUES):
                    seen.add(val)
                    models.append({
                        "name": val,
                        "type": _get_category(ct, fname),
                        "exists": val in combo_set,
                        "node": ct,
                        "field": fname,
                    })
        elif ct in _MODEL_FIELD_WHITELIST:
            # ── 白名单回退: 节点未安装但白名单有映射 ──
            wl = _MODEL_FIELD_WHITELIST[ct]
            for fname, category in wl.items():
                val = inputs.get(fname)
                if (isinstance(val, str) and val
                        and val not in seen
                        and val not in _SENTINEL_VALUES):
                    seen.add(val)
                    models.append({
                        "name": val,
                        "type": category,
                        "exists": False,
                        "node": ct,
                        "field": fname,
                    })
            if ct not in seen_missing:
                seen_missing.add(ct)
                missing_nodes.append({"class_type": ct, "node_id": nid})
        elif (ct and _object_info_cache is not None
              and ct not in _object_info_cache
              and ct not in seen_missing):
            seen_missing.add(ct)
            missing_nodes.append({"class_type": ct, "node_id": nid})

        # ── 层 2: <lora:> / <wlr:> 内联语法 ──
        _scan_inline_loras(inputs, ct, seen, models)

        # ── 特殊节点 ──
        if ct in ("WeiLinPromptUI", "WeiLinPromptUIOnlyLoraStack"):
            _handle_weilin(inputs, ct, seen, models)
        elif ct == "Power Lora Loader (rgthree)":
            _handle_power_lora(inputs, ct, seen, models)

    return models, missing_nodes


def _extract_models_from_workflow(workflow: dict) -> tuple[list[dict], list[dict]]:
    """从 ComfyUI workflow 编辑器格式提取模型依赖

    widgets_values 是无字段名的值数组。策略:
    - 对于 /object_info 已知的节点: 将每个 string widget 与 combo 集对比
    - 对于内联语法 / 特殊节点: 扫描所有 widget 值
    """
    if _model_field_cache is None:
        _refresh_object_info()
    field_map = _model_field_cache or {}

    models: list[dict] = []
    missing_nodes: list[dict] = []
    seen: set[str] = set()
    seen_missing: set[str] = set()

    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        ct = node.get("type", "")
        widgets = node.get("widgets_values")
        if not isinstance(widgets, list):
            continue

        # ── 层 1: /object_info — 将 widget 值与 combo 集合对比 ──
        if ct in field_map:
            all_combos = field_map[ct]
            for val in widgets:
                if (not isinstance(val, str) or not val
                        or val in seen or val in _SENTINEL_VALUES):
                    continue
                # 检查是否在某个 combo 集中 (说明文件存在)
                matched_field = None
                for fname, combo_set in all_combos.items():
                    if val in combo_set:
                        matched_field = fname
                        break
                if matched_field:
                    seen.add(val)
                    models.append({
                        "name": val,
                        "type": _get_category(ct, matched_field),
                        "exists": True,
                        "node": ct, "field": matched_field,
                    })
                elif any(val.lower().endswith(e) for e in MODEL_EXTENSIONS):
                    # 有模型扩展名但不在 combo 中 → 可能是缺失的模型
                    fname = next(iter(all_combos))
                    seen.add(val)
                    models.append({
                        "name": val,
                        "type": _get_category(ct, fname),
                        "exists": False,
                        "node": ct, "field": fname,
                    })
        elif ct in _MODEL_FIELD_WHITELIST:
            # ── 白名单回退: 节点未安装, 扫描 widget 值中的模型文件名 ──
            wl = _MODEL_FIELD_WHITELIST[ct]
            # 取白名单中第一个类别作为默认 (多数节点只有一种模型类型)
            default_cat = next(iter(wl.values()))
            for val in widgets:
                if (not isinstance(val, str) or not val
                        or val in seen or val in _SENTINEL_VALUES):
                    continue
                if any(val.lower().endswith(e) for e in MODEL_EXTENSIONS):
                    seen.add(val)
                    # 尝试精确匹配字段名对应的类别 (按白名单键搜索)
                    cat = default_cat
                    for fname, fcat in wl.items():
                        # 启发式: val 的路径/文件名暗示类别
                        if fcat != default_cat:
                            vl = val.lower()
                            if fcat in vl or fname.split("_")[0] in vl:
                                cat = fcat
                                break
                    models.append({
                        "name": val,
                        "type": cat,
                        "exists": False,
                        "node": ct, "field": "",
                    })
            if ct not in seen_missing:
                seen_missing.add(ct)
                missing_nodes.append({"class_type": ct})
        elif (ct and _object_info_cache is not None
              and ct not in _object_info_cache
              and ct not in seen_missing):
            seen_missing.add(ct)
            missing_nodes.append({"class_type": ct})

        # ── 层 2: <lora:> / <wlr:> 在 widget 字符串值中 ──
        for val in widgets:
            if not isinstance(val, str) or len(val) < 7:
                continue
            for m in _LORA_TAG_RE.finditer(val):
                name = m.group(1).strip()
                if not name:
                    continue
                if not any(name.lower().endswith(e) for e in MODEL_EXTENSIONS):
                    name += ".safetensors"
                if name in seen:
                    continue
                seen.add(name)
                models.append({"name": name, "type": "loras",
                                "node": ct, "field": ""})
            for m in _WLR_TAG_RE.finditer(val):
                name = m.group(1).strip()
                if not name:
                    continue
                if not any(name.lower().endswith(e) for e in MODEL_EXTENSIONS):
                    name += ".safetensors"
                if name in seen:
                    continue
                seen.add(name)
                models.append({"name": name, "type": "loras",
                                "node": ct, "field": ""})

        # ── WeiLin 特殊: 扫描 widget 值中的 JSON 字符串 ──
        if ct in ("WeiLinPromptUI", "WeiLinPromptUIOnlyLoraStack"):
            for val in widgets:
                if not isinstance(val, str) or not val.strip():
                    continue
                try:
                    parsed = json.loads(val)
                    items = (parsed if isinstance(parsed, list)
                             else parsed.get("lora", [])
                             if isinstance(parsed, dict) else [])
                    for item in items:
                        if isinstance(item, dict) and "lora" in item:
                            name = item["lora"]
                            if (isinstance(name, str) and name
                                    and name not in seen
                                    and name not in _SENTINEL_VALUES):
                                seen.add(name)
                                models.append({
                                    "name": name, "type": "loras",
                                    "node": ct, "field": "lora_str",
                                })
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

        # ── rgthree Power Lora Loader 特殊: widget 值中的 dict ──
        if ct == "Power Lora Loader (rgthree)":
            for val in widgets:
                if isinstance(val, dict) and "lora" in val:
                    name = val.get("lora", "")
                    if (isinstance(name, str) and name
                            and name not in seen
                            and name not in _SENTINEL_VALUES):
                        seen.add(name)
                        models.append({
                            "name": name, "type": "loras",
                            "node": ct, "field": "lora_N",
                        })

        # ── pysssss COMBO widget: dict {'content': 'name.safetensors', ...} ──
        for val in widgets:
            if (isinstance(val, dict) and "content" in val
                    and isinstance(val["content"], str)):
                name = val["content"]
                if (name and name not in seen
                        and name not in _SENTINEL_VALUES
                        and any(name.lower().endswith(e)
                                for e in MODEL_EXTENSIONS)):
                    seen.add(name)
                    cat = _get_category(ct, "")
                    models.append({
                        "name": name, "type": cat,
                        "node": ct, "field": "",
                    })

    return models, missing_nodes


def _check_model_exists(name: str, category: str) -> bool:
    """检查模型文件是否存在于本地 (用于非 combo 检测的模型)"""
    rel_dir = MODEL_DIRS.get(category, "")
    if not rel_dir:
        for _cat, rd in MODEL_DIRS.items():
            if os.path.isfile(os.path.join(COMFYUI_DIR, rd, name)):
                return True
        return False
    return os.path.isfile(os.path.join(COMFYUI_DIR, rel_dir, name))


@bp.route("/api/models/parse-workflow", methods=["POST"])
def api_parse_workflow():
    """
    解析工作流 JSON，提取模型引用并检查本地是否存在

    需要 ComfyUI 运行中 (依赖 /object_info 端点)。

    Body: { "prompt": {...} }   — ComfyUI prompt 格式
      或  { "workflow": {...} } — ComfyUI workflow 编辑器格式

    Response: {
        "models": [
            {"name": "xx.safetensors", "type": "checkpoints",
             "exists": true, "node": "CheckpointLoaderSimple", "field": "ckpt_name"},
            ...
        ],
        "missing_nodes": [
            {"class_type": "SomeCustomNode", "node_id": "5"}
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
        models, missing_nodes = _extract_models_from_prompt(prompt)
    elif workflow and isinstance(workflow, dict):
        models, missing_nodes = _extract_models_from_workflow(workflow)
    else:
        return jsonify({"error": "需要 prompt 或 workflow 字段"}), 400

    # 如果 /object_info 不可用, 提示 ComfyUI 未运行
    if _object_info_cache is None:
        return jsonify({
            "error": "ComfyUI 未运行或无法连接, 无法解析工作流模型依赖",
        }), 503

    # 对非 combo 检测的模型 (内联/特殊节点), 补充文件系统存在性检查
    for m in models:
        if "exists" not in m:
            m["exists"] = _check_model_exists(m["name"], m["type"])

    missing = sum(1 for m in models if not m["exists"])
    return jsonify({
        "models": models,
        "missing_nodes": missing_nodes,
        "total": len(models),
        "missing": missing,
    })


@bp.route("/api/models/refresh-object-info", methods=["POST"])
def api_refresh_object_info():
    """手动刷新 /object_info 缓存 (安装/卸载插件后调用)"""
    info = _refresh_object_info()
    if info is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 503
    node_count = len(info)
    model_field_count = sum(
        len(fields) for fields in (_model_field_cache or {}).values()
    )
    return jsonify({
        "ok": True,
        "nodes": node_count,
        "model_fields": model_field_count,
    })
