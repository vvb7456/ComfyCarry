"""
comfycarry/services/workflow_builder.py
────────────────────────────────────────
模块化工作流构建器 — 代码直接构建 ComfyUI /prompt API payload。

核心理念:
- 项目中不存在任何完整的 workflow.json 文件
- 每个功能模块是一个 Python 方法，负责向 prompt dict 插入节点
- 用户选择功能 → 调用对应方法拼接 → 生成最终 API prompt → 提交
"""

import random


class WorkflowBuilder:
    """
    模块化工作流构建器。
    不持有任何 workflow.json 文件 — 所有节点由代码直接生成。

    节点引用格式: [node_id, output_index]
      - CheckpointLoaderSimple 输出: [0]=MODEL, [1]=CLIP, [2]=VAE
      - LoraLoader 输出:             [0]=MODEL, [1]=CLIP
      - KSampler 输出:               [0]=LATENT
      - VAEDecode 输出:              [0]=IMAGE
    """

    def __init__(self):
        self._nodes: dict = {}
        self._id_counter = 1

    def _next_id(self) -> str:
        nid = str(self._id_counter)
        self._id_counter += 1
        return nid

    # ── 基础节点方法 ──────────────────────────────────────────────────────────

    def add_checkpoint_loader(self, ckpt_name: str) -> str:
        """
        加载 Checkpoint。
        输出: [node_id, 0]=MODEL, [node_id, 1]=CLIP, [node_id, 2]=VAE
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": ckpt_name},
        }
        return nid

    def add_clip_text_encode(self, text: str, clip_node_id: str) -> str:
        """
        CLIP 文本编码 (正向/负向提示词)。
        clip_node_id: 提供 CLIP 的节点 ID (CheckpointLoader 或 LoraLoader)
        输出: [node_id, 0]=CONDITIONING
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": text,
                "clip": [clip_node_id, 1],  # index 1 = CLIP (checkpoint & lora 相同)
            },
        }
        return nid

    def add_empty_latent(self, width: int, height: int, batch_size: int = 1) -> str:
        """
        空 Latent Image。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": batch_size},
        }
        return nid

    def add_ksampler(
        self,
        model_node_id: str,
        positive_ref,
        negative_ref,
        latent_node_id: str,
        seed: int = -1,
        steps: int = 20,
        cfg: float = 7.0,
        sampler: str = "euler",
        scheduler: str = "normal",
        denoise: float = 1.0,
    ) -> str:
        """
        KSampler 采样器。
        positive_ref / negative_ref: node_id (str) 或 (node_id, output_index) 元组。
        seed=-1 → 运行时随机生成。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        actual_seed = seed if seed >= 0 else random.randint(0, 2**32 - 1)
        pos = list(positive_ref) if isinstance(positive_ref, tuple) else [positive_ref, 0]
        neg = list(negative_ref) if isinstance(negative_ref, tuple) else [negative_ref, 0]
        self._nodes[nid] = {
            "class_type": "KSampler",
            "inputs": {
                "seed": actual_seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": denoise,
                "model": [model_node_id, 0],
                "positive": pos,
                "negative": neg,
                "latent_image": [latent_node_id, 0],
            },
        }
        return nid

    def add_vae_decode(self, samples_node_id: str, vae_node_id: str) -> str:
        """
        VAE 解码 Latent → Image。
        vae_node_id: 提供 VAE 的节点 ID (通常是 CheckpointLoader, index 2)
        输出: [node_id, 0]=IMAGE
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": [samples_node_id, 0],
                "vae": [vae_node_id, 2],  # index 2 = VAE (CheckpointLoader)
            },
        }
        return nid

    def add_save_image(self, images_node_id: str, prefix: str = "ComfyCarry",
                       output_path: str = '', extension: str = 'png',
                       batch_size: int = 1) -> str:
        """
        WAS Image Save — 替代标准 SaveImage 节点。
        - batch_size == 1: overwrite_mode=prefix_as_filename → 无序号后缀
        - batch_size  > 1: 正常模式, delimiter='_', padding=2 → prefix_01.png
        """
        nid = self._next_id()
        overwrite = 'prefix_as_filename' if batch_size <= 1 else 'false'
        self._nodes[nid] = {
            "class_type": "Image Save",
            "inputs": {
                "images": [images_node_id, 0],
                "output_path": output_path,
                "filename_prefix": prefix,
                "filename_delimiter": "_",
                "filename_number_padding": 2,
                "filename_number_start": "false",
                "extension": extension,
                "dpi": 300,
                "quality": 100,
                "optimize_image": "true",
                "lossless_webp": "false",
                "overwrite_mode": overwrite,
                "show_history": "false",
                "show_history_by_prefix": "true",
                "embed_workflow": "true",
                "show_previews": "true",
            },
        }
        return nid

    def add_preview_image(self, images_node_id: str) -> str:
        """
        PreviewImage — 将图像通过 WS 广播为实时预览 (非持久化保存)。
        每步解码后通过 ComfyUI WS 二进制帧推送 JPEG 预览。
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "PreviewImage",
            "inputs": {
                "images": [images_node_id, 0],
            },
        }
        return nid

    # ── 扩展模块 ─────────────────────────────────────────────────────────────

    def add_lora_loader(
        self,
        model_node_id: str,
        clip_node_id: str,
        lora_name: str,
        strength_model: float = 1.0,
        strength_clip: float | None = None,
    ) -> str:
        """
        LoRA 加载器 — 插入到 model/clip 链路中。
        强度可独立控制 model/clip，默认相同。
        输出: [node_id, 0]=MODEL, [node_id, 1]=CLIP
        """
        if strength_clip is None:
            strength_clip = strength_model
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": lora_name,
                "strength_model": strength_model,
                "strength_clip": strength_clip,
                "model": [model_node_id, 0],
                "clip": [clip_node_id, 1],
            },
        }
        return nid

    # ── ControlNet 模块 ─────────────────────────────────────────────────────

    def add_load_image(self, image_name: str) -> str:
        """
        加载已上传到 ComfyUI input/ 目录的图片。
        image_name: 文件名 (不含路径)，如 "pose_abc123.png"
        输出: [node_id, 0]=IMAGE, [node_id, 1]=MASK
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LoadImage",
            "inputs": {
                "image": image_name,
            },
        }
        return nid

    def add_controlnet_loader(self, control_net_name: str) -> str:
        """
        加载 ControlNet 模型。
        control_net_name: 模型文件名 (可含子目录前缀)
        输出: [node_id, 0]=CONTROL_NET
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "ControlNetLoader",
            "inputs": {
                "control_net_name": control_net_name,
            },
        }
        return nid

    def add_controlnet_apply_advanced(
        self,
        positive_ref: tuple,
        negative_ref: tuple,
        control_net_node_id: str,
        image_node_id: str,
        strength: float = 1.0,
        start_percent: float = 0.0,
        end_percent: float = 1.0,
    ) -> str:
        """
        应用 ControlNet (ControlNetApplyAdvanced)。
        链式拼接: 多个 ControlNet 顺序应用时，后一个的 pos/neg 接前一个的输出。
        positive_ref / negative_ref: (node_id, output_index) 元组
        输出: [node_id, 0]=positive CONDITIONING, [node_id, 1]=negative CONDITIONING
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": list(positive_ref),
                "negative": list(negative_ref),
                "control_net": [control_net_node_id, 0],
                "image": [image_node_id, 0],
                "strength": max(0.0, min(float(strength), 2.0)),
                "start_percent": max(0.0, min(float(start_percent), 1.0)),
                "end_percent": max(0.0, min(float(end_percent), 1.0)),
            },
        }
        return nid

    # Phase 3+ 占位符:
    # def add_inpaint_model_conditioning(self, ...): ...

    def add_vae_encode(self, image_node_id: str, vae_node_id: str) -> str:
        """
        VAE 编码 Image → Latent。
        用于二次采样: 将放大后的图像编码回 latent 空间以供第二次 KSampler 使用。
        vae_node_id: 提供 VAE 的节点 ID (通常是 CheckpointLoader, index 2)
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEEncode",
            "inputs": {
                "pixels": [image_node_id, 0],
                "vae": [vae_node_id, 2],
            },
        }
        return nid

    # ── ControlNet 预处理器节点 ──────────────────────────────────────────────

    def add_dw_preprocessor(self, image_node_id: str, resolution: int = 1024,
                           detect_body: bool = True, detect_hand: bool = True,
                           detect_face: bool = True) -> str:
        """DWPreprocessor — DWPose 骨骼/关键点检测。输出: IMAGE"""
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "DWPreprocessor",
            "inputs": {
                "image": [image_node_id, 0],
                "detect_hand": "enable" if detect_hand else "disable",
                "detect_body": "enable" if detect_body else "disable",
                "detect_face": "enable" if detect_face else "disable",
                "resolution": resolution,
                "bbox_detector": "yolox_l.onnx",
                "pose_estimator": "dw-ll_ucoco_384_bs5.torchscript.pt",
            },
        }
        return nid

    def add_canny_preprocessor(self, image_node_id: str, resolution: int = 1024,
                               low_threshold: int = 100, high_threshold: int = 200) -> str:
        """CannyEdgePreprocessor — Canny 边缘检测。输出: IMAGE"""
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CannyEdgePreprocessor",
            "inputs": {
                "image": [image_node_id, 0],
                "low_threshold": low_threshold,
                "high_threshold": high_threshold,
                "resolution": resolution,
            },
        }
        return nid

    def add_depth_preprocessor(self, image_node_id: str, resolution: int = 1024) -> str:
        """DepthAnythingV2Preprocessor — 深度图估计。输出: IMAGE"""
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "DepthAnythingV2Preprocessor",
            "inputs": {
                "image": [image_node_id, 0],
                "ckpt_name": "depth_anything_v2_vitl.pth",
                "resolution": resolution,
            },
        }
        return nid

    # ── AI 放大模块 ──────────────────────────────────────────────────────────

    def add_aurasr_upscale(
        self,
        image_node_id: str,
        model_name: str = "model.safetensors",
        mode: str = "4x_overlapped_checkboard",
        tile_batch_size: int = 8,
    ) -> str:
        """
        AuraSR v2 超分辨率放大 (固定 4x)。
        model_name: Aura-SR 模型目录下的文件名 (含后缀, 如 model.safetensors)
        mode: 4x | 4x_overlapped_checkboard (推荐，消除拼接) | 4x_overlapped_constant
        tile_batch_size: 1-32，每次处理的图块数，越大越快但占用显存越多
        输出: [node_id, 0]=IMAGE (4x 分辨率)
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "AuraSR.AuraSRUpscaler",
            "inputs": {
                "image": [image_node_id, 0],
                "model_name": model_name,
                "mode": mode,
                "reapply_transparency": True,
                "tile_batch_size": max(1, min(int(tile_batch_size), 32)),
                "device": "default",
                "offload_to_cpu": False,
            },
        }
        return nid

    def add_image_scale(
        self,
        image_node_id: str,
        width: int,
        height: int,
        method: str = "lanczos",
        crop: str = "disabled",
    ) -> str:
        """
        缩放图片到指定尺寸 (内置节点)。
        用于将 AuraSR 4x 输出缩回目标倍率 (2x/3x)。
        输出: [node_id, 0]=IMAGE
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "ImageScale",
            "inputs": {
                "image": [image_node_id, 0],
                "upscale_method": method,
                "width": width,
                "height": height,
                "crop": crop,
            },
        }
        return nid

    # ── 构建 ─────────────────────────────────────────────────────────────────

    def build(self) -> dict:
        """返回最终的 ComfyUI /prompt API 格式 prompt dict。"""
        return dict(self._nodes)


