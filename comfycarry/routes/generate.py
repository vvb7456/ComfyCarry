"""
ComfyCarry — Generate 路由

- POST /api/generate/submit  — 提交生成请求 (构建工作流 + POST 到 ComfyUI)
- GET  /api/generate/options — 获取 sampler / scheduler 选项 (懒加载缓存)

输出图片查看复用现有端点:
  GET /api/comfyui/history?prompt_id=<id>  — 获取特定 prompt 的输出图片信息
  GET /api/comfyui/view                    — 图片文件代理

支持的 model_type:
  sdxl   — SDXL 基础 T2I + 可选 LoRA  (Phase 1)
  (flux, zimage, ... — Phase 2+)
"""

import json
import logging
import os
import re
import time
from datetime import datetime

import requests
from flask import Blueprint, jsonify, request

from ..config import COMFYUI_DIR, COMFYUI_URL
from ..services.arch_detect import detect_arch
from ..services.comfyui_bridge import get_bridge
from ..services.prompt_expander import get_expander
from ..services.workflow_builder import (
    build_sdxl_workflow,
    build_anima_workflow,
    build_krea2_workflow,
    build_zimage_workflow,
    build_flux1_workflow,
    build_preprocess_workflow,
    build_tag_workflow,
)

logger = logging.getLogger(__name__)

bp = Blueprint("generate", __name__)

# ── 架构扫描 memo 缓存 ───────────────────────────────────────────────────────
# filepath → (mtime, size, rules_version, arch)。
# options 5 分钟 TTL 过期后的重扫, 每个文件 detect 前先 stat, (mtime, size)
# 未变且 rules_version 与当前一致则直接用缓存值, 否则 detect 后写缓存, 使重扫接近零成本。
# rules_version 机制: 检测规则表升级 (如新增 flux2/zimage 规则、修 flux1 LoRA 误判) 后,
# 旧缓存条目的 rules_version 不匹配 → 视为未命中, 强制重判, 防止 mtime 缓存钉死旧误判。
_rules_VERSION = 3
_arch_scan_cache: dict[str, tuple[float, int, int, str]] = {}


# ── 懒加载缓存: Generate 页面所需的全部选项 ─────────────────────────────────
_options_cache: dict | None = None
_options_cache_time: float = 0.0
_combo_cache: dict = {}  # _get_combo_list 的 object_info 缓存


def _scan_model_previews(names: list[str], rel_dir: str) -> dict[str, str | None]:
    """
    扫描模型文件旁的同名预览图，返回 {name: preview_rel_path}。
    rel_dir 为相对 COMFYUI_DIR 的模型目录 (如 "models/checkpoints")。
    """
    result = {}
    base_dir = os.path.join(COMFYUI_DIR, rel_dir)
    real_base = os.path.realpath(base_dir)
    for name in names:
        model_path = os.path.join(base_dir, name)
        real_path = os.path.realpath(model_path)
        if not real_path.startswith(real_base + os.sep):
            continue  # 跳过路径遍历
        base_no_ext = os.path.splitext(model_path)[0]
        preview = None
        for pext in (".jpg", ".png", ".jpeg", ".webp"):
            ppath = base_no_ext + pext
            if os.path.exists(ppath):
                preview = os.path.relpath(ppath, COMFYUI_DIR)
                break
        result[name] = preview
    return result


def _scan_lora_metadata(names: list[str], rel_dir: str) -> tuple[dict[str, str], dict[str, dict]]:
    """
    扫描 LoRA 的 .weilin-info.json 文件，一次性提取 trigger words 和详细元数据。
    返回 (triggers_dict, info_dict)。
    """
    triggers = {}
    info_result = {}
    base_dir = os.path.join(COMFYUI_DIR, rel_dir)
    real_base = os.path.realpath(base_dir)
    for name in names:
        model_path = os.path.join(base_dir, name)
        real_path = os.path.realpath(model_path)
        if not real_path.startswith(real_base + os.sep):
            continue  # 跳过路径遍历
        info_path = f"{model_path}.weilin-info.json"
        if not os.path.exists(info_path):
            continue
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                info = json.load(f)
            # trigger words
            words = [w.get("word", "") for w in info.get("trainedWords", []) if w.get("word")]
            if words:
                triggers[name] = ", ".join(words)
            # 详细元数据
            entry = {}
            if info.get("name"):
                entry["name"] = info["name"]
            if info.get("trainedWords"):
                # Normalize: [{word: "a"}, {word: "b, c"}] → ["a", "b", "c"]
                raw_tw = [w.get("word", "") for w in info["trainedWords"] if w.get("word")]
                normalized = []
                seen = set()
                for w in raw_tw:
                    for part in (p.strip() for p in w.split(",") if p.strip()):
                        if part not in seen:
                            seen.add(part)
                            normalized.append(part)
                entry["trainedWords"] = normalized
            if info.get("baseModel"):
                entry["baseModel"] = info["baseModel"]
            civitai_raw = info.get("raw", {}).get("civitai", {})
            civitai_model_id = civitai_raw.get("modelId")
            if civitai_model_id:
                entry["civitai_id"] = civitai_model_id
            civitai_version_id = civitai_raw.get("id")
            if civitai_version_id:
                entry["versionId"] = civitai_version_id
            civitai_version_name = civitai_raw.get("name")
            if civitai_version_name:
                entry["versionName"] = civitai_version_name
            if info.get("sha256"):
                entry["sha256"] = info["sha256"]
            if info.get("images"):
                entry["images"] = info["images"][:6]
            info_result[name] = entry
        except Exception:
            pass
    return triggers, info_result


