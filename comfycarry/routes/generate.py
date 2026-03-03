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
import struct
import time
from datetime import datetime

import requests
from flask import Blueprint, jsonify, request

from ..config import COMFYUI_DIR, COMFYUI_URL
from ..services.comfyui_bridge import get_bridge
from ..services.workflow_builder import build_sdxl_workflow

logger = logging.getLogger(__name__)

bp = Blueprint("generate", __name__)

# ── 懒加载缓存: Generate 页面所需的全部选项 ─────────────────────────────────
_options_cache: dict | None = None
_options_cache_time: float = 0.0


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
                entry["trainedWords"] = info["trainedWords"]
            if info.get("baseModel"):
                entry["baseModel"] = info["baseModel"]
            civitai_model_id = info.get("raw", {}).get("civitai", {}).get("modelId")
            if civitai_model_id:
                entry["civitai_id"] = civitai_model_id
            if info.get("images"):
                entry["images"] = info["images"][:6]
            info_result[name] = entry
        except Exception:
            pass
    return triggers, info_result


def _detect_arch(filepath: str) -> str:
    """
    读取 safetensors 文件 header 检测模型架构。
    返回: "sd15" | "sdxl" | "flux" | "sd3" | "unknown"
    对 .ckpt / .pt 等非 safetensors 格式返回 "unknown"。
    """
    if not filepath.endswith(".safetensors"):
        return "unknown"
    try:
        with open(filepath, "rb") as f:
            header_len = struct.unpack("<Q", f.read(8))[0]
            if header_len <= 0 or header_len > 10_000_000:
                return "unknown"
            raw = f.read(header_len)
        header = json.loads(raw)
        keys = set(k for k in header if k != "__metadata__")

        # 提取所有顶级前缀用于快速特征匹配
        has = lambda prefix: any(k.startswith(prefix) for k in keys)

        # Flux: double_blocks / single_blocks
        if has("double_blocks."):
            return "flux"
        # SD3: joint_blocks
        if has("joint_blocks."):
            return "sd3"
        # SDXL checkpoint: 双 text encoder (conditioner.embedders.1) 或 label_emb
        if has("conditioner.embedders.1.") or \
           "model.diffusion_model.label_emb.0.0.weight" in keys:
            return "sdxl"
        # SD1.5 checkpoint: cond_stage_model / diffusion_model 但无 SDXL 标记
        if has("cond_stage_model.") or has("model.diffusion_model."):
            return "sd15"
        # LoRA 检测: lora_te2 = SDXL, 无 te2 + 有 te1/unet = SD1.5
        if has("lora_te2_"):
            return "sdxl"
        if has("lora_te1_") or has("lora_unet_"):
            return "sd15"
        return "unknown"
    except Exception:
        return "unknown"


def _scan_model_archs(names: list[str], rel_dir: str) -> dict[str, str]:
    """
    批量检测模型架构，返回 {name: arch}。
    """
    result = {}
    base_dir = os.path.join(COMFYUI_DIR, rel_dir)
    real_base = os.path.realpath(base_dir)
    for name in names:
        filepath = os.path.join(base_dir, name)
        real_path = os.path.realpath(filepath)
        if not real_path.startswith(real_base + os.sep):
            continue  # 跳过路径遍历
        result[name] = _detect_arch(filepath)
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
               "checkpoint_previews": {}, "lora_previews": {}, "lora_triggers": {},
               "lora_info": {}, "checkpoint_info": {},
               "checkpoint_archs": {}, "lora_archs": {}}

    def _get_combo_list(node_name: str, field: str, cache: dict = {}) -> list:
        """获取节点的下拉选项（同节点缓存，避免重复 HTTP 请求）"""
        if node_name not in cache:
            try:
                r = requests.get(f"{COMFYUI_URL}/object_info/{node_name}", timeout=10)
                r.raise_for_status()
                cache[node_name] = r.json()
            except Exception as e:
                logger.warning(f"[generate] 获取 {node_name} 失败: {e}")
                cache[node_name] = {}
        d = cache.get(node_name, {})
        return d.get(node_name, {}).get("input", {}).get("required", {}).get(field, [[]])[0] or []

    samplers   = _get_combo_list("KSampler", "sampler_name")
    schedulers = _get_combo_list("KSampler", "scheduler")
    checkpoints = _get_combo_list("CheckpointLoaderSimple", "ckpt_name")
    loras       = _get_combo_list("LoraLoader", "lora_name")

    if not samplers:
        # ComfyUI 未运行，返回默认值但不缓存
        logger.warning("[generate] ComfyUI 未运行，返回内置默认选项")
        return DEFAULT

    result = {
        "samplers":    samplers   if isinstance(samplers, list)    else DEFAULT_SAMPLERS,
        "schedulers":  schedulers if isinstance(schedulers, list)  else DEFAULT_SCHEDULERS,
        "checkpoints": checkpoints if isinstance(checkpoints, list) else [],
        "loras":       loras       if isinstance(loras, list)       else [],
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
    global _options_cache, _options_cache_time
    if request.args.get("refresh") == "1":
        _options_cache = None
        _options_cache_time = 0.0
    return jsonify(_fetch_generate_options())


# ── /api/generate/submit ─────────────────────────────────────────────────────

# 支持的模型类型 → 对应工作流构建函数
_BUILDERS = {
    "sdxl": build_sdxl_workflow,
    # "flux": build_flux_workflow,    ← Phase 2+
    # "zimage": build_zimage_workflow,
}


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

    checkpoint = data.get("checkpoint", "").strip()
    if not checkpoint:
        return jsonify({"error": "请选择基础模型 (Checkpoint)"}), 400

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

    ckpt_list = opts.get("checkpoints", [])
    if ckpt_list and checkpoint not in ckpt_list:
        return jsonify({
            "error": f"模型文件未找到: {checkpoint}，请前往模型管理页确认"
        }), 400

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

    return jsonify({"prompt_id": prompt_id, "status": "queued"})
