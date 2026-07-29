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

    def add_vae_decode(self, samples_ref, vae_ref) -> str:
        """
        VAE 解码 Latent → Image。
        samples_ref: 采样器输出引用 — str (旧风格, 默认 index=0) 或 (node_id, output_index) 元组。
                     不可直接拼 [ref, 0]: tuple 传入会产生嵌套 list, ComfyUI 校验即抛
                     "unhashable type: 'list'" (Wan22 链路踩过)。
        vae_ref:
          - str (向后兼容): CheckpointLoader → 默认 index=2
          - tuple (node_id, output_index): 独立 VAELoader → (node_id, 0)
        输出: [node_id, 0]=IMAGE
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": self._ref(samples_ref, default_idx=0),
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

    # ── 视频节点 (Wan 2.2) ───────────────────────────────────────────────────

    def add_model_sampling_sd3(self, model_ref, shift: float = 5.0) -> str:
        """
        ModelSamplingSD3 — 调整模型采样的 shift 参数 (Wan/Hunyuan/SD3 族)。
        Wan 14B shift=5.0, 5B shift=8.0, Hunyuan 1.5 shift=7.0。
        model_ref: 上游 MODEL 引用 (UNETLoader / LoraLoaderModelOnly 输出 index 0)。
        输出: [node_id, 0]=MODEL (接替上游 MODEL 链)
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "ModelSamplingSD3",
            "inputs": {
                "shift": float(shift),
                "model": self._ref(model_ref, default_idx=0),
            },
        }
        return nid

    def add_ksampler_advanced(
        self,
        model_ref,
        positive_ref,
        negative_ref,
        latent_ref,
        add_noise: bool = True,
        steps: int = 20,
        cfg: float = 7.0,
        sampler: str = "euler",
        scheduler: str = "normal",
        start_at_step: int = 0,
        end_at_step: int = 20,
        return_with_leftover_noise: bool = False,
        seed: int = -1,
    ) -> str:
        """
        KSamplerAdvanced — 双段采样核心 (Wan 14B 高噪/低噪分链)。
        与 KSampler 的差异: 显式控制 add_noise / start_at_step / end_at_step /
        return_with_leftover_noise, 用于两段串接采样。
        add_noise=True 时注入新噪声 (高噪段), False 时复用上段残留噪声 (低噪段)。
        return_with_leftover_noise=True 时保留噪声给下段 (高噪段), False 时丢弃 (末段)。
        seed=-1 → 运行时随机生成。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        actual_seed = seed if seed >= 0 else random.randint(0, 2**32 - 1)
        self._nodes[nid] = {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                # 注意输入名是 noise_seed 而非 seed (KSampler 才叫 seed), 与 ComfyUI object_info 对齐
                "noise_seed": actual_seed,
                "steps": int(steps),
                "cfg": float(cfg),
                "sampler_name": sampler,
                "scheduler": scheduler,
                "add_noise": "enable" if add_noise else "disable",
                "start_at_step": int(start_at_step),
                "end_at_step": int(end_at_step),
                "return_with_leftover_noise": "enable" if return_with_leftover_noise else "disable",
                "model": self._ref(model_ref, default_idx=0),
                "positive": self._ref(positive_ref, default_idx=0),
                "negative": self._ref(negative_ref, default_idx=0),
                "latent_image": self._ref(latent_ref, default_idx=0),
            },
        }
        return nid

    def add_empty_hunyuan_latent_video(
        self, width: int, height: int, length: int = 81, batch_size: int = 1,
    ) -> str:
        """
        EmptyHunyuanLatentVideo — Wan 2.2 14B t2v 空 latent。
        Wan 2.2 14B t2v 官方模板使用此节点 (与 Hunyuan Video 共用)。
        length = 帧数 = fps × duration + 1 (16fps × 5s = 81)。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "EmptyHunyuanLatentVideo",
            "inputs": {
                "width": int(width),
                "height": int(height),
                "length": int(length),
                "batch_size": int(batch_size),
            },
        }
        return nid

    def add_wan_image_to_video(
        self,
        positive_ref,
        negative_ref,
        vae_ref,
        start_image_ref,
        width: int,
        height: int,
        length: int,
        batch_size: int = 1,
        clip_vision_ref=None,
    ) -> str:
        """
        WanImageToVideo — Wan 2.2 14B i2v 起始节点。
        接收原始 positive/negative + vae + start_image, 同时输出:
          [0]=改写后的 positive CONDITIONING
          [1]=改写后的 negative CONDITIONING
          [2]=latent (基于 start_image 编码)
        clip_vision_ref: 可选 CLIP-Vision 输出 (Wan 2.2 不需要, 留作扩展)。
        下游 KSamplerAdvanced 的 positive/negative/latent 应引用本节点的 0/1/2。
        """
        nid = self._next_id()
        inputs = {
            "positive": self._ref(positive_ref, default_idx=0),
            "negative": self._ref(negative_ref, default_idx=0),
            "vae": self._ref(vae_ref, default_idx=0),
            "start_image": self._ref(start_image_ref, default_idx=0),
            "width": int(width),
            "height": int(height),
            "length": int(length),
            "batch_size": int(batch_size),
        }
        if clip_vision_ref is not None:
            inputs["clip_vision_output"] = self._ref(clip_vision_ref, default_idx=0)
        self._nodes[nid] = {
            "class_type": "WanImageToVideo",
            "inputs": inputs,
        }
        return nid

    def add_wan22_i2v_latent(
        self,
        vae_ref,
        width: int,
        height: int,
        length: int,
        batch_size: int = 1,
        start_image_ref=None,
    ) -> str:
        """
        Wan22ImageToVideoLatent — Wan 2.2 5B 双模式 latent 节点。
        vae_ref: 必需输入 (Wan2.2 VAE 输出), t2v/i2v 两模式都要接。
        start_image_ref=None → t2v 模式 (空 latent);
        start_image_ref 给定 → i2v 模式 (基于图编码 latent)。
        官方模板中 LoadImage 为 BYPASS 即 t2v, 接入即 i2v。
        输出: [node_id, 0]=LATENT
        """
        nid = self._next_id()
        inputs = {
            "vae": self._ref(vae_ref, default_idx=0),
            "width": int(width),
            "height": int(height),
            "length": int(length),
            "batch_size": int(batch_size),
        }
        if start_image_ref is not None:
            inputs["start_image"] = self._ref(start_image_ref, default_idx=0)
        self._nodes[nid] = {
            "class_type": "Wan22ImageToVideoLatent",
            "inputs": inputs,
        }
        return nid

    def add_create_video(self, images_ref, fps: int = 16) -> str:
        """
        CreateVideo — 将 IMAGE 序列封装为 VIDEO (帧率绑定)。
        Wan 14B fps=16, 5B fps=24 (帧率随条目锁定, 不进 UI)。
        输出: [node_id, 0]=VIDEO
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "CreateVideo",
            "inputs": {
                # 输入名是 fps (FLOAT) 而非 frame_rate, 与 ComfyUI object_info 对齐
                "fps": float(fps),
                "images": self._ref(images_ref, default_idx=0),
            },
        }
        return nid

    def add_save_video(
        self, video_ref, prefix: str = "video/ComfyUI",
        format: str = "mp4", codec: str = "h264",
    ) -> str:
        """
        SaveVideo — 持久化视频 (mp4/h264 首发锁定, 浏览器与 Companion 兼容最佳)。
        prefix 含路径分隔时按目录拆分 (如 "video/Wan2.2_i2v")。
        format: auto | mp4 | webm; codec: auto | h264 | vp9。
        输出: 无 (末端节点)
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SaveVideo",
            "inputs": {
                "video": self._ref(video_ref, default_idx=0),
                "filename_prefix": prefix,
                "format": format,
                "codec": codec,
            },
        }
        return nid

    def add_lora_loader_model_only(
        self, model_ref, lora_name: str, strength_model: float = 1.0,
    ) -> str:
        """
        LoraLoaderModelOnly — 只改 MODEL 链, 不改 CLIP。
        用于 Wan 2.2 Lightning 加速件 (high/low 噪声段各挂一件) 及视频 LoRA。
        model_ref: 上游 MODEL 引用 (UNETLoader / 前一个 LoraLoaderModelOnly 输出 index 0)。
        输出: [node_id, 0]=MODEL (接替上游 MODEL 链, 无 CLIP 输出)
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "lora_name": lora_name,
                "strength_model": float(strength_model),
                "model": self._ref(model_ref, default_idx=0),
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
        grow_mask_by: 遮罩扩展像素 (0-128，默认 6)
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

    # ── 面部重绘 (Impact Pack FaceDetailer) ─────────────────────────────────

    def add_ultralytics_detector(self, model_name: str) -> str:
        """
        UltralyticsDetectorProvider (ComfyUI-Impact-Subpack) — YOLO 检测器加载。
        model_name: ComfyUI 枚举格式, 形如 "bbox/face_yolov8m.pt"。
        输出: [node_id, 0]=BBOX_DETECTOR, [node_id, 1]=SEGM_DETECTOR
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "UltralyticsDetectorProvider",
            "inputs": {"model_name": model_name},
        }
        return nid

    def add_sam_loader(self, model_name: str, device_mode: str = "AUTO") -> str:
        """
        SAMLoader (Impact) — SAM 分割模型加载, 供 FaceDetailer 精细掩码。
        device_mode: AUTO (用时上 GPU、用完释放) | Prefer GPU | CPU
        输出: [node_id, 0]=SAM_MODEL
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SAMLoader",
            "inputs": {"model_name": model_name, "device_mode": device_mode},
        }
        return nid

    def add_face_detailer(
        self,
        image_node_id: str,
        model_ref,
        clip_ref,
        vae_ref,
        positive_ref,
        negative_ref,
        bbox_detector_ref,
        sam_model_ref=None,
        seed: int = -1,
        steps: int = 20,
        cfg: float = 7.0,
        sampler: str = "euler",
        scheduler: str = "normal",
        denoise: float = 0.35,
        guide_size: int = 768,
        crop_factor: float = 1.8,
        bbox_threshold: float = 0.5,
        feather: int = 5,
    ) -> str:
        """
        FaceDetailer (Impact Pack) — 检测人脸 → 裁切放大 → 局部低 denoise 重绘 → 贴回。
        max_size 取 max(1024, guide_size) (恒 ≥ guide_size, 杜绝 guide>max 的矛盾配置);
        drop_size=20 忽略远景小脸; sam_model_ref=None 时退化为 bbox 矩形掩码。
        输出: [node_id, 0]=IMAGE (整图); 输出 1 为 cropped_refined (list 型), 勿直接接 IMAGE 口
        """
        nid = self._next_id()
        actual_seed = seed if seed >= 0 else random.randint(0, 2**32 - 1)
        inputs = {
            "image": [image_node_id, 0],
            "model": self._ref(model_ref, default_idx=0),
            "clip": self._ref(clip_ref, default_idx=1),
            "vae": self._ref(vae_ref, default_idx=2),
            "positive": self._ref(positive_ref, default_idx=0),
            "negative": self._ref(negative_ref, default_idx=0),
            "bbox_detector": self._ref(bbox_detector_ref, default_idx=0),
            "guide_size": int(guide_size),
            "guide_size_for": True,
            "max_size": max(1024, int(guide_size)),
            "seed": actual_seed,
            "steps": int(steps),
            "cfg": float(cfg),
            "sampler_name": sampler,
            "scheduler": scheduler,
            "denoise": float(denoise),
            "feather": int(feather),
            "noise_mask": True,
            "force_inpaint": True,
            "bbox_threshold": float(bbox_threshold),
            "bbox_dilation": 10,
            "bbox_crop_factor": float(crop_factor),
            "sam_detection_hint": "center-1",
            "sam_dilation": 0,
            "sam_threshold": 0.93,
            "sam_bbox_expansion": 0,
            "sam_mask_hint_threshold": 0.7,
            "sam_mask_hint_use_negative": "False",
            "drop_size": 20,
            "wildcard": "",
            "cycle": 1,
            "inpaint_model": False,
            "noise_mask_feather": 20,
            "tiled_encode": False,
            "tiled_decode": False,
        }
        if sam_model_ref is not None:
            inputs["sam_model_opt"] = self._ref(sam_model_ref, default_idx=0)
        self._nodes[nid] = {"class_type": "FaceDetailer", "inputs": inputs}
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


def _add_face_detailer_chain(
    b: WorkflowBuilder,
    image: str,
    model_ref,
    clip_ref,
    vae_ref,
    positive,
    negative,
    params: dict,
    defaults: dict,
) -> str:
    """
    面部重绘链路 (SDXL / split 共用):
      UltralyticsDetectorProvider → [SAMLoader] → FaceDetailer
    face_detailer_prompt 非空 → 用主链末端 clip_ref 独立编码; 空 → 复用主 positive 引用。
    sampler/scheduler 跟随主采样 (defaults 由调用方按架构注入); cfg 独立参数, 缺省 7.0。
    返回修脸后的 IMAGE 节点 id。
    """
    detection_model = str(params.get("face_detailer_model", "face_yolov8m.pt")).strip()
    # 只留文件名, 防路径注入; builder 统一拼 ComfyUI 枚举所需的 bbox/ 前缀
    detection_model = detection_model.replace("\\", "/").split("/")[-1] or "face_yolov8m.pt"
    bbox = b.add_ultralytics_detector(f"bbox/{detection_model}")

    sam = None
    if bool(params.get("face_detailer_use_sam", False)):
        sam = b.add_sam_loader("sam_vit_b_01ec64.pth", device_mode="AUTO")

    face_prompt = str(params.get("face_detailer_prompt", "")).strip()
    face_positive = (
        b.add_clip_text_encode(face_prompt, clip_ref) if face_prompt else positive
    )

    denoise = max(0.1, min(float(params.get("face_detailer_denoise", 0.35)), 1.0))
    steps = max(1, min(int(params.get("face_detailer_steps", 20)), 100))
    cfg = max(1.0, min(float(params.get("face_detailer_cfg", 7.0)), 20.0))
    guide_size = max(256, min(int(params.get("face_detailer_guide_size", 768)), 2048))
    crop_factor = max(1.0, min(float(params.get("face_detailer_crop_factor", 1.8)), 4.0))
    bbox_threshold = max(0.1, min(float(params.get("face_detailer_bbox_threshold", 0.5)), 0.9))
    feather = max(0, min(int(params.get("face_detailer_feather", 5)), 100))

    return b.add_face_detailer(
        image,
        model_ref,
        clip_ref,
        vae_ref,
        face_positive,
        negative,
        bbox,
        sam_model_ref=sam,
        seed=int(params.get("seed", -1)),
        steps=steps,
        cfg=cfg,
        sampler=str(defaults.get("sampler", "euler")),
        scheduler=str(defaults.get("scheduler", "normal")),
        denoise=denoise,
        guide_size=guide_size,
        crop_factor=crop_factor,
        bbox_threshold=bbox_threshold,
        feather=feather,
    )


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
        hires_denoise   (float)     — 二次采样去噪强度 (0.1-1.0)，默认 0.4
        hires_steps     (int)       — 二次采样步数 (1-100)，默认 20
        hires_cfg       (float)     — 二次采样 CFG scale，默认 7.0
        hires_sampler   (str)       — 二次采样采样器，默认 "euler"
        hires_scheduler (str)       — 二次采样调度器，默认 "normal"
        hires_seed      (int)       — 二次采样种子，-1 = 随机
        i2i_image       (str)       — 图生图: 已上传到 ComfyUI input/ 的图片文件名 (启用时替换 EmptyLatentImage)
        i2i_denoise     (float)     — 图生图去噪强度 (0.10-0.90)，默认 0.7，值越低越贴近原图
        inpaint_image   (str)       — 局部重绘: 参考图文件名 (与 i2i_image 互斥)
        inpaint_mask    (str)       — 局部重绘: mask 图片文件名 (黑白 PNG，白色=重绘区域)
        inpaint_denoise (float)     — 局部重绘去噪强度 (0.10-1.00)，默认 0.75
        inpaint_grow_mask_by (int)  — 遮罩扩展像素 (0-128)，默认 6
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

    # 1.5 Clip Skip: clip_skip>1 → 在 checkpoint loader 之后插入 CLIPSetLastLayer,
    #     LoRA 链与文本编码消费其输出 (stop_at_clip_layer = -clip_skip)。
    clip_skip = int(params.get("clip_skip", 1) or 1)
    if clip_skip > 1:
        clip_skip_node = b.add_clip_set_last_layer(clip_ref, -clip_skip)
        # CLIPSetLastLayer 输出 CLIP 在 index=0 (区别于 CheckpointLoaderSimple 的 index=1)
        clip_ref = (clip_skip_node, 0)

    # 1.6 VAE 覆盖: vae 非空 → VAELoader 节点, 工作流中所有 VAE 引用统一改用它。
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
        grow = max(0, min(int(params.get("inpaint_grow_mask_by", 6)), 128))
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

    # ── 面部重绘 (双分支): 修脸跟随最后一个带提示词的全图扩散阶段 ──
    # 无 HiRes → 此处 (放大之前, 避免 max_size 压缩致修后脸偏软); 有 HiRes → HiRes 之后
    face_enabled = bool(params.get("face_detailer_enabled", False))
    hires_enabled = bool(params.get("hires_enabled", False))
    _face_defaults = {
        "sampler": str(params.get("sampler", "euler")),
        "scheduler": str(params.get("scheduler", "normal")),
    }
    if face_enabled and not hires_enabled:
        decoded = _add_face_detailer_chain(
            b, decoded, model_ref, clip_ref, vae_ref, positive, negative,
            params, _face_defaults,
        )

    # ── 放大链路 (Phase 2, 引擎分流见 _add_upscale_chain) ────────────────
    final_image = decoded
    if bool(params.get("upscale_enabled", False)):
        final_image = _add_upscale_chain(b, decoded, params)

    # ── 二次采样 (HiRes Refine) ─────────────────────────────────────
    # 将图像 VAE 编码回 latent → 独立参数二次采样 → VAE 解码 (VAE 引用 vae_ref)
    if hires_enabled:
        hires_denoise = max(0.1, min(float(params.get("hires_denoise", 0.4)), 1.0))
        hires_steps = max(1, min(int(params.get("hires_steps", 20)), 100))
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

        # ── 面部重绘 (双分支之二): HiRes 之后, 否则修脸结果被全图重绘覆盖 ──
        if face_enabled:
            final_image = _add_face_detailer_chain(
                b, final_image, model_ref, clip_ref, vae_ref, positive, negative,
                params, _face_defaults,
            )

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

    # 加载分支: packaging='checkpoint' → CheckpointLoaderSimple (整合包, model/clip/vae 同节点);
    #           packaging='split' (默认) → UNETLoader + CLIPLoader + VAELoader (三件套)
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
        grow = max(0, min(int(params.get("inpaint_grow_mask_by", 6)), 128))
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

    # ── 面部重绘 (双分支): 修脸跟随最后一个带提示词的全图扩散阶段 ──
    # 无 HiRes → 此处 (放大之前); 有 HiRes → HiRes 之后。缺省采样器/调度器随 profile
    face_enabled = bool(params.get("face_detailer_enabled", False))
    hires_enabled = bool(params.get("hires_enabled", False))
    _face_defaults = {
        "sampler": str(params.get("sampler", profile["sampler"])),
        "scheduler": str(params.get("scheduler", profile["scheduler"])),
    }
    if face_enabled and not hires_enabled:
        decoded = _add_face_detailer_chain(
            b, decoded, model_ref, clip_ref, vae_ref, positive, negative,
            params, _face_defaults,
        )

    # ── 放大链路 (与架构无关, 引擎分流见 _add_upscale_chain) ──────────
    final_image = decoded
    if bool(params.get("upscale_enabled", False)):
        final_image = _add_upscale_chain(b, decoded, params)

    # ── 二次采样 (HiRes Refine) ────────────────────────────────────────
    # 缺省值同步取 profile (hires_cfg 下限 clamp 保持 1.0)
    if hires_enabled:
        hires_denoise = max(0.1, min(float(params.get("hires_denoise", 0.4)), 1.0))
        hires_steps = max(1, min(int(params.get("hires_steps", profile["steps"])), 100))
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

        # ── 面部重绘 (双分支之二): HiRes 之后, 否则修脸结果被全图重绘覆盖 ──
        if face_enabled:
            final_image = _add_face_detailer_chain(
                b, final_image, model_ref, clip_ref, vae_ref, positive, negative,
                params, _face_defaults,
            )

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


# ── Wan 2.2 视频工作流 ───────────────────────────────────────────────────────

# 内置中文负面模板 — 标准档 negative 为空时注入。
WAN22_DEFAULT_NEGATIVE = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，"
    "静止，整体发灰，最差质量，劣质画面，坏手，变形手，多余手指，"
    "缺少手指，畸形，丑陋脸，模糊脸，不自然的面部，错误的人体，"
    "多肢体，畸形肢体，多余肢体，残缺肢体，不自然的姿势，扭曲身体，"
    "变形身体，不自然的动作，错误动作，不连贯运动，画面闪烁，画面抖动"
)

# Wan 2.2 Lightning 加速件文件名 — t2v 与 i2v 不通用, high/low 成对。
WAN22_LIGHTNING_LORAS = {
    "t2v": {
        "high": "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors",
        "low": "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors",
    },
    "i2v": {
        "high": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
        "low": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
    },
}

# 帧率随条目锁定: 14B=16fps, 5B=24fps。改帧率即改动作速度, 故不暴露。
WAN22_FPS = {"t2v": 16, "i2v": 16, "5b": 24}

# shift: 14B=5.0, 5B=8.0。
WAN22_SHIFT = {"t2v": 5.0, "i2v": 5.0, "5b": 8.0}

# 速度档参数 (仅 14B)。快速档自动注入 high+low 加速件对 (按 variant)。
WAN22_SPEED_PROFILES = {
    "fast": {"steps": 4, "split": 2, "cfg": 1.0, "use_negative": False, "inject_lightning": True},
    "standard": {"steps": 20, "split": None, "cfg": 3.5, "use_negative": True, "inject_lightning": False},
}


def build_wan22_workflow(params: dict, variant: str = "t2v") -> dict:
    """
    Wan 2.2 视频工作流 — 三 variant (t2v/i2v/5b) 平级于 build_flux2_workflow。

    variant 拓扑:
      - 't2v' (14B 双链): 两 UNETLoader(high/low) → [加速件] → [用户LoRA] →
        ModelSamplingSD3(shift=5.0) → 两段 KSamplerAdvanced (euler/simple)。
        latent = EmptyHunyuanLatentVideo。fps=16。
      - 'i2v' (14B 双链): 与 t2v 同构, latent 换 WanImageToVideo (接 start_image + vae,
        输出改写后的正/负/latent), 权重与加速件换 i2v 版。fps=16。
      - '5b'  (单链): 单 UNETLoader → ModelSamplingSD3(shift=8.0) → 单 KSampler
        (uni_pc/simple/steps=20/cfg=5.0/denoise=1.0)。latent = Wan22ImageToVideoLatent
        (接 start_image=i2v, 不接=t2v)。fps=24。无速度档。

    速度档 (仅 14B t2v/i2v):
      - fast:   steps=4, split=2, cfg=1.0, 自动注入对应 variant 的 high+low 加速件对,
                忽略 negative (cfg=1 无效)。
      - standard: steps=20 (可调, 默认 20), split=steps//2, cfg=3.5, 不挂加速件,
                使用 negative, 空则注入内置中文负面模板 WAN22_DEFAULT_NEGATIVE。

    LoRA apply 分链 (仅 14B): loras[].apply ∈ {'high','low','both'}:
      - 'high' → 挂到高噪段 MODEL 链 (KSamplerAdvanced #1)
      - 'low'  → 挂到低噪段 MODEL 链 (KSamplerAdvanced #2)
      - 'both' → 同时挂两段 (默认)

    尾链: VAEDecode → CreateVideo(fps) → SaveVideo(mp4/h264), 前缀对齐日期分目录习惯。

    params 关键字段:
        unet_high        (str, 14B 必填)   — 高噪段 UNet 文件名 (models/diffusion_models/)
        unet_low         (str, 14B 必填)   — 低噪段 UNet 文件名
        unet             (str, 5B 必填)    — 单 UNet 文件名
        unet_weight_dtype (str)           — UNet 权重精度, 默认 "default"
        clip             (str, 必填)      — Text Encoder (umt5_xxl)
        vae              (str, 必填)      — VAE (14B=wan_2.1_vae, 5B=wan2.2_vae)
        positive_prompt (str, 必填)       — 正向提示词
        negative_prompt (str)             — 负向提示词 (标准档空则注入内置模板)
        width            (int)            — 宽度 (14B %16, 5B %32)
        height           (int)            — 高度
        duration_s       (float)          — 时长秒 (帧数 = fps×duration+1)
        length           (int)            — 帧数 (显式覆盖 duration_s 计算)
        batch_size       (int)            — 批量, 默认 1 (视频恒 1)
        seed             (int)            — 种子, -1 = 随机
        steps            (int)            — 标准档步数 (默认 20; 快速档忽略)
        cfg              (float)          — 标准档 CFG (默认 3.5; 快速档忽略)
        speed            (str, 14B)       — 'fast' | 'standard' (默认 'fast')
        start_image      (str, i2v/5b)    — 起始画面文件名 (ComfyUI input/)
        loras            (list)           — LoRA: [{name, strength, apply}]
        save_prefix      (str)            — 保存前缀 (默认 "video/ComfyCarry")

    返回值: ComfyUI /prompt API 所需的 prompt dict
    """
    if variant not in ("t2v", "i2v", "5b"):
        raise ValueError(f"不支持的 variant: {variant!r}, 应为 t2v/i2v/5b")

    b = WorkflowBuilder()

    # ── 1. 加载层 ──────────────────────────────────────────────────────────
    # TE/VAE 全 variant 共用: 单 CLIPLoader(type=wan) + VAELoader。
    # 14B: 两个 UNETLoader (high/low); 5B: 单 UNETLoader。
    clip_node = b.add_clip_loader_single(
        params["clip"], type="wan",
        device=str(params.get("clip_device", "default")),
    )
    vae_node = b.add_vae_loader(params["vae"])
    clip_ref = (clip_node, 0)
    vae_ref = (vae_node, 0)

    is_14b = variant in ("t2v", "i2v")

    # ── 2. 提示词编码 (全 variant 共用) ─────────────────────────────────────
    # 速度档决定 negative 可见性: fast 忽略 negative (cfg=1 无效); standard 使用之。
    if is_14b:
        speed = str(params.get("speed", "fast")).lower()
        if speed not in ("fast", "standard"):
            speed = "fast"
        profile = WAN22_SPEED_PROFILES[speed]
    else:
        # 5B 无速度档: 恒 standard 风格 (有负面, 不挂加速件)。
        speed, profile = "standard", WAN22_SPEED_PROFILES["standard"]

    positive = b.add_clip_text_encode(params.get("positive_prompt", ""), clip_ref)
    pos_ref = (positive, 0)

    if profile["use_negative"]:
        neg_text = str(params.get("negative_prompt", "")).strip()
        if not neg_text:
            neg_text = WAN22_DEFAULT_NEGATIVE
        negative = b.add_clip_text_encode(neg_text, clip_ref)
        neg_ref = (negative, 0)
    else:
        # fast 档 (cfg=1.0): negative 在采样中不生效, 但**必须是独立节点**, 不能复用 positive。
        # 原因: i2v 的 WanImageToVideo 会改写正负 conditioning (对 negative 做 mask/concat 处理),
        # 若正负指向同一节点则其行为未定义; 且官方模板的 negative 始终是独立 CLIPTextEncode。
        # 用空串编码, 语义上等价于"无负面"且开销极小。
        negative = b.add_clip_text_encode("", clip_ref)
        neg_ref = (negative, 0)

    # ── 3. MODEL 链 + latent + 采样 (按 variant 分流) ───────────────────────
    fps = WAN22_FPS[variant]
    shift = float(params.get("shift", WAN22_SHIFT[variant]))

    # 帧数: 显式 length 优先, 否则 fps × duration_s + 1。
    length = int(params.get("length", 0))
    if length <= 0:
        duration = float(params.get("duration_s", 5))
        length = max(1, int(fps * duration) + 1)

    width = int(params.get("width", 640 if is_14b else 1280))
    height = int(params.get("height", 640 if is_14b else 704))
    batch_size = max(1, min(int(params.get("batch_size", 1)), 1))  # 视频恒 1
    seed = int(params.get("seed", -1))

    if is_14b:
        # 14B 双链
        unet_high_node = b.add_unet_loader(
            params["unet_high"],
            weight_dtype=str(params.get("unet_weight_dtype", "default")),
        )
        unet_low_node = b.add_unet_loader(
            params["unet_low"],
            weight_dtype=str(params.get("unet_weight_dtype", "default")),
        )
        high_model = (unet_high_node, 0)
        low_model = (unet_low_node, 0)

        # 加速件 (快速档): high/low 各挂一件到对应段, 在用户 LoRA 之前。
        if profile["inject_lightning"]:
            lora_pair = WAN22_LIGHTNING_LORAS[variant]
            high_light = b.add_lora_loader_model_only(
                high_model, lora_pair["high"], strength_model=1.0,
            )
            high_model = (high_light, 0)
            low_light = b.add_lora_loader_model_only(
                low_model, lora_pair["low"], strength_model=1.0,
            )
            low_model = (low_light, 0)

        # 用户 LoRA 分链挂载 (apply ∈ high/low/both, 默认 both)。
        for lora_entry in (params.get("loras") or []):
            lora_name = str(lora_entry.get("name", "")).strip()
            if not lora_name:
                continue
            strength = float(lora_entry.get("strength", 1.0))
            apply = str(lora_entry.get("apply", "both")).lower()
            if apply in ("high", "both"):
                node = b.add_lora_loader_model_only(high_model, lora_name, strength)
                high_model = (node, 0)
            if apply in ("low", "both"):
                node = b.add_lora_loader_model_only(low_model, lora_name, strength)
                low_model = (node, 0)

        # ModelSamplingSD3(shift) — 两段各接一件。
        high_ms = b.add_model_sampling_sd3(high_model, shift=shift)
        low_ms = b.add_model_sampling_sd3(low_model, shift=shift)
        high_model = (high_ms, 0)
        low_model = (low_ms, 0)

        # latent 来源: t2v = EmptyHunyuanLatentVideo; i2v = WanImageToVideo。
        if variant == "i2v":
            start_image_name = str(params.get("start_image", "")).strip()
            start_image_node = b.add_load_image(start_image_name)
            i2v_node = b.add_wan_image_to_video(
                pos_ref, neg_ref, vae_ref, start_image_node,
                width=width, height=height, length=length, batch_size=batch_size,
            )
            # WanImageToVideo 输出: 0=改写 pos, 1=改写 neg, 2=latent。
            i2v_pos = (i2v_node, 0)
            i2v_neg = (i2v_node, 1)
            latent_ref = (i2v_node, 2)
        else:
            latent_ref = (b.add_empty_hunyuan_latent_video(
                width, height, length=length, batch_size=batch_size,
            ), 0)
            i2v_pos = i2v_neg = None

        # 两段 KSamplerAdvanced: #1 add_noise=enable 0→split leftover=enable;
        #                              #2 add_noise=disable split→steps leftover=disable。
        steps = int(params.get("steps", profile["steps"]))
        split = profile["split"]
        if split is None:
            split = steps // 2
        cfg = float(params.get("cfg", profile["cfg"]))
        sampler = str(params.get("sampler", "euler"))
        scheduler = str(params.get("scheduler", "simple"))

        # 高噪段: 用 high_model + (i2v 改写后的或原始) pos/neg + latent。
        ks_pos = i2v_pos if i2v_pos is not None else pos_ref
        ks_neg = i2v_neg if i2v_neg is not None else neg_ref
        ks1 = b.add_ksampler_advanced(
            high_model, ks_pos, ks_neg, latent_ref,
            add_noise=True, steps=steps, cfg=cfg,
            sampler=sampler, scheduler=scheduler,
            start_at_step=0, end_at_step=split,
            return_with_leftover_noise=True, seed=seed,
        )
        # 低噪段: 用 low_model + 同 conditioning + 段1 输出的 latent。
        ks2 = b.add_ksampler_advanced(
            low_model, ks_pos, ks_neg, (ks1, 0),
            add_noise=False, steps=steps, cfg=cfg,
            sampler=sampler, scheduler=scheduler,
            start_at_step=split, end_at_step=steps,
            return_with_leftover_noise=False, seed=seed,
        )
        sampled = (ks2, 0)
    else:
        # 5B 单链: 单 UNETLoader → ModelSamplingSD3(shift=8.0) → 单 KSampler。
        unet_node = b.add_unet_loader(
            params["unet"],
            weight_dtype=str(params.get("unet_weight_dtype", "default")),
        )
        model_ref = (unet_node, 0)

        # 5B 不挂加速件 (无对应 LoRA), 用户 LoRA 仍可挂 (apply 字段忽略, 单链)。
        for lora_entry in (params.get("loras") or []):
            lora_name = str(lora_entry.get("name", "")).strip()
            if not lora_name:
                continue
            strength = float(lora_entry.get("strength", 1.0))
            node = b.add_lora_loader_model_only(model_ref, lora_name, strength)
            model_ref = (node, 0)

        ms_node = b.add_model_sampling_sd3(model_ref, shift=shift)
        model_ref = (ms_node, 0)

        # latent: Wan22ImageToVideoLatent (接图=i2v, 不接=t2v; vae 为必需输入)。
        start_image_name = str(params.get("start_image", "")).strip()
        latent_node = b.add_wan22_i2v_latent(
            vae_ref,
            width, height, length=length, batch_size=batch_size,
            start_image_ref=(b.add_load_image(start_image_name) if start_image_name else None),
        )
        latent_ref = (latent_node, 0)

        steps = int(params.get("steps", 20))
        cfg = float(params.get("cfg", 5.0))
        sampler = str(params.get("sampler", "uni_pc"))
        scheduler = str(params.get("scheduler", "simple"))

        ks = b.add_ksampler(
            model_ref, pos_ref, neg_ref, latent_ref,
            seed=seed, steps=steps, cfg=cfg,
            sampler=sampler, scheduler=scheduler, denoise=1.0,
        )
        sampled = (ks, 0)

    # ── 4. 尾链: VAEDecode → CreateVideo(fps) → SaveVideo ──────────────────
    decoded = b.add_vae_decode(sampled, vae_ref)
    video = b.add_create_video(decoded, fps=fps)
    save_prefix = str(params.get("save_prefix", "video/ComfyCarry")).strip() or "video/ComfyCarry"
    b.add_save_video(video, prefix=save_prefix, format="mp4", codec="h264")

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


# 扩展占位符:
# def build_flux2_workflow(params): ...  # 已实装于上方 (SamplerCustomAdvanced + Flux2Scheduler)