def _classify_controlnet_models(names: list[str]) -> dict:
    """
    将 ControlNet 模型名按类型分组。
    根据文件名关键词自动分类: pose/openpose → pose, canny/edge → canny, depth → depth。
    Union 模型出现在所有类型中。无法识别的归入 "other"。
    返回: {"pose": [...], "canny": [...], "depth": [...], "other": [...]}
    """
    import re
    result = {"pose": [], "canny": [], "depth": [], "other": []}
    for name in names:
        lower = name.lower()
        # Union / ProMax 出现在所有类型
        if "union" in lower or "promax" in lower:
            result["pose"].append(name)
            result["canny"].append(name)
            result["depth"].append(name)
            continue
        matched = False
        if re.search(r"pose|openpose|dwpose", lower):
            result["pose"].append(name)
            matched = True
        if re.search(r"canny|edge|lineart|line.?art", lower):
            result["canny"].append(name)
            matched = True
        if re.search(r"depth", lower):
            result["depth"].append(name)
            matched = True
        if not matched:
            result["other"].append(name)
    return result


def _scan_model_archs(names: list[str], rel_dir: str) -> dict[str, str]:
    """
    批量检测模型架构，返回 {name: arch}。
    基于 (mtime, size, rules_version) 的 memo 缓存:
    文件未改动且 rules_version 一致时直接复用缓存结果 (规则升级后强制重判)。
    """
    result = {}
    base_dir = os.path.join(COMFYUI_DIR, rel_dir)
    real_base = os.path.realpath(base_dir)
    for name in names:
        filepath = os.path.join(base_dir, name)
        real_path = os.path.realpath(filepath)
        if not real_path.startswith(real_base + os.sep):
            continue  # 跳过路径遍历
        # stat 命中检查 (失败按现状跳过 — 不写入缓存)
        try:
            st = os.stat(filepath)
        except OSError:
            result[name] = detect_arch(filepath, name)
            continue
        cached = _arch_scan_cache.get(filepath)
        # 命中条件: mtime/size 未变 且 rules_version 与当前一致
        if (cached and cached[0] == st.st_mtime and cached[1] == st.st_size
                and cached[2] == _rules_VERSION):
            result[name] = cached[3]
            continue
        # 未命中 / 已变动 / 规则升级 → detect 后写缓存
        arch = detect_arch(filepath, name)
        _arch_scan_cache[filepath] = (st.st_mtime, st.st_size, _rules_VERSION, arch)
        result[name] = arch
    return result


def _fetch_generate_options() -> dict:
    """
    从 ComfyUI /object_info 获取 Generate 页面所需的全部下拉选项:
      - samplers     : KSampler 的 sampler_name 选项列表
      - schedulers   : KSampler 的 scheduler 选项列表
      - checkpoints  : CheckpointLoaderSimple 的 ckpt_name 列表 (含子目录前缀)
      - loras        : LoraLoader 的 lora_name 列表 (含子目录前缀)

    结果缓存在模块级变量中（进程生命周期内有效）。
    ComfyUI 未运行时返回内置默认值（不缓存，下次重试）。
    """
    global _options_cache, _options_cache_time
    if _options_cache is not None and (time.time() - _options_cache_time) < 300:
        return _options_cache

    DEFAULT_SAMPLERS = [
        "euler", "euler_ancestral", "heun", "dpm_2",
        "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive",
        "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu",
        "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
        "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ddim",
        "uni_pc", "uni_pc_bh2",
    ]
    DEFAULT_SCHEDULERS = [
        "normal", "karras", "exponential", "sgm_uniform",
        "simple", "ddim_uniform", "beta",
    ]
    DEFAULT = {"samplers": DEFAULT_SAMPLERS, "schedulers": DEFAULT_SCHEDULERS,
               "checkpoints": [], "loras": [],
               "unets": [], "clips": [], "vaes": [],
               "checkpoint_previews": {}, "lora_previews": {}, "lora_triggers": {},
               "lora_info": {}, "checkpoint_info": {},
               "checkpoint_archs": {}, "lora_archs": {},
               "unet_previews": {}, "clip_previews": {}, "vae_previews": {},
               "unet_archs": {}, "unet_info": {},
               "comfyui_dir": COMFYUI_DIR, "controlnet_models": {},
               "seedvr2_models": []}

    def _get_combo_list(node_name: str, field: str) -> list:
        """获取节点的下拉选项（同节点缓存，避免重复 HTTP 请求）

        ComfyUI ≥0.28 将 combo 格式从 [[...options]] 改为
        ['COMBO', {'options': [...]}]，此处兼容两种。
        """
        if node_name not in _combo_cache:
            try:
                r = requests.get(f"{COMFYUI_URL}/object_info/{node_name}", timeout=10)
                r.raise_for_status()
                _combo_cache[node_name] = r.json()
            except Exception as e:
                logger.warning(f"[generate] 获取 {node_name} 失败: {e}")
                _combo_cache[node_name] = {}
        d = _combo_cache.get(node_name, {})
        raw = d.get(node_name, {}).get("input", {}).get("required", {}).get(field, [])
        if not raw:
            return []
        first = raw[0]
        if isinstance(first, list):
            return first
        if isinstance(first, str) and len(raw) > 1 and isinstance(raw[1], dict):
            return raw[1].get("options", [])
        return []

    samplers   = _get_combo_list("KSampler", "sampler_name")
    schedulers = _get_combo_list("KSampler", "scheduler")
    checkpoints = _get_combo_list("CheckpointLoaderSimple", "ckpt_name")
    loras       = _get_combo_list("LoraLoader", "lora_name")
    unets       = _get_combo_list("UNETLoader", "unet_name")
    clips       = _get_combo_list("CLIPLoader", "clip_name")
    vaes        = _get_combo_list("VAELoader", "vae_name")

    if not samplers:
        # ComfyUI 未运行，返回默认值但不缓存
        logger.warning("[generate] ComfyUI 未运行，返回内置默认选项")
        return DEFAULT

    result = {
        "samplers":    samplers   if isinstance(samplers, list)    else DEFAULT_SAMPLERS,
        "schedulers":  schedulers if isinstance(schedulers, list)  else DEFAULT_SCHEDULERS,
        "checkpoints": checkpoints if isinstance(checkpoints, list) else [],
        "loras":       loras       if isinstance(loras, list)       else [],
        "unets":       unets       if isinstance(unets, list)       else [],
        "clips":       clips       if isinstance(clips, list)       else [],
        "vaes":        vaes        if isinstance(vaes, list)        else [],
    }

    # ── 扫描预览图 & 元数据 ─────────────────────────────────────────────
    ckpt_list = result["checkpoints"]
    lora_list = result["loras"]
    result["checkpoint_previews"] = _scan_model_previews(ckpt_list, "models/checkpoints")
    result["lora_previews"] = _scan_model_previews(lora_list, "models/loras")
    # LoRA: 一次性读取 trigger words + 详细元数据 (避免双重文件 I/O)
    lora_triggers, lora_info = _scan_lora_metadata(lora_list, "models/loras")
    result["lora_triggers"] = lora_triggers
    result["lora_info"] = lora_info
    # Checkpoint: 仅读元数据 (无 trigger words)
    _, ckpt_info = _scan_lora_metadata(ckpt_list, "models/checkpoints")
    result["checkpoint_info"] = ckpt_info
    result["checkpoint_archs"] = _scan_model_archs(ckpt_list, "models/checkpoints")
    result["lora_archs"] = _scan_model_archs(lora_list, "models/loras")
    result["comfyui_dir"] = COMFYUI_DIR

    # ── 分离式架构: UNet / CLIP / VAE 预览图 + UNet 架构检测 ────────────
    unet_list = result["unets"]
    clip_list = result["clips"]
    vae_list = result["vaes"]
    result["unet_previews"] = _scan_model_previews(unet_list, "models/diffusion_models")
    result["clip_previews"] = _scan_model_previews(clip_list, "models/text_encoders")
    result["vae_previews"] = _scan_model_previews(vae_list, "models/vae")
    result["unet_archs"] = _scan_model_archs(unet_list, "models/diffusion_models")
    # UNet: 读元数据 (baseModel 等)，供分离式架构选择器展示；无 trigger words
    _, unet_info = _scan_lora_metadata(unet_list, "models/diffusion_models")
    result["unet_info"] = unet_info

    # ── ControlNet 模型 (按类型分组) ───────────────────────────────────
    cn_list = _get_combo_list("ControlNetLoader", "control_net_name")
    result["controlnet_models"] = _classify_controlnet_models(cn_list)

    # ── SeedVR2 DiT 模型 (扫描磁盘实际存在的白名单文件) ─────────────────
    # ComfyUI 的 combo 列表返回节点已知的全部变体（含未下载的 GGUF 等），
    # 此处直接扫描 models/SEEDVR2/ 仅返回磁盘上存在的 .safetensors 文件。
    seedvr2_dir = os.path.join(COMFYUI_DIR, "models", "SEEDVR2")
    svr_models: list[str] = []
    if os.path.isdir(seedvr2_dir):
        for fn in sorted(os.listdir(seedvr2_dir)):
            if fn.endswith(".safetensors") and fn != "ema_vae_fp16.safetensors":
                svr_models.append(fn)
    result["seedvr2_models"] = svr_models

    _options_cache = result
    _options_cache_time = time.time()
    return result