# ── 顶层工作流函数 ────────────────────────────────────────────────────────────

def build_sdxl_workflow(params: dict) -> dict:
    """
    构建 SDXL 基础工作流 (T2I + 可选多 LoRA 堆叠)。

    params 字段:
        checkpoint      (str, 必填) — 模型文件名
        positive_prompt (str, 必填) — 正向提示词
        negative_prompt (str)       — 负向提示词，默认 ""
        width           (int)       — 宽度，默认 1024
        height          (int)       — 高度，默认 1024
        batch_size      (int)       — 批量生成数量，默认 1（最多 16）
        seed            (int)       — 种子，-1 = 随机，默认 -1
        steps           (int)       — 采样步数，默认 20
        cfg             (float)     — CFG scale，默认 7.0
        sampler         (str)       — 采样器，默认 "euler"
        scheduler       (str)       — 调度器，默认 "normal"
        save_prefix     (str)       — 文件名前缀，默认 "ComfyCarry"
        loras           (list)      — LoRA 列表: [{name, strength}, ...]
                                      （也兼容旧格式: lora_name + lora_strength）
        upscale_enabled (bool)      — 是否启用 AI 放大 (Phase 2)
        upscale_factor  (int)       — 放大倍率: 2 / 3 / 4，默认 2
        upscale_mode    (str)       — 放大模式: 4x / 4x_overlapped_checkboard / 4x_overlapped_constant
        upscale_tile_batch_size (int) — 分块大小 1-32，默认 8
        upscale_downscale_method (str) — 缩放算法: lanczos / bicubic / bilinear / area / nearest-exact
        controlnets     (list)      — ControlNet 列表: [{type, model, image, strength, start_percent, end_percent}, ...]
                                      type: "pose" | "canny" | "depth"
                                      model: ControlNet 模型文件名
                                      image: 已上传到 ComfyUI input/ 的图片文件名
        hires_enabled   (bool)      — 是否启用二次采样
        hires_denoise   (float)     — 二次采样去噪强度 (0.1-0.8)，默认 0.4
        hires_steps     (int)       — 二次采样步数 (5-50)，默认 20
        hires_cfg       (float)     — 二次采样 CFG scale，默认 7.0
        hires_sampler   (str)       — 二次采样采样器，默认 "euler"
        hires_scheduler (str)       — 二次采样调度器，默认 "normal"
        hires_seed      (int)       — 二次采样种子，-1 = 随机
        i2i_image       (str)       — 图生图: 已上传到 ComfyUI input/ 的图片文件名 (启用时替换 EmptyLatentImage)
        i2i_denoise     (float)     — 图生图去噪强度 (0.10-0.90)，默认 0.7，值越低越贴近原图
                                      strength: 0.0-2.0 (默认 1.0)
                                      start_percent: 0.0-1.0 (默认 0.0)
                                      end_percent: 0.0-1.0 (默认 1.0)

    返回值: ComfyUI /prompt API 所需的 prompt dict
    """
    b = WorkflowBuilder()

    # 1. 加载 Checkpoint
    ckpt = b.add_checkpoint_loader(params["checkpoint"])

    # 当前 model/clip 引用点 (LoRA 会链式改变这些引用)
    model_ref = ckpt
    clip_ref = ckpt

    # 2. 链式插入多个 LoRA
    loras = params.get("loras") or []

    for lora_entry in loras:
        lora_name = str(lora_entry.get("name", "")).strip()
        if not lora_name:
            continue
        strength = float(lora_entry.get("strength", 1.0))
        lora_node = b.add_lora_loader(model_ref, clip_ref, lora_name, strength_model=strength)
        model_ref = lora_node
        clip_ref = lora_node

    # 3. 编码提示词
    positive = b.add_clip_text_encode(params.get("positive_prompt", ""), clip_ref)
    negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)

    # 3.5 ControlNet 链式应用 (在 pos/neg 与 KSampler 之间)
    pos_ref = (positive, 0)
    neg_ref = (negative, 0)
    controlnets = params.get("controlnets") or []
    for cn in controlnets:
        cn_model = str(cn.get("model", "")).strip()
        cn_image = str(cn.get("image", "")).strip()
        if not cn_model or not cn_image:
            continue
        cn_loader = b.add_controlnet_loader(cn_model)
        cn_img = b.add_load_image(cn_image)
        cn_apply = b.add_controlnet_apply_advanced(
            pos_ref, neg_ref, cn_loader, cn_img,
            strength=float(cn.get("strength", 1.0)),
            start_percent=float(cn.get("start_percent", 0.0)),
            end_percent=float(cn.get("end_percent", 1.0)),
        )
        pos_ref = (cn_apply, 0)
        neg_ref = (cn_apply, 1)

    # 4. Latent 来源 (T2I: EmptyLatentImage / I2I: LoadImage + VAEEncode)
    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    i2i_image = str(params.get("i2i_image", "")).strip()
    i2i_denoise = 1.0  # T2I 默认全去噪

    if i2i_image:
        # 图生图: 加载参考图 → VAE 编码为 latent
        i2i_load = b.add_load_image(i2i_image)
        latent = b.add_vae_encode(i2i_load, ckpt)
        i2i_denoise = max(0.10, min(float(params.get("i2i_denoise", 0.7)), 0.90))
    else:
        latent = b.add_empty_latent(
            int(params.get("width", 1024)),
            int(params.get("height", 1024)),
            batch_size=batch_size,
        )

    # 5. 采样
    sampled = b.add_ksampler(
        model_ref,
        pos_ref,
        neg_ref,
        latent,
        seed=int(params.get("seed", -1)),
        steps=int(params.get("steps", 20)),
        cfg=float(params.get("cfg", 7.0)),
        sampler=str(params.get("sampler", "euler")),
        scheduler=str(params.get("scheduler", "normal")),
        denoise=i2i_denoise,
    )

    # 6. VAE 解码 (VAE 始终来自原始 Checkpoint，index=2)
    decoded = b.add_vae_decode(sampled, ckpt)

    # ── 放大链路 (Phase 2) ───────────────────────────────────────────────
    # AuraSR 4x → [ImageScale 缩到目标倍率] → 输出
    final_image = decoded
    upscale_enabled = bool(params.get("upscale_enabled", False))
    if upscale_enabled:
        upscale_factor = max(1.0, min(float(params.get("upscale_factor", 2)), 4.0))
        upscale_mode = str(params.get("upscale_mode", "4x_overlapped_checkboard"))
        if upscale_mode not in ("4x", "4x_overlapped_checkboard", "4x_overlapped_constant"):
            upscale_mode = "4x_overlapped_checkboard"
        upscale_tile = int(params.get("upscale_tile_batch_size", 8))
        downscale_method = str(params.get("upscale_downscale_method", "lanczos"))
        if downscale_method not in ("lanczos", "bicubic", "bilinear", "area", "nearest-exact"):
            downscale_method = "lanczos"
        # AuraSR 固定 4x
        aurasr = b.add_aurasr_upscale(
            decoded,
            model_name="model.safetensors",
            mode=upscale_mode,
            tile_batch_size=upscale_tile,
        )
        if upscale_factor < 4.0:
            # 非 4x: 先 4x 超采再缩回目标尺寸
            base_w = int(params.get("width", 1024))
            base_h = int(params.get("height", 1024))
            target_w = round(base_w * upscale_factor)
            target_h = round(base_h * upscale_factor)
            final_image = b.add_image_scale(aurasr, target_w, target_h, method=downscale_method)
        else:
            final_image = aurasr

    # ── 二次采样 (HiRes Refine) ─────────────────────────────────────
    # 将图像 VAE 编码回 latent → 独立参数二次采样 → VAE 解码
    hires_enabled = bool(params.get("hires_enabled", False))
    if hires_enabled:
        hires_denoise = max(0.1, min(float(params.get("hires_denoise", 0.4)), 0.8))
        hires_steps = max(5, min(int(params.get("hires_steps", 20)), 50))
        hires_cfg = max(1.0, min(float(params.get("hires_cfg", 7.0)), 20.0))
        hires_sampler = str(params.get("hires_sampler", "euler"))
        hires_scheduler = str(params.get("hires_scheduler", "normal"))
        hires_seed = int(params.get("hires_seed", -1))
        # VAE 编码: IMAGE → LATENT
        hires_latent = b.add_vae_encode(final_image, ckpt)
        # 第二次 KSampler (使用基础正/负提示词，不带 ControlNet)
        hires_sampled = b.add_ksampler(
            model_ref,
            positive,  # 基础正向提示词 (非 ControlNet 修改后的)
            negative,  # 基础负向提示词
            hires_latent,
            seed=hires_seed,
            steps=hires_steps,
            cfg=hires_cfg,
            sampler=hires_sampler,
            scheduler=hires_scheduler,
            denoise=hires_denoise,
        )
        final_image = b.add_vae_decode(hires_sampled, ckpt)

    # 7. 保存图片 (WAS Image Save)
    save_prefix_raw = str(params.get("save_prefix", "ComfyCarry")).strip() or "ComfyCarry"
    output_format = str(params.get("output_format", "png")).lower()
    if output_format not in ("png", "jpg", "jpeg", "webp", "tiff", "bmp", "gif"):
        output_format = "png"

    # 分离输出路径与文件名前缀: "2025-01-15/ComfyCarry_133607" → path="2025-01-15", prefix="ComfyCarry_133607"
    if '/' in save_prefix_raw:
        save_output_path, save_filename = save_prefix_raw.rsplit('/', 1)
    else:
        save_output_path, save_filename = '', save_prefix_raw

    b.add_save_image(final_image, prefix=save_filename, output_path=save_output_path,
                     extension=output_format, batch_size=batch_size)

    # 8. PreviewImage — 加入工作流以触发 ComfyUI WS 预览帧广播
    #    (每执行步通过 WS 二进制帧推送 JPEG 预览给所有连接的客户端)
    b.add_preview_image(final_image)

    return b.build()


