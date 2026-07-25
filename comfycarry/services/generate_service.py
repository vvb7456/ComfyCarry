"""
生成提交服务 — submit_generation

§3.2: 把 routes/generate.py 的 api_generate_submit 主体抽成本函数,
路由与后台 worker 共用。整段里只有原第 699 行碰 request, 其余全是纯
data 处理; 此处入口即 copy.deepcopy(data) (§3.3), 路由和 worker 都受
保护, 防止 wildcard / save_prefix / loras / controlnets 被原地固化。

签名: submit_generation(data: dict) -> tuple[dict, int]
返回: (响应体 dict, HTTP 状态码)。路由包一层 jsonify, worker 直接读。
对外行为与原 api_generate_submit 完全一致 (同入参 → 同响应体/状态码)。
"""

import copy
import logging
import os
import re
from datetime import datetime

import requests

from ..config import COMFYUI_DIR, COMFYUI_URL
from ..services.comfyui_bridge import get_bridge
from ..services.prompt_expander import get_expander

logger = logging.getLogger(__name__)


def submit_generation(data: dict) -> tuple[dict, int]:
    """
    构建工作流并提交到 ComfyUI。

    参数 data 即原路由从 request.get_json() 拿到的字典, 会在此函数内被
    deepcopy 后原地改写 (positive_prompt / save_prefix / loras / controlnets
    等归一化写回), 调用方传入的 dict 不受影响。

    返回 (响应体, HTTP 状态码):
      成功: ({"prompt_id": "...", "status": "queued"}, 200)
      失败: ({"error": "..."}, 400/500/502/503)
    """
    # ── §3.3 ★ 每轮 deepcopy — 入口即深拷贝, 防止 wildcard 烤死 ──
    data = copy.deepcopy(data)

    # _BUILDERS / _SPLIT_ARCHS / _DUAL_CLIP_ARCHS / _fetch_generate_options
    # 定义在 routes/generate.py (与一堆 _scan_* 辅助函数 / 模块级缓存同处),
    # 此处延迟 import 避免循环依赖 (worker → service → route)。
    from ..routes.generate import (
        _BUILDERS, _SPLIT_ARCHS, _DUAL_CLIP_ARCHS, _fetch_generate_options,
    )

    # ── 基础参数校验 ────────────────────────────────────────────────────────
    model_type = data.get("model_type", "sdxl").strip().lower()
    if model_type not in _BUILDERS:
        return {"error": f"不支持的模型类型: {model_type}"}, 400

    positive_prompt = data.get("positive_prompt", "").strip()
    if not positive_prompt:
        return {"error": "画面描述不能为空"}, 400

    # ── 参数范围校验 ────────────────────────────────────────────────────────
    batch_size = max(1, min(int(data.get("batch_size", 1) or 1), 16))
    data["batch_size"] = batch_size  # 归一化后写回

    # ── 模型文件存在性校验 ──────────────────────────────────────────────────
    try:
        opts = _fetch_generate_options()
    except requests.exceptions.ConnectionError:
        return {"error": "ComfyUI 未运行，请先在 ComfyUI 页面启动服务"}, 503
    except Exception as e:
        logger.warning(f"[generate] 获取 options 失败 (非致命，跳过校验): {e}")
        opts = {}

    # 不同模型类型校验不同字段
    if model_type == "sdxl":
        checkpoint = data.get("checkpoint", "").strip()
        if not checkpoint:
            return {"error": "请选择基础模型 (Checkpoint)"}, 400
        ckpt_list = opts.get("checkpoints", [])
        if ckpt_list and checkpoint not in ckpt_list:
            return {
                "error": f"模型文件未找到: {checkpoint}，请前往模型管理页确认"
            }, 400
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
                return {
                    "error": f"VAE 文件未找到: {vae_override}，请前往模型管理页确认"
                }, 400
            data["vae"] = vae_override
        else:
            data["vae"] = ""
    elif model_type in _SPLIT_ARCHS:
        # §5.2 packaging 校验分流: checkpoint → 校验 checkpoint 字段; split → 校验 unet/clip[/clip2]/vae
        packaging = str(data.get("packaging", "split"))
        if packaging not in ("checkpoint", "split"):
            packaging = "split"
        data["packaging"] = packaging

        if packaging == "checkpoint":
            checkpoint = data.get("checkpoint", "").strip()
            if not checkpoint:
                return {
                    "error": f"{model_type} (整合包) 需选择 Checkpoint 模型文件"
                }, 400
            ckpt_list = opts.get("checkpoints", [])
            # 整合包可能落在 diffusion_models/ (旧下载归位 bug) 也可能在 checkpoints/
            unet_list = opts.get("unets", [])
            if ckpt_list and checkpoint not in ckpt_list and unet_list and checkpoint not in unet_list:
                return {
                    "error": f"模型文件未找到: {checkpoint}，请前往模型管理页确认"
                }, 400
            data["checkpoint"] = checkpoint
            # 整合包模式: clip_skip (仅 sdxl profile 系, DiT 忽略) + vae 覆盖 (可选)
            try:
                clip_skip = int(data.get("clip_skip", 1) or 1)
            except (TypeError, ValueError):
                clip_skip = 1
            data["clip_skip"] = max(1, min(clip_skip, 4))
            vae_override = str(data.get("vae", "") or "").strip()
            if vae_override:
                vae_list = opts.get("vaes", [])
                if vae_list and vae_override not in vae_list:
                    return {
                        "error": f"VAE 文件未找到: {vae_override}，请前往模型管理页确认"
                    }, 400
                data["vae"] = vae_override
            else:
                data["vae"] = ""
        else:
            unet = data.get("unet", "").strip()
            clip = data.get("clip", "").strip()
            vae = data.get("vae", "").strip()
            if not unet or not clip or not vae:
                return {
                    "error": f"{model_type} 需选择 UNet / Text Encoder / VAE 三个模型文件"
                }, 400
            for key, fname, listkey, label in (
                ("unet", unet, "unets", "UNet"),
                ("clip", clip, "clips", "Text Encoder"),
                ("vae", vae, "vaes", "VAE"),
            ):
                file_list = opts.get(listkey, [])
                if file_list and fname not in file_list:
                    return {
                        "error": f"{label} 文件未找到: {fname}，请前往模型管理页确认"
                    }, 400
                data[key] = fname
            # flux1 等双 CLIP 架构: 额外校验 clip2 (第二 Text Encoder, 如 T5)
            if model_type in _DUAL_CLIP_ARCHS:
                clip2 = data.get("clip2", "").strip()
                if not clip2:
                    return {
                        "error": "flux1 需选择两个 Text Encoder (CLIP-L + T5)"
                    }, 400
                clip_list = opts.get("clips", [])
                if clip_list and clip2 not in clip_list:
                    return {
                        "error": f"Text Encoder 文件未找到: {clip2}，请前往模型管理页确认"
                    }, 400
                data["clip2"] = clip2

    # ── Flux2 guider_mode 归一化 ──────────────────────────────────────────
    # basic (dev, 无负面) / cfg (klein, 有负面); 缺省 cfg
    if model_type == "flux2":
        guider_mode = str(data.get("guider_mode", "cfg"))
        if guider_mode not in ("basic", "cfg"):
            guider_mode = "cfg"
        data["guider_mode"] = guider_mode

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
            return {
                "error": f"LoRA 文件未找到: {lora_name}，请前往模型管理页确认"
            }, 400

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
            return {"error": f"ControlNet 图片路径无效: {cn_image}"}, 400
        if not os.path.isfile(img_path):
            return {"error": f"ControlNet 参考图不存在: {cn_image}，请重新上传"}, 400
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
            return {"error": f"图生图参考图路径无效: {i2i_image}"}, 400
        if not os.path.isfile(img_path):
            return {"error": f"图生图参考图不存在: {i2i_image}，请重新上传"}, 400
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
        return {"error": f"工作流构建失败: {e}"}, 500

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
        return {"error": "ComfyUI 未运行，请先在 ComfyUI 页面启动服务"}, 503
    except requests.exceptions.HTTPError as e:
        # 透传 ComfyUI 的错误信息
        try:
            err_body = resp.json()
            err_msg = err_body.get("error", {}).get("message") or str(e)
        except Exception:
            err_msg = str(e)
        logger.error(f"[generate] ComfyUI 拒绝 prompt: {err_msg}")
        return {"error": f"ComfyUI 错误: {err_msg}"}, 502
    except Exception as e:
        logger.exception("[generate] 提交到 ComfyUI 失败")
        return {"error": f"提交失败: {e}"}, 500

    prompt_id = result.get("prompt_id", "")
    logger.info(f"[generate] 提交成功 prompt_id={prompt_id} model={model_type} batch={batch_size}")

    try:
        from ..services import prompt_library as pl
        pl.add_history(original_positive, original_negative)
    except Exception as e:
        logger.warning(f"[generate] 录入历史失败 (非致命): {e}")

    return {"prompt_id": prompt_id, "status": "queued"}, 200