# ── /api/generate/options ────────────────────────────────────────────────────

@bp.route("/api/generate/options")
def api_generate_options():
    """
    返回 Generate 页面所需的全部下拉选项:
    sampler / scheduler / checkpoints / loras。
    数据来自 ComfyUI /object_info（懒加载缓存）。
    ComfyUI 未运行时返回内置默认列表（checkpoints/loras 为空）。

    ?refresh=1  强制清除缓存并重新获取。
    """
    global _options_cache, _options_cache_time, _combo_cache
    if request.args.get("refresh") == "1":
        _options_cache = None
        _options_cache_time = 0.0
        _combo_cache.clear()
    return jsonify(_fetch_generate_options())


# ── /api/generate/upload_image ───────────────────────────────────────────────

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/bmp"}
MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB

@bp.route("/api/generate/upload_image", methods=["POST"])
def api_generate_upload_image():
    """
    上传图片到 ComfyUI input/ 目录 (供 ControlNet / Img2Img 使用)。

    Form data:
        file      — 图片文件 (png/jpeg/webp/bmp, 最大 20MB)
        type      — 用途标识 (可选: "pose" / "canny" / "depth" / "i2i")
        subfolder — 可选子目录名 (如 "openpose"), 保存到 input/{subfolder}/

    返回: {"filename": "openpose/pose_abc123.png"}  (相对于 input/ 的路径)
    """
    if "file" not in request.files:
        return jsonify({"error": "请上传图片文件"}), 400

    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"error": "无效的文件"}), 400

    # 文件类型校验
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        return jsonify({"error": f"不支持的图片格式: {content_type}"}), 400

    # 文件大小校验
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_IMAGE_SIZE:
        return jsonify({"error": f"文件过大 ({size // 1024 // 1024}MB)，最大 20MB"}), 400

    # 生成安全文件名
    import uuid
    usage = request.form.get("type", "ref")
    ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/bmp": ".bmp"}
    ext = ext_map.get(content_type, ".png")
    safe_name = f"comfycarry_{usage}_{uuid.uuid4().hex[:8]}{ext}"

    input_dir = os.path.join(COMFYUI_DIR, "input")

    # 可选子目录 (如 openpose / canny / depth)
    subfolder = request.form.get("subfolder", "").strip()
    if subfolder:
        safe_sub = os.path.basename(subfolder)  # 防止路径遍历
        save_dir = os.path.join(input_dir, safe_sub)
    else:
        save_dir = input_dir
    os.makedirs(save_dir, exist_ok=True)
    dest = os.path.join(save_dir, safe_name)

    file.save(dest)

    # 返回相对于 input/ 的路径
    rel_name = f"{safe_sub}/{safe_name}" if subfolder else safe_name
    logger.info(f"[generate] 图片已上传: {rel_name} ({size} bytes)")

    result = {"filename": rel_name}

    # 返回图片尺寸 (用于图生图自动填充 width/height)
    try:
        from PIL import Image as PILImage
        with PILImage.open(dest) as img:
            result["width"], result["height"] = img.size
    except Exception:
        pass

    return jsonify(result)


