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

    @staticmethod
    def _ref(ref, default_idx: int = 0) -> list:
        """
        归一化节点引用 (str | tuple | list) → [node_id, output_index]。

        - str:        旧 SDXL 调用风格，按 default_idx 解释。例如:
                        CLIP 默认 1 (CheckpointLoaderSimple),
                        VAE 默认 2 (CheckpointLoaderSimple),
                        MODEL 默认 0.
        - tuple/list: 显式 (node_id, output_index)，用于独立 loader (UNETLoader, CLIPLoader, VAELoader)。
        """
        if isinstance(ref, (tuple, list)):
            return [ref[0], int(ref[1])]
        return [ref, default_idx]

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

    # ── 分离式加载器 (Anima / Flux / SD3 / HiDream / WAN 等) ─────────────────

    def add_unet_loader(self, unet_name: str, weight_dtype: str = "default") -> str:
        """
        独立 UNET 加载 — 分离式模型主权重 (放在 ComfyUI/models/diffusion_models/)。
        weight_dtype: default | fp8_e4m3fn | fp8_e4m3fn_fast | fp8_e5m2
        输出: [node_id, 0]=MODEL
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": unet_name,
                "weight_dtype": weight_dtype,
            },
        }
        return nid

    def add_clip_loader_single(
        self, clip_name: str, type: str = "stable_diffusion", device: str = "default"
    ) -> str:
        """
        单文件 CLIP/Text-Encoder 加载 — 用于 Anima / Lumina / Pixart 等单文本编码器架构。
        type: stable_diffusion | qwen_image | lumina2 | pixart | wan | hidream | chroma | ace | ...
        Anima 实测使用 type=stable_diffusion + qwen_3_06b_base.safetensors。
        输出: [node_id, 0]=CLIP
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": clip_name,
                "type": type,
                "device": device,
            },
        }
        return nid

    def add_dual_clip_loader(
        self, clip_name1: str, clip_name2: str, type: str = "flux", device: str = "default"
    ) -> str:
        """
        双文件 CLIP 加载 — Flux / SD3 等需要两个文本编码器。
        type: flux | sdxl | sd3 | hunyuan_video | hidream
        输出: [node_id, 0]=CLIP
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": clip_name1,
                "clip_name2": clip_name2,
                "type": type,
                "device": device,
            },
        }
        return nid

    def add_vae_loader(self, vae_name: str) -> str:
        """
        独立 VAE 加载 — 分离式模型 VAE (放在 ComfyUI/models/vae/)。
        输出: [node_id, 0]=VAE
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": vae_name,
            },
        }
        return nid

    def add_clip_set_last_layer(self, clip_ref, stop_at_clip_layer: int) -> str:
        """
        CLIPSetLastLayer — 截断 CLIP 编码到倒数第 N 层 (clip skip)。
        clip_ref: 上游 CLIP 输出引用 (CheckpointLoaderSimple 默认 index=1, 或 LoraLoader/CLIPLoader 等)。
        stop_at_clip_layer: 负数 = 倒数第 N 层 (如 -2 = clip skip 2)。
        输出: [node_id, 0]=CLIP (接替上游 CLIP 链, 供后续 LoRA / CLIPTextEncode 消费)
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CLIPSetLastLayer",
            "inputs": {
                "stop_at_clip_layer": int(stop_at_clip_layer),
                "clip": self._ref(clip_ref, default_idx=1),
            },
        }
        return nid

    # ── 文本/Latent 通用节点 ────────────────────────────────────────────────

    def add_clip_text_encode(self, text: str, clip_ref) -> str:
        """
        CLIP 文本编码 (正向/负向提示词)。
        clip_ref: 提供 CLIP 的节点引用 —
          - str (向后兼容): CheckpointLoaderSimple / LoraLoader / DualCLIPLoader 等 → 默认 index=1
            (CheckpointLoaderSimple 的 CLIP 输出在 1; LoraLoader 也在 1)
          - tuple (node_id, output_index): 独立 CLIPLoader → (node_id, 0)
        输出: [node_id, 0]=CONDITIONING
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": text,
                "clip": self._ref(clip_ref, default_idx=1),
            },
        }
        return nid

    def add_empty_latent(
        self, width: int, height: int, batch_size: int = 1,
        class_type: str = "EmptyLatentImage",
    ) -> str:
        """
        空 Latent Image。
        class_type: 节点类型, 默认 "EmptyLatentImage" (anima/krea2);
                    zimage/flux1 等用 "EmptySD3LatentImage" (16 通道);
                    flux2 用 "EmptyFlux2LatentImage"。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": class_type,
            "inputs": {"width": width, "height": height, "batch_size": batch_size},
        }
        return nid

    def add_model_sampling_auraflow(self, model_ref, shift: float = 3.0) -> str:
        """
        ModelSamplingAuraFlow — 调整模型采样的 shift 参数 (AuraFlow/Z-Image 族)。
        Z-Image 官方 Turbo/Base 模板均接在 MODEL 链路上 (shift=3.0)。
        model_ref: 上游 MODEL 引用 (UNETLoader / LoraLoader 输出 index 0)。
        输出: [node_id, 0]=MODEL (接替上游 MODEL 链)
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {
                "shift": float(shift),
                "model": self._ref(model_ref, default_idx=0),
            },
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
        self._nodes[nid] = {
            "class_type": "KSampler",
            "inputs": {
                "seed": actual_seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": denoise,
                "model": self._ref(model_node_id, default_idx=0),
                "positive": self._ref(positive_ref, default_idx=0),
                "negative": self._ref(negative_ref, default_idx=0),
                "latent_image": self._ref(latent_node_id, default_idx=0),
            },
        }
        return nid

    # ── Flux2 采样链节点 (SamplerCustomAdvanced 体系) ───────────────────────

    def add_random_noise(self, seed: int) -> str:
        """
        RandomNoise — Flux2 采样链噪声源 (取代 KSampler 内置噪声生成)。
        seed=-1 → 运行时随机生成。
        输出: [node_id, 0]=NOISE
        """
        nid = self._next_id()
        actual_seed = seed if seed >= 0 else random.randint(0, 2**32 - 1)
        self._nodes[nid] = {
            "class_type": "RandomNoise",
            "inputs": {"noise_seed": actual_seed},
        }
        return nid

    def add_ksampler_select(self, sampler_name: str = "euler") -> str:
        """
        KSamplerSelect — 选择采样器 (Flux2 采样链, 与 KSampler 分离)。
        输出: [node_id, 0]=SAMPLER
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": sampler_name},
        }
        return nid

    def add_flux2_scheduler(self, steps: int, width: int, height: int) -> str:
        """
        Flux2Scheduler — Flux2 分辨率相关 sigma 生成器。
        输出: [node_id, 0]=SIGMAS
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "Flux2Scheduler",
            "inputs": {
                "steps": int(steps),
                "width": int(width),
                "height": int(height),
            },
        }
        return nid

    def add_flux_guidance(self, conditioning_ref, guidance: float = 4.0) -> str:
        """
        FluxGuidance — Flux2 dev 模式 guidance 调整 (插入到正向 conditioning 链)。
        输出: [node_id, 0]=CONDITIONING
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "FluxGuidance",
            "inputs": {
                "guidance": float(guidance),
                "conditioning": self._ref(conditioning_ref, default_idx=0),
            },
        }
        return nid

    def add_basic_guider(self, model_ref, conditioning_ref) -> str:
        """
        BasicGuider — Flux2 dev 模式 guider (无负面, 单 conditioning)。
        输出: [node_id, 0]=GUIDER
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "BasicGuider",
            "inputs": {
                "model": self._ref(model_ref, default_idx=0),
                "conditioning": self._ref(conditioning_ref, default_idx=0),
            },
        }
        return nid

    def add_cfg_guider(self, model_ref, positive_ref, negative_ref, cfg: float) -> str:
        """
        CFGGuider — Flux2 klein 模式 guider (有负面, 真 CFG)。
        输出: [node_id, 0]=GUIDER
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CFGGuider",
            "inputs": {
                "model": self._ref(model_ref, default_idx=0),
                "positive": self._ref(positive_ref, default_idx=0),
                "negative": self._ref(negative_ref, default_idx=0),
                "cfg": float(cfg),
            },
        }
        return nid

    def add_sampler_custom_advanced(
        self, noise_ref, guider_ref, sampler_ref, sigmas_ref, latent_ref,
    ) -> str:
        """
        SamplerCustomAdvanced — Flux2 采样器 (取代 KSampler, 分离式噪声/guider/sampler/sigmas)。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": self._ref(noise_ref, default_idx=0),
                "guider": self._ref(guider_ref, default_idx=0),
                "sampler": self._ref(sampler_ref, default_idx=0),
                "sigmas": self._ref(sigmas_ref, default_idx=0),
                "latent_image": self._ref(latent_ref, default_idx=0),
            },
        }
        return nid

    def add_vae_decode(self, samples_node_id: str, vae_ref) -> str:
        """
        VAE 解码 Latent → Image。
        vae_ref:
          - str (向后兼容): CheckpointLoader → 默认 index=2
          - tuple (node_id, output_index): 独立 VAELoader → (node_id, 0)
        输出: [node_id, 0]=IMAGE
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": [samples_node_id, 0],
                "vae": self._ref(vae_ref, default_idx=2),
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
        model_ref,
        clip_ref,
        lora_name: str,
        strength_model: float = 1.0,
        strength_clip: float | None = None,
    ) -> str:
        """
        LoRA 加载器 — 插入到 model/clip 链路中。
        强度可独立控制 model/clip，默认相同。
        model_ref / clip_ref 接受 str (旧调用) 或 (node_id, output_index) 元组。
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
                "model": self._ref(model_ref, default_idx=0),
                "clip": self._ref(clip_ref, default_idx=1),
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
        vae_ref=None,
    ) -> str:
        """
        应用 ControlNet (ControlNetApplyAdvanced)。
        链式拼接: 多个 ControlNet 顺序应用时，后一个的 pos/neg 接前一个的输出。
        positive_ref / negative_ref: (node_id, output_index) 元组
        vae_ref: 可选 VAE 引用 — Flux 系 ControlNet 为 latent 空间条件, 必须接 optional vae;
                 非 None 时 inputs 增加 "vae" key。None 时不含 vae (sdxl 既有行为不变)。
        输出: [node_id, 0]=positive CONDITIONING, [node_id, 1]=negative CONDITIONING
        """
        nid = self._next_id()
        inputs = {
            "positive": list(positive_ref),
            "negative": list(negative_ref),
            "control_net": [control_net_node_id, 0],
            "image": [image_node_id, 0],
            "strength": max(0.0, min(float(strength), 2.0)),
            "start_percent": max(0.0, min(float(start_percent), 1.0)),
            "end_percent": max(0.0, min(float(end_percent), 1.0)),
        }
        if vae_ref is not None:
            inputs["vae"] = self._ref(vae_ref)
        self._nodes[nid] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": inputs,
        }
        return nid

    # ── Inpaint ──────────────────────────────────────────────────────────────

    def add_load_image_mask(self, filename: str, channel: str = "red") -> str:
        """
        LoadImageMask: 从 input/ 目录加载 mask 图片。
        channel: 使用哪个通道作为 mask — "alpha", "red", "green", "blue"
        输出: [node_id, 0]=MASK
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LoadImageMask",
            "inputs": {
                "image": filename,
                "channel": channel,
            },
        }
        return nid

    def add_vae_encode_for_inpaint(
        self,
        image_node_id: str,
        vae_ref,
        mask_node_id: str,
        grow_mask_by: int = 6,
    ) -> str:
        """
        VAEEncodeForInpaint: IMAGE + MASK + VAE → LATENT (with noise mask).
        image_node_id: LoadImage 节点 (output[0]=IMAGE)
        vae_ref: str (CheckpointLoader默认index 2) 或 (node_id, output_index) 元组
        mask_node_id: LoadImageMask 节点 (output[0]=MASK)
        grow_mask_by: 遮罩扩展像素 (0-64，默认 6)
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEEncodeForInpaint",
            "inputs": {
                "pixels": [image_node_id, 0],
                "vae": self._ref(vae_ref, default_idx=2),
                "mask": [mask_node_id, 0],
                "grow_mask_by": grow_mask_by,
            },
        }
        return nid

    def add_vae_encode(self, image_node_id: str, vae_ref) -> str:
        """
        VAE 编码 Image → Latent。
        用于二次采样: 将放大后的图像编码回 latent 空间以供第二次 KSampler 使用。
        vae_ref: str (CheckpointLoader 默认 index=2) 或 (node_id, output_index) 元组。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEEncode",
            "inputs": {
                "pixels": [image_node_id, 0],
                "vae": self._ref(vae_ref, default_idx=2),
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

    # ── SeedVR2 放大引擎 (numz/ComfyUI-SeedVR2_VideoUpscaler) ────────────────

    def add_seedvr2_dit_loader(self, model: str) -> str:
        """
        SeedVR2LoadDiTModel — 加载 SeedVR2 DiT 权重 (models/SEEDVR2/)。
        输出: [node_id, 0]=dit
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SeedVR2LoadDiTModel",
            "inputs": {
                "model": model,
                "device": "cuda:0",
            },
        }
        return nid

    def add_seedvr2_vae_loader(
        self,
        encode_tiled: bool = False,
        decode_tiled: bool = False,
    ) -> str:
        """
        SeedVR2LoadVAEModel — 加载 SeedVR2 专用 VAE。
        encode_tiled/decode_tiled: 分块编解码，4x 大图必开否则 24GB 卡 OOM。
        输出: [node_id, 0]=vae
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SeedVR2LoadVAEModel",
            "inputs": {
                "model": "ema_vae_fp16.safetensors",
                "device": "cuda:0",
                "encode_tiled": bool(encode_tiled),
                "decode_tiled": bool(decode_tiled),
            },
        }
        return nid

    def add_seedvr2_upscale(
        self,
        image_node_id: str,
        dit_node_id: str,
        vae_node_id: str,
        seed: int = -1,
        resolution: int = 2048,
        color_correction: str = "lab",
        input_noise_scale: float = 0.0,
        latent_noise_scale: float = 0.0,
    ) -> str:
        """
        SeedVR2VideoUpscaler — 一步扩散修复放大 (无文本条件)。
        resolution: 目标短边像素 (任意倍率)。
        输出: [node_id, 0]=IMAGE
        """
        actual_seed = seed if seed >= 0 else random.randint(0, 2**32 - 1)
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SeedVR2VideoUpscaler",
            "inputs": {
                "image": [image_node_id, 0],
                "dit": [dit_node_id, 0],
                "vae": [vae_node_id, 0],
                "seed": actual_seed,
                "resolution": int(resolution),
                "max_resolution": 0,
                "batch_size": 1,
                "uniform_batch_size": False,
                "color_correction": color_correction,
                "input_noise_scale": float(input_noise_scale),
                "latent_noise_scale": float(latent_noise_scale),
            },
        }
        return nid

    # ── 构建 ─────────────────────────────────────────────────────────────────

    def build(self) -> dict:
        """返回最终的 ComfyUI /prompt API 格式 prompt dict。"""
        return dict(self._nodes)


# ── 顶层工作流函数 ────────────────────────────────────────────────────────────

# SeedVR2 DiT 权重白名单 (models/SEEDVR2/, GGUF 变体首版不暴露)
SEEDVR2_DIT_MODELS = (
    "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
    "seedvr2_ema_3b_fp16.safetensors",
    "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
    "seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors",
)
SEEDVR2_COLOR_CORRECTIONS = ("lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none")


def _add_upscale_chain(b: WorkflowBuilder, decoded: str, params: dict) -> str:
    """
    放大链路 (SDXL / Anima 共用)，按 upscale_engine 分流:
      aurasr (默认) — AuraSR 固定 4x → [ImageScale 缩到目标倍率]
      seedvr2       — DiT + VAE 加载器 + 一步扩散放大，倍率换算为短边目标像素
    返回最终 IMAGE 节点 id。
    """
    upscale_factor = max(1.0, min(float(params.get("upscale_factor", 2)), 4.0))
    engine = str(params.get("upscale_engine", "aurasr"))

    if engine == "seedvr2":
        svr_model = str(params.get("upscale_svr_model", SEEDVR2_DIT_MODELS[0]))
        if svr_model not in SEEDVR2_DIT_MODELS:
            svr_model = SEEDVR2_DIT_MODELS[0]
        color_correction = str(params.get("upscale_svr_color_correction", "lab"))
        if color_correction not in SEEDVR2_COLOR_CORRECTIONS:
            color_correction = "lab"
        input_noise = max(0.0, min(float(params.get("upscale_svr_input_noise", 0.0)), 1.0))
        latent_noise = max(0.0, min(float(params.get("upscale_svr_latent_noise", 0.0)), 1.0))
        tiled_vae = bool(params.get("upscale_svr_tiled_vae", False))
        base_w = int(params.get("width", 1024))
        base_h = int(params.get("height", 1024))
        # 共用倍率滑条 → 短边目标像素 (取偶数)
        resolution = round(min(base_w, base_h) * upscale_factor / 2) * 2
        dit = b.add_seedvr2_dit_loader(svr_model)
        vae = b.add_seedvr2_vae_loader(encode_tiled=tiled_vae, decode_tiled=tiled_vae)
        return b.add_seedvr2_upscale(
            decoded,
            dit,
            vae,
            seed=int(params.get("seed", -1)),
            resolution=resolution,
            color_correction=color_correction,
            input_noise_scale=input_noise,
            latent_noise_scale=latent_noise,
        )

    upscale_mode = str(params.get("upscale_mode", "4x_overlapped_checkboard"))
    if upscale_mode not in ("4x", "4x_overlapped_checkboard", "4x_overlapped_constant"):
        upscale_mode = "4x_overlapped_checkboard"
    # 兼容两组 key: 前端历史上发 upscale_tile / upscale_downscale
    upscale_tile = int(params.get("upscale_tile_batch_size", params.get("upscale_tile", 8)))
    downscale_method = str(
        params.get("upscale_downscale_method", params.get("upscale_downscale", "lanczos"))
    )
    if downscale_method not in ("lanczos", "bicubic", "bilinear", "area", "nearest-exact"):
        downscale_method = "lanczos"
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
        return b.add_image_scale(aurasr, target_w, target_h, method=downscale_method)
    return aurasr


def build_sdxl_workflow(params: dict) -> dict:
    """
    构建 SDXL 基础工作流 (T2I + 可选多 LoRA 堆叠)。

    params 字段:
        checkpoint      (str, 必填) — 模型文件名
        clip_skip       (int)       — Clip Skip 1~4 (默认 1; >1 时插入 CLIPSetLastLayer,
                                      stop_at_clip_layer = -clip_skip; Pony/IL/NoobAI = 2)
        vae             (str)       — VAE 覆盖文件名 (空串 = 跟随 Checkpoint; 非空 → VAELoader,
                                      工作流中所有 VAE 引用统一改用它, 含 i2i/inpaint/hires/upscale 分支)
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
        upscale_engine  (str)       — 放大引擎: aurasr (默认) / seedvr2
        upscale_factor  (float)     — 放大倍率 1.5-4，默认 2 (两引擎共用)
        upscale_mode    (str)       — [aurasr] 放大模式: 4x / 4x_overlapped_checkboard / 4x_overlapped_constant
        upscale_tile_batch_size (int) — [aurasr] 分块大小 1-32，默认 8 (兼容旧 key upscale_tile)
        upscale_downscale_method (str) — [aurasr] 缩放算法: lanczos / bicubic / bilinear / area / nearest-exact
                                      (兼容旧 key upscale_downscale)
        upscale_svr_model (str)     — [seedvr2] DiT 权重文件名，白名单见 SEEDVR2_DIT_MODELS
        upscale_svr_color_correction (str) — [seedvr2] 色彩校正: lab(默认)/wavelet/wavelet_adaptive/hsv/adain/none
        upscale_svr_input_noise (float)  — [seedvr2] 输入噪声 0-1，默认 0
        upscale_svr_latent_noise (float) — [seedvr2] 潜空间噪声 0-1，默认 0
        upscale_svr_tiled_vae (bool) — [seedvr2] VAE 分块编解码，4x 大图防 OOM，默认 false
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
        inpaint_image   (str)       — 局部重绘: 参考图文件名 (与 i2i_image 互斥)
        inpaint_mask    (str)       — 局部重绘: mask 图片文件名 (黑白 PNG，白色=重绘区域)
        inpaint_denoise (float)     — 局部重绘去噪强度 (0.10-1.00)，默认 0.75
        inpaint_grow_mask_by (int)  — 遮罩扩展像素 (0-64)，默认 6
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

    # 1.5 Clip Skip (B4): clip_skip>1 → 在 checkpoint loader 之后插入 CLIPSetLastLayer,
    #     LoRA 链与文本编码消费其输出 (stop_at_clip_layer = -clip_skip)。
    clip_skip = int(params.get("clip_skip", 1) or 1)
    if clip_skip > 1:
        clip_skip_node = b.add_clip_set_last_layer(clip_ref, -clip_skip)
        # CLIPSetLastLayer 输出 CLIP 在 index=0 (区别于 CheckpointLoaderSimple 的 index=1)
        clip_ref = (clip_skip_node, 0)

    # 1.6 VAE 覆盖 (B4): vae 非空 → VAELoader 节点, 工作流中所有 VAE 引用统一改用它。
    #     vae_ref 为单一变量, 后续 t2i decode / i2i·inpaint encode+decode / hires / upscale
    #     全部引用它, 避免漏改某分支。无覆盖时 vae_ref = ckpt (走 CheckpointLoader index=2)。
    vae_override = str(params.get("vae", "") or "").strip()
    if vae_override:
        vae_loader_node = b.add_vae_loader(vae_override)
        # VAELoader 输出 VAE 在 index=0 (区别于 CheckpointLoaderSimple 的 index=2)
        vae_ref = (vae_loader_node, 0)
    else:
        vae_ref = ckpt

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

    # 4. Latent 来源 (Inpaint: VAEEncodeForInpaint / I2I: VAEEncode / T2I: EmptyLatentImage)
    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    inpaint_image = str(params.get("inpaint_image", "")).strip()
    inpaint_mask = str(params.get("inpaint_mask", "")).strip()
    i2i_image = str(params.get("i2i_image", "")).strip()
    i2i_denoise = 1.0  # T2I 默认全去噪

    if inpaint_image and inpaint_mask:
        # 局部重绘: 加载参考图 + mask → VAEEncodeForInpaint (VAE 引用 vae_ref)
        inp_load = b.add_load_image(inpaint_image)
        mask_load = b.add_load_image_mask(inpaint_mask, channel="red")
        grow = max(0, min(int(params.get("inpaint_grow_mask_by", 6)), 64))
        latent = b.add_vae_encode_for_inpaint(inp_load, vae_ref, mask_load, grow)
        i2i_denoise = max(0.10, min(float(params.get("inpaint_denoise", 0.75)), 1.0))
    elif i2i_image:
        # 图生图: 加载参考图 → VAE 编码为 latent (VAE 引用 vae_ref)
        i2i_load = b.add_load_image(i2i_image)
        latent = b.add_vae_encode(i2i_load, vae_ref)
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

    # 6. VAE 解码 (VAE 引用 vae_ref: 覆盖时 = VAELoader, 否则 = Checkpoint index=2)
    decoded = b.add_vae_decode(sampled, vae_ref)

    # ── 放大链路 (Phase 2, 引擎分流见 _add_upscale_chain) ────────────────
    final_image = decoded
    if bool(params.get("upscale_enabled", False)):
        final_image = _add_upscale_chain(b, decoded, params)

    # ── 二次采样 (HiRes Refine) ─────────────────────────────────────
    # 将图像 VAE 编码回 latent → 独立参数二次采样 → VAE 解码 (VAE 引用 vae_ref)
    hires_enabled = bool(params.get("hires_enabled", False))
    if hires_enabled:
        hires_denoise = max(0.1, min(float(params.get("hires_denoise", 0.4)), 0.8))
        hires_steps = max(5, min(int(params.get("hires_steps", 20)), 50))
        hires_cfg = max(1.0, min(float(params.get("hires_cfg", 7.0)), 20.0))
        hires_sampler = str(params.get("hires_sampler", "euler"))
        hires_scheduler = str(params.get("hires_scheduler", "normal"))
        hires_seed = int(params.get("hires_seed", -1))
        # VAE 编码: IMAGE → LATENT
        hires_latent = b.add_vae_encode(final_image, vae_ref)
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
        final_image = b.add_vae_decode(hires_sampled, vae_ref)

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