def build_preprocess_workflow(params: dict) -> dict:
    """
    构建 ControlNet 预处理工作流。
    LoadImage → Preprocessor → WAS Image Save (→ input/)

    参数:
        image       (str) — ComfyUI input/ 中的源图片文件名
        type        (str) — 预处理类型: "pose" | "canny" | "depth"
        save_prefix (str) — 输出文件名前缀 (不含路径)
        input_dir   (str) — ComfyUI input/ 的绝对路径
        resolution  (int) — 预处理分辨率 (默认 1024)
        --- Pose 专用 ---
        detect_body (bool) — 检测身体 (默认 True)
        detect_hand (bool) — 检测手指 (默认 True)
        detect_face (bool) — 检测面部 (默认 True)
        --- Canny 专用 ---
        low_threshold  (int) — 低阈值 (默认 100)
        high_threshold (int) — 高阈值 (默认 200)
    """
    image = params.get("image", "")
    pp_type = params.get("type", "")
    save_prefix = params.get("save_prefix", "preprocess")
    input_dir = params.get("input_dir", "")
    resolution = int(params.get("resolution", 1024))

    b = WorkflowBuilder()

    # 1. 加载源图片
    load_img = b.add_load_image(image)

    # 2. 预处理器 (按类型分配)
    if pp_type == "pose":
        detect_body = params.get("detect_body", True)
        detect_hand = params.get("detect_hand", True)
        detect_face = params.get("detect_face", True)
        processed = b.add_dw_preprocessor(
            load_img, resolution=resolution,
            detect_body=detect_body, detect_hand=detect_hand, detect_face=detect_face,
        )
    elif pp_type == "canny":
        low = int(params.get("low_threshold", 100))
        high = int(params.get("high_threshold", 200))
        processed = b.add_canny_preprocessor(
            load_img, resolution=resolution, low_threshold=low, high_threshold=high,
        )
    elif pp_type == "depth":
        processed = b.add_depth_preprocessor(load_img, resolution=resolution)
    else:
        raise ValueError(f"不支持的预处理类型: {pp_type}")

    # 3. 保存到 input/ 目录 (使用绝对路径)
    b.add_save_image(processed, prefix=save_prefix,
                     output_path=input_dir, extension='png')

    # 4. PreviewImage — 广播预览帧
    b.add_preview_image(processed)

    return b.build()