# ── /api/generate/preprocess ─────────────────────────────────────────────────

@bp.route("/api/generate/preprocess", methods=["POST"])
def api_generate_preprocess():
    """
    上传源图片（或指定 input/ 已有文件）并提交 ControlNet 预处理工作流。

    Form data:
        file       — 源图片文件 (png/jpeg/webp/bmp, 最大 20MB)。与 input_name 二选一
        input_name — input/ 中已有文件的文件名。与 file 二选一
        type       — 预处理类型: "pose" | "canny" | "depth"
        params     — JSON 字符串，预处理器参数 (可选)

    返回: {"prompt_id": "...", "output_filename": "preprocess_pose_xxx.png"}
    """
    import uuid as _uuid
    import json as _json

    pp_type = request.form.get("type", "").strip()
    if pp_type not in ("pose", "canny", "depth"):
        return jsonify({"error": f"不支持的预处理类型: {pp_type}"}), 400

    input_dir = os.path.join(COMFYUI_DIR, "input")
    os.makedirs(input_dir, exist_ok=True)
    uid = _uuid.uuid4().hex[:8]

    # 确定源图片
    input_name = request.form.get("input_name", "").strip()
    if input_name:
        # 使用 input/ 中已有文件
        safe_name = os.path.basename(input_name)
        src_path = os.path.join(input_dir, safe_name)
        if not os.path.isfile(src_path):
            return jsonify({"error": f"文件不存在: {safe_name}"}), 404
        src_name = safe_name
    elif "file" in request.files:
        file = request.files["file"]
        if not file or not file.filename:
            return jsonify({"error": "无效的文件"}), 400

        # 文件类型校验
        content_type = file.content_type or ""
        if content_type not in ALLOWED_IMAGE_TYPES:
            return jsonify({"error": f"不支持的图片格式: {content_type}"}), 400

        # 文件大小校验
        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > MAX_IMAGE_SIZE:
            return jsonify({"error": f"文件过大 ({size // 1024 // 1024}MB)，最大 20MB"}), 400

        ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/bmp": ".bmp"}
        ext = ext_map.get(content_type, ".png")
        src_name = f"comfycarry_src_{pp_type}_{uid}{ext}"
        dest = os.path.join(input_dir, src_name)
        file.save(dest)
    else:
        return jsonify({"error": "请上传图片或指定 input 文件名"}), 400

    # 解析预处理器参数
    extra_params = {}
    params_str = request.form.get("params", "")
    if params_str:
        try:
            extra_params = _json.loads(params_str)
        except _json.JSONDecodeError:
            pass

    # 预处理输出文件名 → 保存到子目录 (input/openpose, input/canny, input/depth)
    _SUBFOLDER_MAP = {"pose": "openpose", "canny": "canny", "depth": "depth"}
    subfolder = _SUBFOLDER_MAP.get(pp_type, pp_type)
    output_dir = os.path.join(input_dir, subfolder)
    os.makedirs(output_dir, exist_ok=True)
    output_name = f"preprocess_{pp_type}_{uid}"

    # 构建预处理工作流
    try:
        prompt = build_preprocess_workflow({
            "image": src_name,
            "type": pp_type,
            "save_prefix": output_name,
            "input_dir": output_dir,
            **extra_params,
        })
    except Exception as e:
        logger.exception("[generate] 构建预处理工作流失败")
        return jsonify({"error": f"工作流构建失败: {e}"}), 500

    # 提交到 ComfyUI
    try:
        bridge = get_bridge()
        payload = {"prompt": prompt, "client_id": bridge.client_id}
        resp = requests.post(f"{COMFYUI_URL}/prompt", json=payload, timeout=30)
        resp.raise_for_status()
        result = resp.json()
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "ComfyUI 未运行"}), 503
    except Exception as e:
        logger.exception("[generate] 提交预处理工作流失败")
        return jsonify({"error": f"提交失败: {e}"}), 500

    prompt_id = result.get("prompt_id", "")
    output_filename = f"{output_name}.png"
    # 返回带子目录的相对路径（如 "openpose/preprocess_pose_xxx.png"）
    output_relpath = f"{subfolder}/{output_filename}"
    logger.info(f"[generate] 预处理提交 prompt_id={prompt_id} type={pp_type} output={output_relpath}")

    return jsonify({
        "prompt_id": prompt_id,
        "output_filename": output_relpath,
    })


# ── /api/generate/input_images ───────────────────────────────────────────────

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

@bp.route("/api/generate/input_images")
def api_generate_input_images():
    """
    列出 ComfyUI input/ 目录中的图片文件 (供参考图选择器使用)。
    Query params:
        subfolder — 可选子目录名 (如 "openpose"), 仅列出该子目录中的图片
    """
    subfolder = request.args.get("subfolder", "").strip()
    input_dir = os.path.join(COMFYUI_DIR, "input")
    if subfolder:
        # 安全校验：不允许路径遍历
        safe_sub = os.path.basename(subfolder)
        scan_dir = os.path.join(input_dir, safe_sub)
    else:
        scan_dir = input_dir
    if not os.path.isdir(scan_dir):
        return jsonify({"images": []})
    images = []
    for f in sorted(os.listdir(scan_dir)):
        ext = os.path.splitext(f)[1].lower()
        if ext not in IMAGE_EXTENSIONS:
            continue
        fpath = os.path.join(scan_dir, f)
        if not os.path.isfile(fpath):
            continue
        # 返回相对于 input/ 的路径
        rel_name = f"{safe_sub}/{f}" if subfolder else f
        images.append({"name": rel_name, "size": os.path.getsize(fpath)})
    return jsonify({"images": images})