# 分离式三件套 (UNet + 单 CLIP + VAE) 架构的差异化参数。
# 新增同构架构 (未来 flux 单 TE 变体等) 在此加 profile + _BUILDERS 注册即可。
_SPLIT_ARCH_PROFILES = {
    # Anima (CircleStone Labs, 2B): 实测 er_sde/simple/30步/cfg4
    "anima": {"clip_type": "stable_diffusion", "steps": 30, "cfg": 4.0,
              "sampler": "er_sde", "scheduler": "simple"},
    # Krea 2 (12B SingleStreamDiT): 官方 Turbo 模板 image_krea2_turbo_t2i.json
    # 实测值 euler/simple/8步/cfg1.0 (cfg=1 等效禁用 CFG; Raw 用户自行调参)
    "krea2": {"clip_type": "krea2", "steps": 8, "cfg": 1.0,
              "sampler": "euler", "scheduler": "simple"},
    # Z-Image Turbo 官方模板 image_z_image_turbo.json 实测值
    # (Base 用户手动调 25/4.0; ModelSamplingAuraFlow 接在 MODEL 链路 shift=3.0;
    #  Lumina2 族 CLIPLoader type=lumina2; latent 用 EmptySD3LatentImage 16ch)
    "zimage": {"clip_type": "lumina2", "steps": 8, "cfg": 1.0,
               "sampler": "res_multistep", "scheduler": "simple",
               "latent_class": "EmptySD3LatentImage",
               "model_sampling": {"class": "auraflow", "shift": 3.0}},
    # Flux1 dev 官方模板 flux_dev_full_text_to_image.json 实测值
    # (双 CLIP: clip_l + t5xxl, DualCLIPLoader type=flux;
    #  EmptySD3LatentImage 16ch; 无 ModelSamplingAuraFlow)
    "flux1": {"dual_clip_type": "flux", "steps": 20, "cfg": 1.0,
              "sampler": "euler", "scheduler": "simple",
              "latent_class": "EmptySD3LatentImage",
              "controlnet": True},
    # Chroma (flux schnell 衍生, 单 T5 + 真 CFG + 负面)
    # CLIPLoader type=chroma; 不设 dual_clip_type → 单 CLIP 路径
    # 默认 26 步 / cfg 4.0 / euler / simple; EmptySD3LatentImage 16ch
    "chroma": {"clip_type": "chroma", "steps": 26, "cfg": 4.0,
               "sampler": "euler", "scheduler": "simple",
               "latent_class": "EmptySD3LatentImage"},
    # Flux2 (dev/klein) — 独立 builder (SamplerCustomAdvanced + Flux2Scheduler), 此 profile
    # 仅用于 _SPLIT_ARCH_PROFILES 注册 (arch 检测 + 加载层标识)。采样不经过 build_split_workflow。
    # latent=EmptyFlux2LatentImage (128ch, /16, step16); 单 CLIP (type=flux2)。
    "flux2": {"clip_type": "flux2", "steps": 20, "cfg": 4.0,
              "sampler": "euler", "scheduler": "simple",
              "latent_class": "EmptyFlux2LatentImage"},
}