def build_tag_workflow(params: dict) -> dict:
    """
    构建 WD14 反推工作流: LoadImage → WD14Tagger。

    参数:
        image               (str)  — ComfyUI input/ 中的图片文件名
        model               (str)  — WD14 模型名 (默认 wd-eva02-large-tagger-v3)
        threshold           (float) — 通用阈值 (默认 0.35)
        character_threshold (float) — 角色阈值 (默认 0.85)
        exclude_tags        (str)  — 排除标签 (逗号分隔)
        replace_underscore  (bool) — 替换下划线 (默认 True)
    """
    image = params.get("image", "")
    model = params.get("model", "wd-eva02-large-tagger-v3")
    threshold = float(params.get("threshold", 0.35))
    char_threshold = float(params.get("character_threshold", 0.85))
    exclude_tags = params.get("exclude_tags", "")
    replace_underscore = bool(params.get("replace_underscore", True))

    return {
        "1": {
            "class_type": "LoadImage",
            "inputs": {"image": image},
        },
        "2": {
            "class_type": "WD14Tagger|pysssss",
            "inputs": {
                "image": ["1", 0],
                "model": model,
                "threshold": threshold,
                "character_threshold": char_threshold,
                "exclude_tags": exclude_tags,
                "replace_underscore": replace_underscore,
                "trailing_comma": False,
            },
        },
    }


# Phase 2+ 扩展占位符:
# def build_flux_workflow(params): ...
# def build_zimage_workflow(params): ...