@bp.route("/api/generate/input_image_preview")
def api_generate_input_image_preview():
    """返回 ComfyUI input/ 中指定图片的原始文件 (用于缩略图预览)。支持子目录 (如 "openpose/file.png")。"""
    from flask import send_from_directory, abort
    name = request.args.get("name", "")
    if not name or ".." in name:
        abort(400)
    input_dir = os.path.join(COMFYUI_DIR, "input")
    fpath = os.path.join(input_dir, name)
    real_input = os.path.realpath(input_dir)
    real_fpath = os.path.realpath(fpath)
    if not real_fpath.startswith(real_input + os.sep):
        abort(403)
    if not os.path.isfile(fpath):
        abort(404)
    # 分离目录和文件名
    sub_dir = os.path.dirname(name)
    base_name = os.path.basename(name)
    serve_dir = os.path.join(input_dir, sub_dir) if sub_dir else input_dir
    return send_from_directory(serve_dir, base_name)


# ── /api/generate/submit ─────────────────────────────────────────────────────

# 支持的模型类型 → 对应工作流构建函数
_BUILDERS = {
    "sdxl": build_sdxl_workflow,
    "anima": build_anima_workflow,    # 分离式架构: UNet + 单 CLIP + VAE
    "krea2": build_krea2_workflow,    # 分离式架构: UNet + 单 CLIP + VAE
    "zimage": build_zimage_workflow,  # 分离式架构: UNet + 单 CLIP (lumina2) + VAE + ModelSamplingAuraFlow
    "flux1": build_flux1_workflow,    # 分离式架构: UNet + 双 CLIP (flux) + VAE
    # "flux2": build_flux2_workflow,   ← Owner 决策搁置 (采样拓扑不同, 独立 builder)
}

# 分离式三件套架构集合 (UNet + Text Encoder + VAE), 校验逻辑共用
# 注: flux2 搁置, 不在此集合 (build_flux2_workflow 未实现)
_SPLIT_ARCHS = ("anima", "krea2", "zimage", "flux1")

# 需要 dual CLIP (clip + clip2) 的架构集合 — 在 _SPLIT_ARCHS 分支内额外校验 clip2
_DUAL_CLIP_ARCHS = ("flux1",)