def build_split_workflow(params: dict, arch: str) -> dict:
    """
    构建分离式架构 (UNet + CLIP + VAE) 工作流 — 参数按架构 profile 驱动。

    支持架构 (见 _SPLIT_ARCH_PROFILES):
      - anima:  CircleStone Labs 2B, CLIPLoader type=stable_diffusion, er_sde/simple/30步/cfg4
      - krea2:  Krea 2 12B SingleStreamDiT, CLIPLoader type=krea2, euler/simple/8步/cfg1.0
      - zimage: Z-Image (Tongyi/阿里, 6B 单流 DiT), CLIPLoader type=lumina2,
                res_multistep/simple/8步/cfg1.0, ModelSamplingAuraFlow(shift=3) 接 MODEL 链,
                latent=EmptySD3LatentImage
      - flux1:  Flux 1 dev, DualCLIPLoader type=flux (clip_l + t5xxl 双 TE),
                euler/simple/20步/cfg1.0, latent=EmptySD3LatentImage

    节点拓扑 (各架构同构, 按 profile 差异化加载):
      UNETLoader(unet_name, weight_dtype="default")
      CLIPLoader(clip_name, type=<profile.clip_type>)              # 单 TE 架构 (anima/krea2/zimage)
      DualCLIPLoader(clip_name1, clip_name2, type=<profile.dual_clip_type>)  # 双 TE 架构 (flux1)
      VAELoader(vae_name)
      [LoRA 链式插入 — 同时改写 model_ref / clip_ref]
      [ModelSamplingAuraFlow(shift) — 仅 profile 含 model_sampling 时 (zimage)]
      CLIPTextEncode ×2 (正/负)
      EmptyLatentImage / EmptySD3LatentImage (按 profile.latent_class)
        或 VAEEncodeForInpaint / VAEEncode 用于 I2I/Inpaint
      KSampler (默认值取自 profile)
      VAEDecode
      [可选放大链路]
      [可选二次采样 HiRes]
      Image Save + PreviewImage

    支持模块: LoRA / I2I / Inpaint / HiRes / Upscale (与 SDXL 相同)
    ControlNet: 按 profile["controlnet"] 开关 — flux1 已启用 (Union Pro 2.0, latent 空间 CN
                 需 vae_ref); 其余架构 (anima/krea2/zimage) profile 无开关, 传入 controlnets 被忽略。

    params 关键字段:
        unet              (str, 必填) — UNet 文件名 (models/diffusion_models/)
        clip              (str, 必填) — Text Encoder 文件名 (单 TE 架构) / clip_l (flux1)
        clip2             (str)       — 第二 Text Encoder 文件名 (仅 dual_clip_type 架构, 如 flux1 的 t5xxl)
        vae               (str, 必填) — VAE 文件名 (models/vae/)
        clip_type         (str)       — CLIPLoader type, 默认取 profile["clip_type"]
        unet_weight_dtype (str)       — UNet 权重精度, 默认 "default"
        shift             (float)      — ModelSamplingAuraFlow shift, 默认取 profile.model_sampling.shift
        其余字段同 build_sdxl_workflow (positive_prompt / loras / hires / i2i / upscale / inpaint 等)
    """
    profile = _SPLIT_ARCH_PROFILES.get(arch, _SPLIT_ARCH_PROFILES["anima"])
    b = WorkflowBuilder()

    # §5.1 加载分支: packaging='checkpoint' → CheckpointLoaderSimple (整合包, model/clip/vae 同节点);
    #                  packaging='split' (默认) → UNETLoader + CLIPLoader + VAELoader (三件套)
    # CheckpointLoaderSimple 输出 MODEL@0 / CLIP@1 / VAE@2, 恰好落在 _ref 默认索引 →
    # 下游 LoRA/编码/CN/采样/latent/decode 全部不变, 一次做完全架构吃到整合包形态。
    packaging = params.get("packaging", "split")
    if packaging == "checkpoint":
        ckpt = b.add_checkpoint_loader(params["checkpoint"])
        model_ref = ckpt
        clip_ref = ckpt
        vae_ref = ckpt
    else:
        unet_node = b.add_unet_loader(
            params["unet"],
            weight_dtype=str(params.get("unet_weight_dtype", "default")),
        )
        if "dual_clip_type" in profile:
            # flux1: 双 CLIP (clip_l + t5xxl) → DualCLIPLoader(type=flux)
            clip_node = b.add_dual_clip_loader(
                params["clip"],
                params["clip2"],
                type=str(params.get("clip_type", profile["dual_clip_type"])),
            )
        else:
            clip_node = b.add_clip_loader_single(
                params["clip"],
                type=str(params.get("clip_type", profile["clip_type"])),
            )
        vae_node = b.add_vae_loader(params["vae"])

        model_ref = (unet_node, 0)
        clip_ref = (clip_node, 0)
        vae_ref = (vae_node, 0)

    # 2. 链式插入多个 LoRA (节点输出形状与 SDXL 一致: [0]=MODEL, [1]=CLIP)
    loras = params.get("loras") or []
    for lora_entry in loras:
        lora_name = str(lora_entry.get("name", "")).strip()
        if not lora_name:
            continue
        strength = float(lora_entry.get("strength", 1.0))
        lora_node = b.add_lora_loader(model_ref, clip_ref, lora_name, strength_model=strength)
        model_ref = (lora_node, 0)
        clip_ref = (lora_node, 1)

    # 2.5 ModelSamplingAuraFlow — Z-Image 等架构接在 LoRA 链之后 (接替 MODEL 链)
    if "model_sampling" in profile:
        ms_cfg = profile["model_sampling"]
        shift = float(params.get("shift", ms_cfg.get("shift", 3.0)))
        ms_node = b.add_model_sampling_auraflow(model_ref, shift=shift)
        model_ref = (ms_node, 0)

    # 3. 编码提示词
    positive = b.add_clip_text_encode(params.get("positive_prompt", ""), clip_ref)
    negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)
    pos_ref = (positive, 0)
    neg_ref = (negative, 0)

    # 3.5 ControlNet 链式应用 (在 pos/neg 与 KSampler 之间)
    #   按 profile 开关: 仅 profile["controlnet"]==True 时处理 (flux1 已启用, 其余跳过)。
    #   仿 build_sdxl_workflow 3.5 段: 每个 apply 接 pos/neg 输出, 链式更新引用。
    #   差异: flux 系 CN 是 latent 空间条件, ControlNetApplyAdvanced 必须接 optional vae
    #   (传 vae_ref; sdxl 走 build_sdxl_workflow 不经此函数, 既有行为不变)。
    if profile.get("controlnet"):
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
                vae_ref=vae_ref,
            )
            pos_ref = (cn_apply, 0)
            neg_ref = (cn_apply, 1)

    # 4. Latent 来源 (Inpaint / I2I / T2I)
    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    inpaint_image = str(params.get("inpaint_image", "")).strip()
    inpaint_mask = str(params.get("inpaint_mask", "")).strip()
    i2i_image = str(params.get("i2i_image", "")).strip()
    i2i_denoise = 1.0

    if inpaint_image and inpaint_mask:
        inp_load = b.add_load_image(inpaint_image)
        mask_load = b.add_load_image_mask(inpaint_mask, channel="red")
        grow = max(0, min(int(params.get("inpaint_grow_mask_by", 6)), 64))
        latent = b.add_vae_encode_for_inpaint(inp_load, vae_ref, mask_load, grow)
        i2i_denoise = max(0.10, min(float(params.get("inpaint_denoise", 0.75)), 1.0))
    elif i2i_image:
        i2i_load = b.add_load_image(i2i_image)
        latent = b.add_vae_encode(i2i_load, vae_ref)
        i2i_denoise = max(0.10, min(float(params.get("i2i_denoise", 0.7)), 0.90))
    else:
        latent = b.add_empty_latent(
            int(params.get("width", 1024)),
            int(params.get("height", 1024)),
            batch_size=batch_size,
            class_type=str(profile.get("latent_class", "EmptyLatentImage")),
        )

    # 5. 采样 (默认值取自 profile)
    sampled = b.add_ksampler(
        model_ref,
        pos_ref,
        neg_ref,
        latent,
        seed=int(params.get("seed", -1)),
        steps=int(params.get("steps", profile["steps"])),
        cfg=float(params.get("cfg", profile["cfg"])),
        sampler=str(params.get("sampler", profile["sampler"])),
        scheduler=str(params.get("scheduler", profile["scheduler"])),
        denoise=i2i_denoise,
    )

    # 6. VAE 解码 (独立 VAELoader, index=0)
    decoded = b.add_vae_decode(sampled, vae_ref)

    # ── 放大链路 (与架构无关, 引擎分流见 _add_upscale_chain) ──────────
    final_image = decoded
    if bool(params.get("upscale_enabled", False)):
        final_image = _add_upscale_chain(b, decoded, params)

    # ── 二次采样 (HiRes Refine) ────────────────────────────────────────
    # 缺省值同步取 profile (hires_cfg 下限 clamp 保持 1.0)
    hires_enabled = bool(params.get("hires_enabled", False))
    if hires_enabled:
        hires_denoise = max(0.1, min(float(params.get("hires_denoise", 0.4)), 0.8))
        hires_steps = max(5, min(int(params.get("hires_steps", profile["steps"])), 50))
        hires_cfg = max(1.0, min(float(params.get("hires_cfg", profile["cfg"])), 20.0))
        hires_sampler = str(params.get("hires_sampler", profile["sampler"]))
        hires_scheduler = str(params.get("hires_scheduler", profile["scheduler"]))
        hires_seed = int(params.get("hires_seed", -1))
        hires_latent = b.add_vae_encode(final_image, vae_ref)
        hires_sampled = b.add_ksampler(
            model_ref,
            positive,  # 复用基础正/负提示词
            negative,
            hires_latent,
            seed=hires_seed,
            steps=hires_steps,
            cfg=hires_cfg,
            sampler=hires_sampler,
            scheduler=hires_scheduler,
            denoise=hires_denoise,
        )
        final_image = b.add_vae_decode(hires_sampled, vae_ref)

    # 7. 保存图片
    save_prefix_raw = str(params.get("save_prefix", "ComfyCarry")).strip() or "ComfyCarry"
    output_format = str(params.get("output_format", "png")).lower()
    if output_format not in ("png", "jpg", "jpeg", "webp", "tiff", "bmp", "gif"):
        output_format = "png"

    if '/' in save_prefix_raw:
        save_output_path, save_filename = save_prefix_raw.rsplit('/', 1)
    else:
        save_output_path, save_filename = '', save_prefix_raw

    b.add_save_image(final_image, prefix=save_filename, output_path=save_output_path,
                     extension=output_format, batch_size=batch_size)

    # 8. PreviewImage
    b.add_preview_image(final_image)

    return b.build()


