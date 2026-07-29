"""
生成提交服务 — submit_generation

把 routes/generate.py 的 api_generate_submit 主体抽成本函数,
路由与后台 worker 共用。整段里只有原第 699 行碰 request, 其余全是纯
data 处理; 此处入口即 copy.deepcopy(data), 路由和 worker 都受
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
    # ── ★ 每轮 deepcopy — 入口即深拷贝, 防止 wildcard 烤死 ──
    data = copy.deepcopy(data)

    # _BUILDERS / _SPLIT_ARCHS / _DUAL_CLIP_ARCHS / _fetch_generate_options
    # 定义在 routes/generate.py (与一堆 _scan_* 辅助函数 / 模块级缓存同处),
    # 此处延迟 import 避免循环依赖 (worker → service → route)。
    from ..routes.generate import (
        _BUILDERS, _SPLIT_ARCHS, _DUAL_CLIP_ARCHS, _VIDEO_ARCHS,
        _fetch_generate_options,
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
        # clip_skip 钳制 1..4 (缺省 1, 不传则 builder 走默认行为 = 无 CLIPSetLastLayer)
        try:
            clip_skip = int(data.get("clip_skip", 1) or 1)
        except (TypeError, ValueError):
            clip_skip = 1
        data["clip_skip"] = max(1, min(clip_skip, 4))
        # vae 覆盖 (可选 str, 非空时校验存在于 VAE 列表)
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
        # packaging 校验分流: checkpoint → 校验 checkpoint 字段; split → 校验 unet/clip[/clip2]/vae
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
            # clip_skip / vae 覆盖接收+钳制是死代码:
            # _build_split_arch_workflow 的 checkpoint 分支 vae_ref = ckpt, 不读 params["vae"];
            # 全项目唯一消费 clip_skip 的是 build_sdxl_workflow (sdxl 分支单独校验)。
            # DiT 整合包选中时前端不再发这俩字段。
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

    # ── Wan 2.2 视频校验分支 ─────────────────────────────────────────
    # 独立于 _SPLIT_ARCHS (后者写死单 unet 必填)。variant 由 model_type 推导:
    #   wan22_i2v → "i2v" (14B 双权重), wan22_t2v → "t2v" (14B 双权重),
    #   wan22_5b → "5b" (单权重, 条目内 t2v/i2v 模式开关)。
    if model_type in _VIDEO_ARCHS:
        variant = {"wan22_i2v": "i2v", "wan22_t2v": "t2v", "wan22_5b": "5b"}[model_type]
        is_14b = variant in ("t2v", "i2v")
        fps = 16 if is_14b else 24  # 帧率随条目锁定

        # ── 主权重: 14B 双权重必填且互异; 5B 单权重必填 ──
        if is_14b:
            unet_high = str(data.get("unet_high", "")).strip()
            unet_low = str(data.get("unet_low", "")).strip()
            if not unet_high or not unet_low:
                return {"error": "Wan 2.2 14B 需选择高噪 / 低噪两段 UNet 权重"}, 400
            if unet_high == unet_low:
                return {"error": "高噪与低噪 UNet 不能是同一个文件"}, 400
            unet_list = opts.get("unets", [])
            for key, fname, label in (
                ("unet_high", unet_high, "高噪 UNet"),
                ("unet_low", unet_low, "低噪 UNet"),
            ):
                if unet_list and fname not in unet_list:
                    return {
                        "error": f"{label} 文件未找到: {fname}，请前往模型管理页确认"
                    }, 400
                data[key] = fname
        else:
            unet = str(data.get("unet", "")).strip()
            if not unet:
                return {"error": "Wan 2.2 5B 需选择 UNet 权重"}, 400
            unet_list = opts.get("unets", [])
            if unet_list and unet not in unet_list:
                return {
                    "error": f"UNet 文件未找到: {unet}，请前往模型管理页确认"
                }, 400
            data["unet"] = unet

        # ── TE / VAE 必填 ──
        clip = str(data.get("clip", "")).strip()
        vae = str(data.get("vae", "")).strip()
        if not clip or not vae:
            return {"error": "需选择 Text Encoder / VAE 两个模型文件"}, 400
        for key, fname, listkey, label in (
            ("clip", clip, "clips", "Text Encoder"),
            ("vae", vae, "vaes", "VAE"),
        ):
            file_list = opts.get(listkey, [])
            if file_list and fname not in file_list:
                return {
                    "error": f"{label} 文件未找到: {fname}，请前往模型管理页确认"
                }, 400
            data[key] = fname

        # ── 起始画面: i2v 必填; 5b 仅 mode=='i2v' 时必填 ──
        # (input_dir 与 i2i 校验块共用, 此处就地定义 — ControlNet 块在更后面)
        input_dir = os.path.join(COMFYUI_DIR, "input")
        start_image = str(data.get("start_image", "")).strip()
        need_start = variant == "i2v"
        if variant == "5b":
            mode = str(data.get("mode", "")).strip().lower()
            need_start = (mode == "i2v")
        if need_start:
            if not start_image:
                return {"error": "请先上传起始画面"}, 400
            img_path = os.path.join(input_dir, start_image)
            real_img = os.path.realpath(img_path)
            real_input = os.path.realpath(input_dir)
            if not real_img.startswith(real_input + os.sep):
                return {"error": f"起始画面路径无效: {start_image}"}, 400
            if not os.path.isfile(img_path):
                return {"error": f"起始画面不存在: {start_image}，请重新上传"}, 400
            data["start_image"] = start_image
        else:
            # t2v 模式清空, 防止脏值
            data["start_image"] = ""

        # ── 分辨率: 14B %16, 5B %32; W×H ≤ 921600 (720p 预算) ──
        try:
            width = int(data.get("width", 640 if is_14b else 1280))
        except (TypeError, ValueError):
            return {"error": "分辨率宽度需为整数"}, 400
        try:
            height = int(data.get("height", 640 if is_14b else 704))
        except (TypeError, ValueError):
            return {"error": "分辨率高度需为整数"}, 400
        mod = 16 if is_14b else 32
        if width <= 0 or height <= 0:
            return {"error": "分辨率宽高需为正整数"}, 400
        if width % mod != 0 or height % mod != 0:
            return {
                "error": f"视频分辨率需为 {mod} 的倍数（当前 {width}×{height}）"
            }, 400
        if width * height > 921600:
            return {
                "error": f"视频分辨率超出 720p 预算（{width}×{height} > 1280×720），请降低分辨率"
            }, 400
        data["width"] = width
        data["height"] = height

        # ── 时长 / 帧数: frames = fps×duration+1, 上限 14B=7s / 5B=5s, 0.5s 步进 ──
        max_duration = 7 if is_14b else 5
        try:
            duration = float(data.get("duration_s", 5))
        except (TypeError, ValueError):
            return {"error": "时长需为数字"}, 400
        if duration <= 0:
            return {"error": "时长需大于 0 秒"}, 400
        # 0.5s 步进: 容忍浮点误差, 四舍五入到 0.5 的倍数
        duration = round(duration * 2) / 2
        if duration > max_duration:
            return {
                "error": f"时长上限 {max_duration} 秒（当前 {duration} 秒）"
            }, 400
        data["duration_s"] = duration
        length = max(1, int(fps * duration) + 1)
        data["length"] = length

        # ── batch 恒 1 (视频不支持批量) ──
        # 传入 >1 时纠正为 1 (静默纠正, 不报错 — 避免前端 batch 状态残留阻塞提交)
        data["batch_size"] = 1

        # ── 速度档 (仅 14B): fast / standard ──
        if is_14b:
            speed = str(data.get("speed", "fast")).strip().lower()
            if speed not in ("fast", "standard"):
                speed = "fast"
            data["speed"] = speed
            if speed == "fast":
                # 快速档: steps/split/cfg 由 builder 常量决定, 丢弃 negative (cfg=1 无效)
                data.pop("steps", None)
                data.pop("cfg", None)
                data["negative_prompt"] = ""
            else:
                # 标准档: steps ∈ [1,100], cfg ∈ [1,20]; negative 为空则由 builder 注入内置模板
                try:
                    steps = int(data.get("steps", 20))
                except (TypeError, ValueError):
                    steps = 20
                steps = max(1, min(steps, 100))
                data["steps"] = steps
                try:
                    cfg = float(data.get("cfg", 3.5))
                except (TypeError, ValueError):
                    cfg = 3.5
                cfg = max(1.0, min(cfg, 20.0))
                data["cfg"] = cfg
        else:
            # 5B 无速度档: 忽略 fast 字段, 清理脏值
            data.pop("speed", None)
            data.pop("fast", None)

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

    # ── 面部重绘参数校验 ────────────────────────────────────────────────────
    if bool(data.get("face_detailer_enabled", False)):
        fd_model = str(data.get("face_detailer_model", "face_yolov8m.pt")).strip()
        fd_model = fd_model.replace("\\", "/").split("/")[-1] or "face_yolov8m.pt"
        fd_path = os.path.join(COMFYUI_DIR, "models", "ultralytics", "bbox", fd_model)
        if not os.path.isfile(fd_path):
            return {"error": f"面部检测模型不存在: {fd_model}，请先在面部模块下载"}, 400
        data["face_detailer_model"] = fd_model
        if bool(data.get("face_detailer_use_sam", False)):
            sam_path = os.path.join(COMFYUI_DIR, "models", "sams", "sam_vit_b_01ec64.pth")
            if not os.path.isfile(sam_path):
                # SAM 缺失不阻塞生成: 降级为 bbox 矩形掩码
                logger.warning("[generate] SAM 权重缺失, 面部重绘降级为 bbox 掩码")
                data["face_detailer_use_sam"] = False
        # 数值钳制 (builder 端还有一层, 此处保证入库参数干净)
        data["face_detailer_denoise"] = max(0.1, min(float(data.get("face_detailer_denoise", 0.35)), 1.0))
        data["face_detailer_steps"] = max(1, min(int(data.get("face_detailer_steps", 20)), 100))
        data["face_detailer_cfg"] = max(1.0, min(float(data.get("face_detailer_cfg", 7.0)), 20.0))
        data["face_detailer_guide_size"] = max(256, min(int(data.get("face_detailer_guide_size", 768)), 2048))
        data["face_detailer_crop_factor"] = max(1.0, min(float(data.get("face_detailer_crop_factor", 1.8)), 4.0))
        data["face_detailer_bbox_threshold"] = max(0.1, min(float(data.get("face_detailer_bbox_threshold", 0.5)), 0.9))
        data["face_detailer_feather"] = max(0, min(int(data.get("face_detailer_feather", 5)), 100))

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