@bp.route("/api/generate/submit", methods=["POST"])
def api_generate_submit():
    """
    提交生成请求。

    请求体 (JSON):
        model_type      (str)   — 工作流类型，目前支持 "sdxl"
        checkpoint      (str)   — Checkpoint 文件名
        positive_prompt (str)   — 正向提示词 (必填)
        negative_prompt (str)   — 负向提示词，可为空
        width           (int)   — 宽度 (默认 1024)
        height          (int)   — 高度 (默认 1024)
        batch_size      (int)   — 批量数量 1~16 (默认 1)
        seed            (int)   — 种子，-1 = 随机 (默认 -1)
        steps           (int)   — 步数 (默认 20)
        cfg             (float) — CFG scale (默认 7.0)
        sampler         (str)   — 采样器 (默认 "euler")
        scheduler       (str)   — 调度器 (默认 "normal")
        save_prefix     (str)   — 文件名前缀 (默认 "ComfyCarry")
        loras           (list)  — LoRA 列表: [{name: str, strength: float}, ...]
                                  （也向后兼容旧格式: lora_name + lora_strength）

    响应 (JSON):
        { "prompt_id": "...", "status": "queued" }
    或错误:
        { "error": "..." }
    """
    data = request.get_json(silent=True) or {}

    # ── 基础参数校验 ────────────────────────────────────────────────────────
    model_type = data.get("model_type", "sdxl").strip().lower()
    if model_type not in _BUILDERS:
        return jsonify({"error": f"不支持的模型类型: {model_type}"}), 400

    positive_prompt = data.get("positive_prompt", "").strip()
    if not positive_prompt:
        return jsonify({"error": "画面描述不能为空"}), 400

    # ── 参数范围校验 ────────────────────────────────────────────────────────
    batch_size = max(1, min(int(data.get("batch_size", 1) or 1), 16))
    data["batch_size"] = batch_size  # 归一化后写回

    # ── 模型文件存在性校验 ──────────────────────────────────────────────────
    try:
        opts = _fetch_generate_options()
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "ComfyUI 未运行，请先在 ComfyUI 页面启动服务"}), 503
    except Exception as e:
        logger.warning(f"[generate] 获取 options 失败 (非致命，跳过校验): {e}")
        opts = {}

    # 不同模型类型校验不同字段
    if model_type == "sdxl":
        checkpoint = data.get("checkpoint", "").strip()
        if not checkpoint:
            return jsonify({"error": "请选择基础模型 (Checkpoint)"}), 400
        ckpt_list = opts.get("checkpoints", [])
        if ckpt_list and checkpoint not in ckpt_list:
            return jsonify({
                "error": f"模型文件未找到: {checkpoint}，请前往模型管理页确认"
            }), 400
        # B4: clip_skip 钳制 1..4 (缺省 1, 不传则 builder 走默认行为 = 无 CLIPSetLastLayer)
        try:
            clip_skip = int(data.get("clip_skip", 1) or 1)
        except (TypeError, ValueError):
            clip_skip = 1
        data["clip_skip"] = max(1, min(clip_skip, 4))
        # B4: vae 覆盖 (可选 str, 非空时校验存在于 VAE 列表)
        vae_override = str(data.get("vae", "") or "").strip()
        if vae_override:
            vae_list = opts.get("vaes", [])
            if vae_list and vae_override not in vae_list:
                return jsonify({
                    "error": f"VAE 文件未找到: {vae_override}，请前往模型管理页确认"
                }), 400
            data["vae"] = vae_override
        else:
            data["vae"] = ""
    elif model_type in _SPLIT_ARCHS:
        unet = data.get("unet", "").strip()
        clip = data.get("clip", "").strip()
        vae = data.get("vae", "").strip()
        if not unet or not clip or not vae:
            return jsonify({
                "error": f"{model_type} 需选择 UNet / Text Encoder / VAE 三个模型文件"
            }), 400
        for key, fname, listkey, label in (
            ("unet", unet, "unets", "UNet"),
            ("clip", clip, "clips", "Text Encoder"),
            ("vae", vae, "vaes", "VAE"),
        ):
            file_list = opts.get(listkey, [])
            if file_list and fname not in file_list:
                return jsonify({
                    "error": f"{label} 文件未找到: {fname}，请前往模型管理页确认"
                }), 400
            data[key] = fname
        # flux1 等双 CLIP 架构: 额外校验 clip2 (第二 Text Encoder, 如 T5)
        if model_type in _DUAL_CLIP_ARCHS:
            clip2 = data.get("clip2", "").strip()
            if not clip2:
                return jsonify({
                    "error": "flux1 需选择两个 Text Encoder (CLIP-L + T5)"
                }), 400
            clip_list = opts.get("clips", [])
            if clip_list and clip2 not in clip_list:
                return jsonify({
                    "error": f"Text Encoder 文件未找到: {clip2}，请前往模型管理页确认"
                }), 400
            data["clip2"] = clip2

    # ── LoRA 文件存在性校验 (支持数组格式) ─────────────────────────────────
    loras = data.get("loras") or []
    # 兼容旧格式
    if not loras:
        legacy_name = data.get("lora_name", "").strip()
        if legacy_name:
            loras = [{"name": legacy_name, "strength": float(data.get("lora_strength", 1.0))}]

    lora_list = opts.get("loras", [])
    for lora_entry in loras:
        lora_name = str(lora_entry.get("name", "")).strip()
        if lora_name and lora_list and lora_name not in lora_list:
            return jsonify({
                "error": f"LoRA 文件未找到: {lora_name}，请前往模型管理页确认"
            }), 400

    # 确保归一化后的 loras 写回 data（兼容 workflow_builder 读取）
    data["loras"] = loras

    # ── ControlNet 参数校验 ─────────────────────────────────────────────────
    controlnets = data.get("controlnets") or []
    validated_cns = []
    input_dir = os.path.join(COMFYUI_DIR, "input")
    for cn in controlnets:
        cn_model = str(cn.get("model", "")).strip()
        cn_image = str(cn.get("image", "")).strip()
        if not cn_model or not cn_image:
            continue
        # 校验图片文件存在
        img_path = os.path.join(input_dir, cn_image)
        real_img = os.path.realpath(img_path)
        real_input = os.path.realpath(input_dir)
        if not real_img.startswith(real_input + os.sep):
            return jsonify({"error": f"ControlNet 图片路径无效: {cn_image}"}), 400
        if not os.path.isfile(img_path):
            return jsonify({"error": f"ControlNet 参考图不存在: {cn_image}，请重新上传"}), 400
        validated_cns.append({
            "type": str(cn.get("type", "")),
            "model": cn_model,
            "image": cn_image,
            "strength": float(cn.get("strength", 1.0)),
            "start_percent": float(cn.get("start_percent", 0.0)),
            "end_percent": float(cn.get("end_percent", 1.0)),
        })
    data["controlnets"] = validated_cns

    # ── Img2Img 参数校验 ────────────────────────────────────────────────────
    i2i_image = str(data.get("i2i_image", "")).strip()
    if i2i_image:
        img_path = os.path.join(input_dir, i2i_image)
        real_img = os.path.realpath(img_path)
        real_input = os.path.realpath(input_dir)
        if not real_img.startswith(real_input + os.sep):
            return jsonify({"error": f"图生图参考图路径无效: {i2i_image}"}), 400
        if not os.path.isfile(img_path):
            return jsonify({"error": f"图生图参考图不存在: {i2i_image}，请重新上传"}), 400
        data["i2i_image"] = i2i_image

    # ── 保存路径模板解析 ─────────────────────────────────────────────────────
    # 支持 WAS Image Save 标准格式: [time(%Y-%m-%d)], [time(%H%M%S)] 等
    # 兼容旧格式: [date] → YYYY-MM-DD, [time] → HHMMSS
    now = datetime.now()
    save_prefix = str(data.get("save_prefix", "[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]") or "[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]")

    # 安全检查: 禁止路径遍历和绝对路径
    if '..' in save_prefix or save_prefix.startswith('/'):
        save_prefix = "[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]"

    # WAS 标准: [time(%Y-%m-%d)] → strftime
    save_prefix = re.sub(
        r'\[time\(([^)]+)\)\]',
        lambda m: now.strftime(m.group(1)),
        save_prefix
    )
    # 兼容旧格式
    save_prefix = save_prefix.replace("[date]", now.strftime("%Y-%m-%d"))
    save_prefix = save_prefix.replace("[time]", now.strftime("%H%M%S"))
    data["save_prefix"] = save_prefix

    # ── 输出格式 ─────────────────────────────────────────────────────────────
    # WAS Image Save 支持: png, jpg, jpeg, webp, tiff, bmp, gif
    output_format = str(data.get("output_format", "png")).lower()
    if output_format not in ("png", "jpg", "jpeg", "webp", "tiff", "bmp", "gif"):
        output_format = "png"
    data["output_format"] = output_format

    original_positive = positive_prompt
    original_negative = data.get("negative_prompt", "")

    # ── 提示词模板展开 (dynamicprompts) ─────────────────────────────────────
    try:
        expander = get_expander()
        seed_val = int(data.get("seed", -1))
        pos_result = expander.expand(positive_prompt, seed=seed_val)
        neg_result = expander.expand(
            data.get("negative_prompt", ""),
            seed=(seed_val + 1) if seed_val >= 0 else -1,
        )
        data["positive_prompt"] = pos_result["text"]
        data["negative_prompt"] = neg_result["text"]
    except Exception as e:
        logger.warning(f"[generate] 提示词展开失败 (使用原文): {e}")

    # ── 构建工作流 ──────────────────────────────────────────────────────────
    try:
        prompt = _BUILDERS[model_type](data)
    except Exception as e:
        logger.exception("[generate] 构建工作流失败")
        return jsonify({"error": f"工作流构建失败: {e}"}), 500

    # ── 提交到 ComfyUI ───────────────────────────────────────────────────────
    try:
        # 带上 bridge 的 client_id，ComfyUI 才会向我们的 WS 连接发送执行事件
        bridge = get_bridge()
        payload = {"prompt": prompt, "client_id": bridge.client_id}
        resp = requests.post(
            f"{COMFYUI_URL}/prompt",
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "ComfyUI 未运行，请先在 ComfyUI 页面启动服务"}), 503
    except requests.exceptions.HTTPError as e:
        # 透传 ComfyUI 的错误信息
        try:
            err_body = resp.json()
            err_msg = err_body.get("error", {}).get("message") or str(e)
        except Exception:
            err_msg = str(e)
        logger.error(f"[generate] ComfyUI 拒绝 prompt: {err_msg}")
        return jsonify({"error": f"ComfyUI 错误: {err_msg}"}), 502
    except Exception as e:
        logger.exception("[generate] 提交到 ComfyUI 失败")
        return jsonify({"error": f"提交失败: {e}"}), 500

    prompt_id = result.get("prompt_id", "")
    logger.info(f"[generate] 提交成功 prompt_id={prompt_id} model={model_type} batch={batch_size}")

    try:
        from ..services import prompt_library as pl
        pl.add_history(original_positive, original_negative)
    except Exception as e:
        logger.warning(f"[generate] 录入历史失败 (非致命): {e}")

    return jsonify({"prompt_id": prompt_id, "status": "queued"})