def build_anima_workflow(params: dict) -> dict:
    return build_split_workflow(params, "anima")


def build_krea2_workflow(params: dict) -> dict:
    return build_split_workflow(params, "krea2")


def build_zimage_workflow(params: dict) -> dict:
    """Z-Image (Tongyi/阿里, 6B 单流 DiT) — 委托 build_split_workflow("zimage")。"""
    return build_split_workflow(params, "zimage")


def build_flux1_workflow(params: dict) -> dict:
    """Flux 1 (dev/schnell/krea 等) — 委托 build_split_workflow("flux1") (双 CLIP)。"""
    return build_split_workflow(params, "flux1")


def build_chroma_workflow(params: dict) -> dict:
    """Chroma (flux schnell 衍生, 单 T5 + 真 CFG + 负面) — 委托 build_split_workflow("chroma")。"""
    return build_split_workflow(params, "chroma")


def build_flux2_workflow(params: dict) -> dict:
    """
    Flux2 (dev/klein) — 独立采样 builder (SamplerCustomAdvanced + Flux2Scheduler)。

    guider_mode 分支:
      - 'basic' (dev):  FluxGuidance(positive, guidance) → BasicGuider(model, positive)
                        (无负面, guidance 默认 4.0, 20 步)
      - 'cfg'   (klein): CFGGuider(model, positive, negative, cfg)
                        (有负面, cfg 5.0 base / 1.0 distilled)

    加载分支 (packaging):
      - 'split'      (默认): UNETLoader + CLIPLoader(type=flux2, 单) + VAELoader
      - 'checkpoint' (整合包): CheckpointLoaderSimple (输出 MODEL@0/CLIP@1/VAE@2)
                               Phase 1 主 agent 抽共享辅助函数后此分支可统一迁移

    节点拓扑:
      [load: unet+clip+vae | checkpoint]
      [LoRA 链式插入 — 同时改写 model_ref / clip_ref]
      CLIPTextEncode(正) [+CLIPTextEncode(负) if cfg]
      [guider_mode=basic] FluxGuidance → BasicGuider
      [guider_mode=cfg]   CFGGuider
      RandomNoise(seed) + KSamplerSelect(sampler) + EmptyFlux2LatentImage(w,h)
        + Flux2Scheduler(steps,w,h) → SamplerCustomAdvanced → VAEDecode
      [可选放大链路 (放大在解码后, 与架构无关)]
      Image Save + PreviewImage

    范围: 仅 t2i + LoRA + 放大。i2i/inpaint/hires 需 SplitSigmas 分段去噪 (未实装),
    前端 flux2 modules 已相应去除 → 不接这些分支 (避免全量重噪静默忽略参考图)。

    params 关键字段:
        packaging        (str)   — 'split' (默认) | 'checkpoint'
        checkpoint       (str)   — [packaging=checkpoint] 整合包文件名
        unet             (str)   — [packaging=split] UNet 文件名
        clip             (str)   — [packaging=split] Text Encoder 文件名 (Qwen3/Mistral)
        vae              (str)   — [packaging=split] VAE 文件名
        guider_mode      (str)   — 'basic' (dev) | 'cfg' (klein), 默认 'cfg'
        guidance         (float) — [basic] FluxGuidance 值, 默认 4.0 (兼容 cfg 字段)
        cfg              (float) — [cfg] CFGGuider 值, 默认 5.0 (base) / 1.0 (distilled)
        steps            (int)   — 采样步数 (默认 20; distilled klein 4)
        sampler          (str)   — 采样器 (默认 euler)
        width/height     (int)   — 须 /16 (现有分辨率预设已满足)
        其余字段: positive_prompt / negative_prompt / loras / upscale / save_prefix / output_format
    """
    b = WorkflowBuilder()

    packaging = params.get("packaging", "split")
    if packaging == "checkpoint":
        ckpt = b.add_checkpoint_loader(params["checkpoint"])
        model_ref = ckpt
        clip_ref = ckpt
        vae_ref = ckpt
    else:
        unet_node = b.add_unet_loader(
            params["unet"],
            weight_dtype=str(params.get("unet_weight_dtype", "default")),
        )
        clip_node = b.add_clip_loader_single(params["clip"], type="flux2")
        vae_node = b.add_vae_loader(params["vae"])
        model_ref = (unet_node, 0)
        clip_ref = (clip_node, 0)
        vae_ref = (vae_node, 0)

    loras = params.get("loras") or []
    for lora_entry in loras:
        lora_name = str(lora_entry.get("name", "")).strip()
        if not lora_name:
            continue
        strength = float(lora_entry.get("strength", 1.0))
        lora_node = b.add_lora_loader(model_ref, clip_ref, lora_name, strength_model=strength)
        model_ref = (lora_node, 0)
        clip_ref = (lora_node, 1)

    positive = b.add_clip_text_encode(params.get("positive_prompt", ""), clip_ref)
    pos_ref = (positive, 0)

    guider_mode = str(params.get("guider_mode", "cfg"))

    if guider_mode == "basic":
        guidance = float(params.get("guidance", params.get("cfg", 4.0)))
        guided_pos = b.add_flux_guidance(pos_ref, guidance=guidance)
        guider = b.add_basic_guider(model_ref, (guided_pos, 0))
    else:
        negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)
        neg_ref = (negative, 0)
        cfg = float(params.get("cfg", 5.0))
        guider = b.add_cfg_guider(model_ref, pos_ref, neg_ref, cfg)

    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    # flux2 仅 t2i: SamplerCustomAdvanced 用 Flux2Scheduler 全量 sigma (denoise=1)。
    # i2i/inpaint 需 SplitSigmas 分段去噪 (未实装) — 直接喂编码 latent 会被全量重噪 = 忽略参考图,
    # 故不接 i2i/inpaint 分支 (前端 flux2 modules 亦已去 i2i/hires)。
    latent = b.add_empty_latent(
        int(params.get("width", 1024)),
        int(params.get("height", 1024)),
        batch_size=batch_size,
        class_type="EmptyFlux2LatentImage",
    )

    seed = int(params.get("seed", -1))
    noise = b.add_random_noise(seed)
    sampler = b.add_ksampler_select(str(params.get("sampler", "euler")))
    steps = int(params.get("steps", 20))
    sigmas = b.add_flux2_scheduler(
        steps, int(params.get("width", 1024)), int(params.get("height", 1024)),
    )
    sampled = b.add_sampler_custom_advanced(noise, guider, sampler, sigmas, latent)

    decoded = b.add_vae_decode(sampled, vae_ref)

    final_image = decoded
    if bool(params.get("upscale_enabled", False)):
        final_image = _add_upscale_chain(b, decoded, params)

    # HiRes 二次采样对 flux2 需另一次 SamplerCustomAdvanced + SplitSigmas 分段去噪 (未实装);
    # 不能退回普通 KSampler (缺 Flux2Scheduler 的分辨率相关 sigma, 且 dev 无 CFG) → 略过。

    save_prefix_raw = str(params.get("save_prefix", "ComfyCarry")).strip() or "ComfyCarry"
    output_format = str(params.get("output_format", "png")).lower()
    if output_format not in ("png", "jpg", "jpeg", "webp", "tiff", "bmp", "gif"):
        output_format = "png"
    if '/' in save_prefix_raw:
        save_output_path, save_filename = save_prefix_raw.rsplit('/', 1)
    else:
        save_output_path, save_filename = '', save_prefix_raw
    b.add_save_image(final_image, prefix=save_filename, output_path=save_output_path,
                     extension=output_format, batch_size=batch_size)
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
# def build_flux2_workflow(params): ...  # 已实装于上方 (SamplerCustomAdvanced + Flux2Scheduler)