# ── /api/generate/welcome_state ──────────────────────────────────────────────

# DB key prefix for welcome state: "welcome:pose", "welcome:canny", etc.
_WELCOME_KEY_PREFIX = "welcome:"


@bp.route("/api/generate/welcome_state", methods=["GET"])
def api_generate_welcome_state_get():
    """
    读取欢迎页 dismiss 状态。
    返回: {"pose": true, "canny": true, ...}
    """
    from ..db import db
    rows = db.fetch_all(
        "SELECT key, value FROM app_meta WHERE key LIKE ?",
        (f"{_WELCOME_KEY_PREFIX}%",),
    )
    state = {}
    for row in rows:
        tab = row["key"][len(_WELCOME_KEY_PREFIX):]
        state[tab] = row["value"] == "true"
    return jsonify(state)


@bp.route("/api/generate/welcome_state", methods=["POST"])
def api_generate_welcome_state_post():
    """
    标记某个 tab 的欢迎页已 dismiss。
    Body: {"tab": "pose"}  或 {"tab": "upscale"}
    """
    data = request.get_json(force=True) or {}
    tab = data.get("tab", "").strip()
    if not tab:
        return jsonify({"error": "tab 必填"}), 400

    from ..db import db
    db.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)",
        (f"{_WELCOME_KEY_PREFIX}{tab}", "true"),
    )
    return jsonify({"ok": True})


# ── /api/generate/tagger_models ──────────────────────────────────────────────

@bp.route("/api/generate/tagger_models", methods=["GET"])
def api_generate_tagger_models():
    """
    扫描 WD14 Tagger 模型目录，返回已安装的模型列表。
    逻辑与 WD14 Tagger 插件的 get_installed_models() 保持一致:
      - 扫描 .onnx 文件
      - 过滤出同时有对应 .csv 文件的
    返回: {"models": ["wd-vit-tagger-v3", "wd-eva02-large-tagger-v3", ...]}
    """
    models_dir = os.path.join(COMFYUI_DIR, "custom_nodes", "ComfyUI-WD14-Tagger", "models")
    if not os.path.isdir(models_dir):
        return jsonify({"models": []})

    installed = []
    for f in os.listdir(models_dir):
        if not f.endswith(".onnx"):
            continue
        base = os.path.splitext(f)[0]
        csv_path = os.path.join(models_dir, base + ".csv")
        if os.path.exists(csv_path):
            installed.append(base)

    installed.sort()
    return jsonify({"models": installed})


# ── /api/generate/interrogate ────────────────────────────────────────────────

@bp.route("/api/generate/interrogate", methods=["POST"])
def api_generate_interrogate():
    """
    上传图片（或指定 input/ 已有文件）并提交 WD14 反推工作流。

    Form data:
        file       — 图片文件 (png/jpeg/webp/bmp, 最大 20MB)。与 input_name 二选一
        input_name — input/ 中已有文件的文件名。与 file 二选一
        params     — JSON 字符串: {model, threshold, character_threshold, exclude_tags, replace_underscore}

    返回: {"prompt_id": "..."}
    """
    import uuid as _uuid

    input_dir = os.path.join(COMFYUI_DIR, "input")
    os.makedirs(input_dir, exist_ok=True)
    uid = _uuid.uuid4().hex[:8]

    # 确定源图片
    input_name = request.form.get("input_name", "").strip()
    if input_name:
        safe_name = os.path.basename(input_name)
        src_path = os.path.join(input_dir, safe_name)
        if not os.path.isfile(src_path):
            return jsonify({"error": f"文件不存在: {safe_name}"}), 404
        src_name = safe_name
    elif "file" in request.files:
        file = request.files["file"]
        if not file or not file.filename:
            return jsonify({"error": "无效的文件"}), 400

        content_type = file.content_type or ""
        if content_type not in ALLOWED_IMAGE_TYPES:
            return jsonify({"error": f"不支持的图片格式: {content_type}"}), 400

        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > MAX_IMAGE_SIZE:
            return jsonify({"error": f"文件过大 ({size // 1024 // 1024}MB)，最大 20MB"}), 400

        ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/bmp": ".bmp"}
        ext = ext_map.get(content_type, ".png")
        src_name = f"comfycarry_tag_src_{uid}{ext}"
        dest = os.path.join(input_dir, src_name)
        file.save(dest)
    else:
        return jsonify({"error": "请上传图片或指定 input 文件名"}), 400

    # 解析参数
    extra_params = {}
    params_str = request.form.get("params", "")
    if params_str:
        try:
            extra_params = json.loads(params_str)
        except json.JSONDecodeError:
            pass

    # 构建反推工作流
    try:
        prompt = build_tag_workflow({
            "image": src_name,
            **extra_params,
        })
    except Exception as e:
        logger.exception("[generate] 构建反推工作流失败")
        return jsonify({"error": f"工作流构建失败: {e}"}), 500

    # 提交到 ComfyUI
    try:
        bridge = get_bridge()
        payload = {"prompt": prompt, "client_id": bridge.client_id}
        resp = requests.post(f"{COMFYUI_URL}/prompt", json=payload, timeout=30)
        resp.raise_for_status()
        result = resp.json()
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "ComfyUI 未运行"}), 503
    except Exception as e:
        logger.exception("[generate] 提交反推工作流失败")
        return jsonify({"error": f"提交失败: {e}"}), 500

    prompt_id = result.get("prompt_id", "")
    logger.info(f"[generate] 反推提交 prompt_id={prompt_id}")

    return jsonify({"prompt_id": prompt_id})


@bp.route("/api/generate/interrogate_result")
def api_generate_interrogate_result():
    """
    从 ComfyUI history 获取 WD14 反推结果。

    Query params:
        prompt_id — ComfyUI prompt_id

    返回: {"tags": "1girl, solo, ...", "prompt_id": "..."}
    """
    prompt_id = request.args.get("prompt_id", "").strip()
    if not prompt_id:
        return jsonify({"error": "prompt_id 必填"}), 400

    try:
        resp = requests.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.exception("[generate] 查询反推结果失败")
        return jsonify({"error": f"查询失败: {e}"}), 500

    if prompt_id not in data:
        return jsonify({"error": "结果未找到，可能尚未完成"}), 404

    entry = data[prompt_id]
    outputs = entry.get("outputs", {})

    tags = ""
    for node_id, output in outputs.items():
        if "tags" in output:
            tag_list = output["tags"]
            tags = tag_list[0] if tag_list else ""
            break

    return jsonify({"tags": tags, "prompt_id": prompt_id})


# ── /api/generate/embeddings ─────────────────────────────────────────────────


@bp.route("/api/generate/embeddings")
def api_generate_embeddings():
    """列出所有可用的 Embedding 文件"""
    emb_dir = os.path.join(COMFYUI_DIR, "models", "embeddings")
    embeddings = []
    if os.path.isdir(emb_dir):
        for root, _dirs, files in os.walk(emb_dir):
            for f in sorted(files):
                if f.endswith((".safetensors", ".pt", ".bin", ".ckpt")):
                    name = os.path.splitext(f)[0]
                    fpath = os.path.join(root, f)
                    rel = os.path.relpath(fpath, emb_dir)
                    embeddings.append({
                        "name": name,
                        "filename": f,
                        "path": rel.replace("\\", "/"),
                        "size": os.path.getsize(fpath),
                    })
    return jsonify({"embeddings": embeddings})


# ── /api/generate/wildcards ──────────────────────────────────────────────────


@bp.route("/api/generate/wildcards")
def api_generate_wildcards_list():
    """列出所有可用 wildcard 文件及文件夹"""
    expander = get_expander()
    return jsonify({"wildcards": expander.list_wildcards(), "folders": expander.list_folders()})


@bp.route("/api/generate/wildcard/<path:name>")
def api_generate_wildcard_get(name):
    """获取指定 wildcard 文件内容"""
    try:
        expander = get_expander()
        content = expander.get_wildcard_content(name)
        return jsonify({"name": name, "content": content})
    except FileNotFoundError:
        return jsonify({"error": f"Wildcard 不存在: {name}"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@bp.route("/api/generate/wildcard/<path:name>", methods=["PUT"])
def api_generate_wildcard_save(name):
    """保存/创建 wildcard 文件"""
    data = request.get_json(silent=True) or {}
    content = data.get("content", "")
    try:
        expander = get_expander()
        expander.save_wildcard(name, content)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@bp.route("/api/generate/wildcard/<path:name>", methods=["DELETE"])
def api_generate_wildcard_delete(name):
    """删除 wildcard 文件"""
    try:
        expander = get_expander()
        expander.delete_wildcard(name)
        return jsonify({"ok": True})
    except FileNotFoundError:
        return jsonify({"error": f"Wildcard 不存在: {name}"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@bp.route("/api/generate/wildcard-folder/<path:name>", methods=["POST"])
def api_generate_wildcard_folder_create(name):
    """创建 wildcard 子文件夹"""
    try:
        expander = get_expander()
        expander.create_folder(name)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@bp.route("/api/generate/wildcard/<path:name>/rename", methods=["POST"])
def api_generate_wildcard_rename(name):
    """重命名 wildcard 文件"""
    data = request.get_json(silent=True) or {}
    new_name = data.get("new_name", "").strip()
    if not new_name:
        return jsonify({"error": "缺少 new_name 参数"}), 400
    try:
        expander = get_expander()
        expander.rename_wildcard(name, new_name)
        return jsonify({"ok": True})
    except FileNotFoundError:
        return jsonify({"error": f"Wildcard 不存在: {name}"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

