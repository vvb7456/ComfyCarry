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
        """节点 ID 使用该输入的默认端口；多输出节点可显式指定 (ID, 端口)。"""
        if isinstance(ref, (tuple, list)):
            return [ref[0], int(ref[1])]
        return [ref, default_idx]


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

    def add_qwen_image21_conditioning(self, clip_ref, prompt: str,
                                      negative_prompt: str, vae_ref=None, images=(), resolution=1024) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "TextEncodeQwenImage21",
            "inputs": {
                "clip": self._ref(clip_ref, default_idx=1), "prompt": prompt,
                "negative_prompt": negative_prompt, "resolution": resolution,
            },
        }
        if images:
            self._nodes[nid]["inputs"]["vae"] = self._ref(vae_ref, 2)
            for index, image in enumerate(images, 1):
                self._nodes[nid]["inputs"][f"images.image_{index}"] = self._ref(image)
        return nid

    def add_reference_latent(self, conditioning_ref, latent_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "ReferenceLatent", "inputs": {
            "conditioning": self._ref(conditioning_ref), "latent": self._ref(latent_ref),
        }}
        return nid

    def add_reference_image_scale(self, image_ref, resolution_steps=16) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "ImageScaleToTotalPixels", "inputs": {
            "image": self._ref(image_ref), "upscale_method": "lanczos", "megapixels": 1.0, "resolution_steps": resolution_steps,
        }}
        return nid

    def add_kontext_image_scale(self, image_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "FluxKontextImageScale", "inputs": {"image": self._ref(image_ref)}}
        return nid

    def add_image_invert(self, image_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "ImageInvert", "inputs": {"image": self._ref(image_ref)}}
        return nid

    def add_repeat_latent(self, latent_ref, amount) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "RepeatLatentBatch", "inputs": {
            "samples": self._ref(latent_ref), "amount": amount,
        }}
        return nid

    def add_latent_resize(self, latent_ref, width, height, method, stride=8) -> str:
        nid = self._next_id()
        # LatentUpscale 的宽高固定按 /8 换算，Qwen 2.1 的潜空间步幅为 16。
        self._nodes[nid] = {"class_type": "LatentUpscale", "inputs": {
            "samples": self._ref(latent_ref), "upscale_method": method,
            "width": width * 8 // stride, "height": height * 8 // stride, "crop": "disabled",
        }}
        return nid

    def add_model_sampling_flux(self, model_ref, width, height) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "ModelSamplingFlux", "inputs": {
            "model": self._ref(model_ref), "max_shift": 1.15, "base_shift": 0.5,
            "width": width, "height": height,
        }}
        return nid

    def add_krea_reference_conditioning(self, clip_ref, vae_ref, prompt, images) -> str:
        encode = self._next_id()
        self._nodes[encode] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {
            "clip": self._ref(clip_ref, 1), "vae": self._ref(vae_ref, 2), "prompt": prompt,
            **{f"image{i}": self._ref(image) for i, image in enumerate(images, 1)},
        }}
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {
            "conditioning": [encode, 0], "reference_latents_method": "index_timestep_zero",
        }}
        return nid

    def add_model_patch(self, model_ref, vae_ref, image_ref, cn, arch) -> str:
        loader = self._next_id()
        self._nodes[loader] = {"class_type": "ModelPatchLoader", "inputs": {"name": cn["model"]}}
        nid = self._next_id()
        inputs = {
            "model": self._ref(model_ref), "model_patch": [loader, 0],
            "strength": float(cn.get("strength", 1)),
            "start_percent": float(cn.get("start_percent", 0)),
            "end_percent": float(cn.get("end_percent", 1)),
        }
        if arch == "anima":
            class_type = "AnimaLLLiteApply"
            inputs["image"] = self._ref(image_ref)
        else:
            class_type = "MiniMaxH3FunControlNetApply" if arch == "minimax_h3" else "ZImageFunControlnet"
            inputs["vae"] = self._ref(vae_ref, 2)
            inputs["control_video" if arch == "minimax_h3" else "image"] = self._ref(image_ref)
        self._nodes[nid] = {"class_type": class_type, "inputs": inputs}
        return nid

    def add_union_control_type(self, control_ref, control_type) -> str:
        types = {"pose": "openpose", "canny": "canny/lineart/anime_lineart/mlsd",
                 "lineart": "canny/lineart/anime_lineart/mlsd", "depth": "depth", "tile": "tile"}
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "SetUnionControlNetType", "inputs": {
            "control_net": self._ref(control_ref), "type": types[control_type],
        }}
        return nid

    def add_lineart_preprocessor(self, image_ref, resolution=1024, anime=False) -> str:
        nid = self._next_id()
        inputs = {"image": self._ref(image_ref), "resolution": resolution}
        if not anime:
            inputs["coarse"] = "disable"
        self._nodes[nid] = {"class_type": "AnimeLineArtPreprocessor" if anime else "LineArtPreprocessor", "inputs": inputs}
        return nid

    def add_control_video(self, cn, length, fps) -> str:
        frames = self._next_id()
        self._nodes[frames] = {"class_type": "VHS_LoadVideo", "inputs": {
            "video": cn["image"], "force_rate": fps, "custom_width": 0, "custom_height": 0,
            "frame_load_cap": length, "skip_first_frames": 0, "select_every_nth": 1, "format": "None",
        }}
        return frames

    def add_qwen_image21_cache(self, model_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "QwenImage21Cache",
            "inputs": {"model": self._ref(model_ref), "device": "auto", "dtype": "default"},
        }
        return nid

    def add_manual_sigmas(self, sigmas: str) -> str:
        nid = self._next_id()
        self._nodes[nid] = {"class_type": "ManualSigmas", "inputs": {"sigmas": sigmas}}
        return nid

    def add_split_sigmas_denoise(self, sigmas_ref, denoise: float) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SplitSigmasDenoise",
            "inputs": {"sigmas": self._ref(sigmas_ref), "denoise": denoise},
        }
        return nid

    def add_sigma_scheduler(self, sigmas_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "ComfyCarrySigmaScheduler",
            "inputs": {"sigmas": self._ref(sigmas_ref)},
        }
        return nid

    def add_join_image_alpha(self, image_ref, alpha_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "JoinImageWithAlpha",
            "inputs": {"image": self._ref(image_ref), "alpha": self._ref(alpha_ref)},
        }
        return nid

    def add_split_image_alpha(self, image_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SplitImageWithAlpha", "inputs": {"image": self._ref(image_ref)},
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
        seed: int,
        steps: int,
        cfg: float,
        sampler: str,
        scheduler: str,
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

    def add_ksampler_select(self, sampler_name: str) -> str:
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

    def add_basic_scheduler(self, model_ref, scheduler: str, steps: int,
                            denoise: float = 1.0) -> str:
        """
        BasicScheduler — 通用 sigma 生成器 (SamplerCustomAdvanced 采样链)。
        MiniMax H3 官方模板: scheduler='simple', steps=20, denoise=1.0。
        model_ref: 上游 MODEL 引用 (UNETLoader 输出 index 0)。
        输出: [node_id, 0]=SIGMAS
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": self._ref(model_ref, default_idx=0),
                "scheduler": scheduler,
                "steps": int(steps),
                "denoise": float(denoise),
            },
        }
        return nid

    def add_flux_guidance(self, conditioning_ref, guidance: float) -> str:
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

    def add_vae_decode_audio(self, samples_ref, vae_ref) -> str:
        """
        VAEDecodeAudio — 解码音轨 latent → AUDIO (视频专用音频 VAE)。
        MiniMax H3 (FL2VA) 使用独立的音频 VAE, 与视频 VAE 分离。
        samples_ref / vae_ref 约定同 add_vae_decode (str 向后兼容 / tuple 显式 index)。
        输出: [node_id, 0]=AUDIO
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "VAEDecodeAudio",
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
        add_noise: bool,
        steps: int,
        cfg: float,
        sampler: str,
        scheduler: str,
        start_at_step: int,
        end_at_step: int,
        return_with_leftover_noise: bool,
        seed: int,
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
        end_image_ref=None,
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
        if end_image_ref is not None:
            inputs["end_image"] = self._ref(end_image_ref)
        self._nodes[nid] = {
            "class_type": "WanFirstLastFrameToVideo" if end_image_ref is not None else "WanImageToVideo",
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

    def add_minimax_h3_image_to_video(
        self,
        clip_ref,
        vae_ref,
        prompt: str,
        width: int,
        height: int,
        length: int,
        first_frame_ref=None,
        last_frame_ref=None,
    ) -> str:
        """
        MiniMaxH3ImageToVideo — MiniMax H3 (FL2VA) 视频条件节点 (t2v/i2v 共用)。
        输出: [0]=positive(CONDITIONING), [1]=LATENT。
        t2v 不接 first/last_frame; i2v 接 first_frame (可选 last_frame)。
        clip_ref: CLIPLoader 输出 (index 0); vae_ref: VAELoader 输出 (index 0)。
        """
        nid = self._next_id()
        inputs = {
            "clip": self._ref(clip_ref, default_idx=0),
            "vae": self._ref(vae_ref, default_idx=0),
            "prompt": prompt,
            "width": int(width),
            "height": int(height),
            "length": int(length),
        }
        if first_frame_ref is not None:
            inputs["first_frame"] = self._ref(first_frame_ref, 0)
        if last_frame_ref is not None:
            inputs["last_frame"] = self._ref(last_frame_ref, 0)
        self._nodes[nid] = {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": inputs,
        }
        return nid


    def add_load_video(self, file_name: str) -> str:
        """
        LoadVideo — 加载 input/ 目录下的视频文件 (Ref2VA 参考视频源)。
        file_name: 文件名 (不含路径)。
        输出: [node_id, 0]=VIDEO
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LoadVideo",
            "inputs": {
                "file": file_name,
            },
        }
        return nid

    def add_get_video_components(self, video_ref) -> str:
        """
        GetVideoComponents — 拆解 VIDEO → 帧序列 IMAGE + AUDIO + fps + bit_depth。
        输出: [0]=images(IMAGE), [1]=audio(AUDIO), [2]=fps, [3]=bit_depth。
        参考视频取 [0] 帧序列 接入 MiniMaxH3ReferenceToVideo.ref_video_N。
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "GetVideoComponents",
            "inputs": {
                "video": self._ref(video_ref, 0),
            },
        }
        return nid

    def add_load_audio(self, file_name: str) -> str:
        """
        LoadAudio — 加载 input/ 目录下的音频文件 (Ref2VA 参考音频源)。
        file_name: 文件名 (不含路径)。
        输出: [node_id, 0]=AUDIO
        """
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LoadAudio",
            "inputs": {
                "audio": file_name,
            },
        }
        return nid

    def add_minimax_h3_reference_to_video(
        self,
        clip_ref,
        vae_ref,
        audio_vae_ref,
        prompt: str,
        width: int,
        height: int,
        length: int,
        ref_image_size: str = "match",
        image_refs=None,
        video_refs=None,
        audio_refs=None,
    ) -> str:
        """
        MiniMaxH3ReferenceToVideo — Ref2VA 参考条件节点 (clip 驱动 + 图/视频/音频参考)。
        输出: [0]=positive(CONDITIONING), [1]=LATENT。
        动态 autogrow 输入按「聚合槽.前缀名」嵌套 key 传参 (v3 schema 契约,
        执行时由 ComfyUI 聚合为 dict 传 execute):
          ref_images.ref_image_0..8    (IMAGE)  — 参考图片, 每个 self._ref(image_ref, 0)
          ref_videos.ref_video_0..2    (IMAGE)  — 参考视频帧序列, 每个 self._ref(video_ref, 0)
          ref_audios.ref_audio_0..2    (AUDIO)  — 参考音频, 每个 self._ref(audio_ref, 0)
        本期不接 ref_video_audios.ref_video_audio_N (源视频音轨配对留后续)。
        注: 用裸 key (ref_image_N) 会通过 /prompt 校验但在 execute 阶段报
        "unexpected keyword argument 'ref_image_0'" (autogrow 聚合失败)。
        image_refs/video_refs/audio_refs: 引用列表 (str | (nid, idx) 元组), 按序展开。
        ref_image_size: "match" (按参考图尺寸匹配) | "max"。
        """
        nid = self._next_id()
        inputs = {
            "clip": self._ref(clip_ref, default_idx=0),
            "vae": self._ref(vae_ref, default_idx=0),
            "audio_vae": self._ref(audio_vae_ref, default_idx=0),
            "prompt": prompt,
            "width": int(width),
            "height": int(height),
            "length": int(length),
            "ref_image_size": ref_image_size,
        }
        for i, ref in enumerate(image_refs or []):
            inputs[f"ref_images.ref_image_{i}"] = self._ref(ref, 0)
        for i, ref in enumerate(video_refs or []):
            inputs[f"ref_videos.ref_video_{i}"] = self._ref(ref, 0)
        for i, ref in enumerate(audio_refs or []):
            inputs[f"ref_audios.ref_audio_{i}"] = self._ref(ref, 0)
        self._nodes[nid] = {
            "class_type": "MiniMaxH3ReferenceToVideo",
            "inputs": inputs,
        }
        return nid

    def add_create_video(self, images_ref, fps: int | float | tuple | list = 16, audio_ref=None) -> str:
        """
        CreateVideo — 将 IMAGE 序列封装为 VIDEO (帧率绑定), 可附音轨。
        Wan 14B fps=16, 5B fps=24; MiniMax H3 fps=24 (帧率随条目锁定, 不进 UI)。
        audio_ref: 可选音频 (VAEDecodeAudio 输出), 非 None 时 inputs 增加 "audio" key。
        输出: [node_id, 0]=VIDEO
        """
        nid = self._next_id()
        inputs = {
            "fps": self._ref(fps) if isinstance(fps, (tuple, list)) else float(fps),
            "images": self._ref(images_ref, default_idx=0),
        }
        if audio_ref is not None:
            inputs["audio"] = self._ref(audio_ref, 0)
        self._nodes[nid] = {
            "class_type": "CreateVideo",
            "inputs": inputs,
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

    def add_grow_mask(self, mask_ref, expand: int) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "GrowMask",
            "inputs": {"mask": self._ref(mask_ref), "expand": expand, "tapered_corners": True},
        }
        return nid

    def add_set_latent_noise_mask(self, samples_ref, mask_ref) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "SetLatentNoiseMask",
            "inputs": {"samples": self._ref(samples_ref), "mask": self._ref(mask_ref)},
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


    def add_latent_upscale_by(
        self, samples_ref, scale_by: float = 1.5, method: str = "bislerp",
    ) -> str:
        """
        LatentUpscaleBy — 潜空间按倍率放大 (二次采样 Hires Fix 的放大步骤)。
        method: nearest-exact / bilinear / area / bicubic / bislerp
        输出: [node_id, 0]=LATENT
        """
        if method not in ("nearest-exact", "bilinear", "area", "bicubic", "bislerp"):
            method = "bislerp"
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "LatentUpscaleBy",
            "inputs": {
                "samples": self._ref(samples_ref, default_idx=0),
                "upscale_method": method,
                "scale_by": float(scale_by),
            },
        }
        return nid


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
        *,
        sam_model_ref=None,
        seed: int,
        steps: int,
        cfg: float,
        sampler: str,
        scheduler: str,
        denoise: float,
        guide_size: int = 768,
        crop_factor: float = 1.8,
        bbox_threshold: float = 0.5,
        feather: int = 5,
        scheduler_func_ref=None,
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
        if scheduler_func_ref is not None:
            inputs["scheduler_func_opt"] = self._ref(scheduler_func_ref)
        self._nodes[nid] = {"class_type": "FaceDetailer", "inputs": inputs}
        return nid


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

    def add_depth_preprocessor(self, image_node_id: str, resolution: int = 1024, midas=False) -> str:
        nid = self._next_id()
        self._nodes[nid] = {
            "class_type": "MiDaS-DepthMapPreprocessor" if midas else "DepthAnythingV2Preprocessor",
            "inputs": {
                "image": [image_node_id, 0],
                **({"a": 6.283185307179586, "bg_threshold": 0.1} if midas else {"ckpt_name": "depth_anything_v2_vitl.pth"}),
                "resolution": resolution,
            },
        }
        return nid


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


    def build(self) -> dict:
        """返回最终的 ComfyUI /prompt API 格式 prompt dict。"""
        return dict(self._nodes)


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
    face_positive=None,
) -> str:
    """
    面部重绘链路 (SDXL / split 共用):
      UltralyticsDetectorProvider → [SAMLoader] → FaceDetailer
    face_detailer_prompt 非空 → 用主链末端 clip_ref 独立编码; 空 → 复用主 positive 引用。
    返回修脸后的 IMAGE 节点 id。
    """
    detection_model = str(params["face_detailer_model"]).strip()
    # 只留文件名, 防路径注入; builder 统一拼 ComfyUI 枚举所需的 bbox/ 前缀
    detection_model = detection_model.replace("\\", "/").split("/")[-1] or "face_yolov8m.pt"
    bbox = b.add_ultralytics_detector(f"bbox/{detection_model}")

    sam = None
    if bool(params["face_detailer_use_sam"]):
        sam = b.add_sam_loader("sam_vit_b_01ec64.pth", device_mode="AUTO")

    face_prompt = str(params.get("face_detailer_prompt", "")).strip()
    if face_positive is None:
        face_positive = b.add_clip_text_encode(face_prompt, clip_ref) if face_prompt else positive

    denoise = float(params["face_detailer_denoise"])
    steps = int(params["face_detailer_steps"])
    cfg = float(params["face_detailer_cfg"])
    guide_size = int(params["face_detailer_guide_size"])
    crop_factor = float(params["face_detailer_crop_factor"])
    bbox_threshold = float(params["face_detailer_bbox_threshold"])
    feather = int(params["face_detailer_feather"])
    sampler = str(params["face_detailer_sampler"])
    scheduler = str(params["face_detailer_scheduler"])
    scheduler_func = None
    if scheduler == "qwen_image21_turbo":
        sigmas = b.add_manual_sigmas(QWEN_IMAGE21_TURBO_SIGMAS)
        if denoise < 1.0:
            sigmas = (b.add_split_sigmas_denoise(sigmas, denoise), 1)
        scheduler_func = b.add_sigma_scheduler(sigmas)
        # Impact 内部还会截取序列；这里已按去噪强度截好，传完整区间避免重复截取。
        steps, denoise, scheduler = 8, 1.0, "simple"

    return b.add_face_detailer(
        image,
        model_ref,
        clip_ref,
        vae_ref,
        face_positive,
        negative,
        bbox,
        sam_model_ref=sam,
        seed=int(params["seed"]),
        steps=steps,
        cfg=cfg,
        sampler=sampler,
        scheduler=scheduler,
        denoise=denoise,
        guide_size=guide_size,
        crop_factor=crop_factor,
        bbox_threshold=bbox_threshold,
        feather=feather,
        scheduler_func_ref=scheduler_func,
    )


def _add_upscale_chain(
    b: WorkflowBuilder, decoded: str, params: dict,
    source_w: int | None = None, source_h: int | None = None,
) -> str:
    """
    放大链路 (SDXL / Anima 共用)，按 upscale_engine 分流:
      aurasr (默认) — AuraSR 固定 4x → [ImageScale 缩到目标倍率]
      seedvr2       — DiT + VAE 加载器 + 一步扩散放大，倍率换算为短边目标像素
    source_w/source_h: 传入图像的当前尺寸 (二次采样若放大过会大于 params.width/height);
                       缺省回落到 params.width/height。目标尺寸据此按倍率推导。
    返回最终 IMAGE 节点 id。
    """
    upscale_factor = max(1.0, min(float(params.get("upscale_factor", 2)), 4.0))
    engine = str(params.get("upscale_engine", "aurasr"))
    base_w = int(source_w if source_w is not None else params.get("width", 1024))
    base_h = int(source_h if source_h is not None else params.get("height", 1024))

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
        # 共用倍率滑条 → 短边目标像素 (取偶数)
        resolution = round(min(base_w, base_h) * upscale_factor / 2) * 2
        dit = b.add_seedvr2_dit_loader(svr_model)
        vae = b.add_seedvr2_vae_loader(encode_tiled=tiled_vae, decode_tiled=tiled_vae)
        return b.add_seedvr2_upscale(
            decoded,
            dit,
            vae,
            seed=int(params["seed"]),
            resolution=resolution,
            color_correction=color_correction,
            input_noise_scale=input_noise,
            latent_noise_scale=latent_noise,
        )

    upscale_mode = str(params.get("upscale_mode", "4x_overlapped_checkboard"))
    if upscale_mode not in ("4x", "4x_overlapped_checkboard", "4x_overlapped_constant"):
        upscale_mode = "4x_overlapped_checkboard"
    upscale_tile = int(params.get("upscale_tile_batch_size", 8))
    downscale_method = str(params.get("upscale_downscale_method", "lanczos"))
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
        target_w = round(base_w * upscale_factor)
        target_h = round(base_h * upscale_factor)
        return b.add_image_scale(aurasr, target_w, target_h, method=downscale_method)
    return aurasr


def _add_controlnet_chain(b, model_ref, pos_ref, neg_ref, vae_ref, params, arch):
    for cn in params.get("controlnets") or []:
        if not cn.get("model") or not cn.get("image"):
            continue
        image = b.add_load_image(cn["image"])
        if arch == "anima" and cn["type"] == "canny":
            image = b.add_image_invert(image)
        if arch in ("anima", "zimage", "qwen_image21", "qwen_image21_turbo"):
            model_ref = (b.add_model_patch(model_ref, vae_ref, image, cn, arch), 0)
        else:
            control = b.add_controlnet_loader(cn["model"])
            if arch == "sdxl" and any(word in cn["model"].lower() for word in ("union", "promax")):
                control = b.add_union_control_type(control, cn["type"])
            applied = b.add_controlnet_apply_advanced(
                pos_ref, neg_ref, control, image,
                strength=float(cn.get("strength", 1)),
                start_percent=float(cn.get("start_percent", 0)),
                end_percent=float(cn.get("end_percent", 1)),
                vae_ref=vae_ref if arch != "sdxl" else None,
            )
            pos_ref, neg_ref = (applied, 0), (applied, 1)
    return model_ref, pos_ref, neg_ref


def _add_image_input_latent(b, vae_ref, params, width, height, batch_size, rgba=False):
    inpaint = bool(params.get("inpaint_image") and params.get("inpaint_mask"))
    filename = params["inpaint_image"] if inpaint else params.get("i2i_image")
    if not filename:
        return None, 1.0
    image = b.add_load_image(filename)
    if rgba:
        image = b.add_join_image_alpha(image, (image, 1))
    image = b.add_image_scale(image, width, height)
    if inpaint:
        mask = b.add_load_image_mask(params["inpaint_mask"], channel="red")
        grow = int(params.get("inpaint_grow_mask_by", 6))
        if rgba:
            # Qwen 低去噪重绘保留原图，再对缩放后的遮罩扩边并加噪。
            mask_image = b._next_id()
            b._nodes[mask_image] = {"class_type": "MaskToImage", "inputs": {"mask": b._ref(mask)}}
            mask_image = b.add_image_scale(mask_image, width, height, method="nearest-exact")
            resized_mask = b._next_id()
            b._nodes[resized_mask] = {"class_type": "ImageToMask", "inputs": {
                "image": b._ref(mask_image), "channel": "red",
            }}
            mask = b.add_grow_mask(resized_mask, grow)
            latent = b.add_set_latent_noise_mask(b.add_vae_encode(image, vae_ref), mask)
        else:
            latent = b.add_vae_encode_for_inpaint(image, vae_ref, mask, grow)
        denoise = float(params["inpaint_denoise"])
    else:
        latent = b.add_vae_encode(image, vae_ref)
        denoise = float(params["i2i_denoise"])
    if batch_size > 1:
        latent = b.add_repeat_latent(latent, batch_size)
    return latent, denoise


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
        steps / cfg / sampler / scheduler — 前端必传的采样参数
        save_prefix     (str)       — 文件名前缀，默认 "ComfyCarry"
        loras           (list)      — LoRA 列表: [{name, strength}, ...]
        upscale_enabled (bool)      — 是否启用 AI 放大 (Phase 2)
        upscale_engine  (str)       — 放大引擎: aurasr (默认) / seedvr2
        upscale_factor  (float)     — 放大倍率 1.5-4，默认 2 (两引擎共用)
        upscale_mode    (str)       — [aurasr] 放大模式: 4x / 4x_overlapped_checkboard / 4x_overlapped_constant
        upscale_tile_batch_size (int) — [aurasr] 分块大小 1-32，默认 8
        upscale_downscale_method (str) — [aurasr] 缩放算法: lanczos / bicubic / bilinear / area / nearest-exact
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
        hires_scale     (float)     — 二次采样潜空间放大倍率 (1.0-2.0)，默认 1.5；1.0 = 不放大只精修
        hires_upscale_method (str)  — 潜空间插值: bislerp(默认)/bicubic/bilinear/area/nearest-exact
        hires_denoise / hires_steps / hires_cfg / hires_sampler / hires_scheduler
                                    — 启用二次采样时由前端完整传入
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

    ckpt = b.add_checkpoint_loader(params["checkpoint"])

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

    loras = params.get("loras") or []

    for lora_entry in loras:
        lora_name = str(lora_entry.get("name", "")).strip()
        if not lora_name:
            continue
        strength = float(lora_entry.get("strength", 1.0))
        lora_node = b.add_lora_loader(model_ref, clip_ref, lora_name, strength_model=strength)
        model_ref = lora_node
        clip_ref = lora_node

    positive = b.add_clip_text_encode(params.get("positive_prompt", ""), clip_ref)
    negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)

    pos_ref = (positive, 0)
    neg_ref = (negative, 0)
    model_ref, pos_ref, neg_ref = _add_controlnet_chain(
        b, model_ref, pos_ref, neg_ref, vae_ref, params, "sdxl",
    )

    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    width = int(params.get("width", 1024)) // 8 * 8
    height = int(params.get("height", 1024)) // 8 * 8
    latent, i2i_denoise = _add_image_input_latent(b, vae_ref, params, width, height, batch_size)
    if latent is None:
        latent = b.add_empty_latent(
            width, height,
            batch_size=batch_size,
        )

    sampled = b.add_ksampler(
        model_ref,
        pos_ref,
        neg_ref,
        latent,
        seed=int(params["seed"]),
        steps=int(params["steps"]),
        cfg=float(params["cfg"]),
        sampler=str(params["sampler"]),
        scheduler=str(params["scheduler"]),
        denoise=i2i_denoise,
    )

    decoded = b.add_vae_decode(sampled, vae_ref)

    # 模块顺序与功能模块栏一致: 二次采样 → 面部修复 → 高清放大。
    # 二次采样先在原生分辨率上编码 (可选 latent 放大), 面部修复跟随其后,
    # 最后由不吃提示词的放大模型 (AuraSR/SeedVR2) 收尾 —— 避免其成品被 VAE
    # 往返与重绘破坏, 也避免修脸在放大后被 max_size 压软。
    face_enabled = bool(params.get("face_detailer_enabled", False))
    hires_enabled = bool(params.get("hires_enabled", False))
    upscale_enabled = bool(params.get("upscale_enabled", False))

    final_image = decoded
    if hires_enabled:
        hires_scale = float(params["hires_scale"])
        hires_method = str(params["hires_upscale_method"])
        hires_denoise = float(params["hires_denoise"])
        hires_steps = int(params["hires_steps"])
        hires_cfg = float(params["hires_cfg"])
        hires_sampler = str(params["hires_sampler"])
        hires_scheduler = str(params["hires_scheduler"])
        hires_seed = int(params["hires_seed"])
        hires_latent = b.add_vae_encode(final_image, vae_ref)
        if hires_scale > 1.0:
            hires_latent = b.add_latent_upscale_by(hires_latent, hires_scale, method=hires_method)
        hires_sampled = b.add_ksampler(
            model_ref,
            pos_ref,  # 与主采样同源, 含 ControlNet 条件
            neg_ref,
            hires_latent,
            seed=hires_seed,
            steps=hires_steps,
            cfg=hires_cfg,
            sampler=hires_sampler,
            scheduler=hires_scheduler,
            denoise=hires_denoise,
        )
        final_image = b.add_vae_decode(hires_sampled, vae_ref)

    if face_enabled:
        # 修脸是局部裁切重绘, 而 ControlNet 控制图是整图 (不随裁切同步) ->
        # 不接 CN 条件, 恒用原始正/负提示词, 避免控制图被压进脸部裁切。
        final_image = _add_face_detailer_chain(
            b, final_image, model_ref, clip_ref, vae_ref, positive, negative,
            params,
        )

    if upscale_enabled:
        base_w, base_h = width, height
        if hires_enabled and hires_scale > 1.0:
            # LatentUpscaleBy 在 /8 网格取整, 目标尺寸按同一网格推导
            source_w = round(base_w * hires_scale / 8) * 8
            source_h = round(base_h * hires_scale / 8) * 8
        else:
            source_w, source_h = base_w, base_h
        final_image = _add_upscale_chain(
            b, final_image, params, source_w=source_w, source_h=source_h,
        )

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

    b.add_preview_image(final_image)

    return b.build()


QWEN_IMAGE21_TURBO_SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
FLUX2_TURBO_SIGMAS = "1.0, 0.6509, 0.4374, 0.2932, 0.1893, 0.1108, 0.0495, 0.00031, 0"

# 分离式三件套 (UNet + 单 CLIP + VAE) 架构的差异化参数。
# 新增同构架构 (未来 flux 单 TE 变体等) 在此加 profile + _BUILDERS 注册即可。
_SPLIT_ARCH_PROFILES = {
    "anima": {"clip_type": "stable_diffusion", "controlnet": True},
    "krea2": {"clip_type": "krea2"},
    "qwen_image21": {"clip_type": "qwen_image", "latent_stride": 16, "controlnet": True},
    "qwen_image21_turbo": {"clip_type": "qwen_image", "latent_stride": 16, "controlnet": True},
    "zimage": {"clip_type": "lumina2",
               "controlnet": True,
               "latent_class": "EmptySD3LatentImage",
               "model_sampling": {"class": "auraflow", "shift": 3.0}},
    "flux1": {"dual_clip_type": "flux",
              "latent_class": "EmptySD3LatentImage",
              "controlnet": True},
    "chroma": {"clip_type": "chroma", "latent_class": "EmptySD3LatentImage",
               "model_sampling": {"class": "auraflow", "shift": 1.0}},
    # Flux2 (dev/klein) — 独立 builder (SamplerCustomAdvanced + Flux2Scheduler), 此 profile
    # 仅用于 _SPLIT_ARCH_PROFILES 注册 (arch 检测 + 加载层标识)。采样不经过 build_split_workflow。
    # latent=EmptyFlux2LatentImage (128ch, /16, step16); 单 CLIP (type=flux2)。
    "flux2": {"clip_type": "flux2",
              "latent_class": "EmptyFlux2LatentImage"},
}


def _add_split_sampler(
    b: WorkflowBuilder, model_ref, positive_ref, negative_ref, latent_ref,
    *, seed: int, steps: int, cfg: float, sampler: str, scheduler: str, denoise: float,
) -> str:
    if scheduler != "qwen_image21_turbo":
        return b.add_ksampler(
            model_ref, positive_ref, negative_ref, latent_ref,
            seed=seed, steps=steps, cfg=cfg, sampler=sampler, scheduler=scheduler, denoise=denoise,
        )

    sigmas = b.add_manual_sigmas(QWEN_IMAGE21_TURBO_SIGMAS)
    if denoise < 1.0:
        sigmas = (b.add_split_sigmas_denoise(sigmas, denoise), 1)
    noise = b.add_random_noise(seed)
    guider = b.add_cfg_guider(model_ref, positive_ref, negative_ref, cfg)
    selected_sampler = b.add_ksampler_select(sampler)
    return b.add_sampler_custom_advanced(noise, guider, selected_sampler, sigmas, latent_ref)


def build_split_workflow(params: dict, arch: str) -> dict:
    """
    构建分离式架构 (UNet + CLIP + VAE) 工作流，profile 描述加载方式与潜空间。

    支持架构 (见 _SPLIT_ARCH_PROFILES):
      - anima:  CircleStone Labs 2B, CLIPLoader type=stable_diffusion
      - krea2:  Krea 2 12B SingleStreamDiT, CLIPLoader type=krea2
      - zimage: Z-Image (Tongyi/阿里, 6B 单流 DiT), CLIPLoader type=lumina2,
                ModelSamplingAuraFlow(shift=3) 接 MODEL 链,
                latent=EmptySD3LatentImage
      - flux1:  Flux 1 dev, DualCLIPLoader type=flux (clip_l + t5xxl 双 TE),
                latent=EmptySD3LatentImage

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
      KSampler / SamplerCustomAdvanced (按前端所选调度器)
      VAEDecode
      [可选二次采样 HiRes (含潜空间放大)]
      [可选面部修复]
      [可选放大链路 (AuraSR/SeedVR2 收尾)]
      Image Save + PreviewImage

    支持模块: LoRA / I2I / Inpaint / HiRes / Upscale (与 SDXL 相同)
    ControlNet 按 profile 启用；模型补丁与标准 ControlNet 分别应用到模型或条件链。

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
    profile = _SPLIT_ARCH_PROFILES[arch]
    is_qwen_image21 = arch in ("qwen_image21", "qwen_image21_turbo")
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

    reference_images = [b.add_load_image(ref["name"]) for ref in params.get("refs") or []]
    stride = profile.get("latent_stride", 8)
    canvas_step = 32 if is_qwen_image21 and reference_images else stride
    width = int(params.get("width", 1024)) // canvas_step * canvas_step
    height = int(params.get("height", 1024)) // canvas_step * canvas_step
    if is_qwen_image21:
        reference_images = [b.add_join_image_alpha(image, (image, 1)) for image in reference_images]
        model_ref = (b.add_qwen_image21_cache(model_ref), 0)
    if arch == "krea2" and reference_images:
        model_ref = (b.add_model_sampling_flux(model_ref, width, height), 0)
    flux_reference = None
    if arch == "flux1" and reference_images:
        image = b.add_kontext_image_scale(reference_images[0])
        flux_reference = b.add_vae_encode(image, vae_ref)

    def encode_prompt(prompt, target_width=width, target_height=height):
        if is_qwen_image21:
            images = []
            if reference_images:
                images = [b.add_image_scale(reference_images[0], target_width, target_height, crop="center")]
                images.extend(b.add_reference_image_scale(image, resolution_steps=32) for image in reference_images[1:])
            encoded = b.add_qwen_image21_conditioning(
                clip_ref, prompt, params.get("negative_prompt", ""), vae_ref, images,
                resolution=0 if images else 1024,
            )
            return (encoded, 0), (encoded, 1)
        negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)
        if arch == "krea2" and reference_images:
            positive = b.add_krea_reference_conditioning(clip_ref, vae_ref, prompt, reference_images)
        else:
            positive = b.add_clip_text_encode(prompt, clip_ref)
        if flux_reference is not None:
            positive = b.add_reference_latent(positive, flux_reference)
            positive = b.add_flux_guidance(positive, guidance=2.5)
        return positive, negative

    positive, negative = encode_prompt(params.get("positive_prompt", ""))
    pos_ref = b._ref(positive)
    neg_ref = b._ref(negative)

    unpatched_model_ref = model_ref
    if profile.get("controlnet"):
        model_ref, pos_ref, neg_ref = _add_controlnet_chain(
            b, model_ref, pos_ref, neg_ref, vae_ref, params, arch,
        )

    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    latent, i2i_denoise = _add_image_input_latent(
        b, vae_ref, params, width, height, batch_size, rgba=is_qwen_image21,
    )
    if latent is None:
        if is_qwen_image21 and reference_images:
            latent = (positive[0], 2)
            if batch_size > 1:
                latent = b.add_repeat_latent(latent, batch_size)
        else:
            latent = b.add_empty_latent(
                width, height, batch_size=batch_size,
                class_type=str(profile.get("latent_class", "EmptyLatentImage")),
            )

    sampled = _add_split_sampler(
        b, model_ref, pos_ref, neg_ref, latent,
        seed=int(params["seed"]),
        steps=int(params["steps"]),
        cfg=float(params["cfg"]),
        sampler=str(params["sampler"]),
        scheduler=str(params["scheduler"]),
        denoise=i2i_denoise,
    )

    decoded = b.add_vae_decode(sampled, vae_ref)

    # 模块顺序与功能模块栏一致: 二次采样 → 面部修复 → 高清放大 (同 SDXL, 见 build_sdxl_workflow)
    face_enabled = bool(params.get("face_detailer_enabled", False))
    hires_enabled = bool(params.get("hires_enabled", False))
    upscale_enabled = bool(params.get("upscale_enabled", False))

    final_image = decoded
    source_w, source_h = width, height
    if hires_enabled:
        hires_scale = float(params["hires_scale"])
        hires_method = str(params["hires_upscale_method"])
        hires_denoise = float(params["hires_denoise"])
        hires_steps = int(params["hires_steps"])
        hires_cfg = float(params["hires_cfg"])
        hires_sampler = str(params["hires_sampler"])
        hires_scheduler = str(params["hires_scheduler"])
        hires_seed = int(params["hires_seed"])
        source_w = round(width * hires_scale / canvas_step) * canvas_step
        source_h = round(height * hires_scale / canvas_step) * canvas_step
        hires_latent = b.add_vae_encode(final_image, vae_ref)
        if hires_scale > 1.0:
            hires_latent = b.add_latent_resize(hires_latent, source_w, source_h, hires_method, stride)
        hires_pos, hires_neg = pos_ref, neg_ref
        if is_qwen_image21 and reference_images:
            hires_pos, hires_neg = encode_prompt(params.get("positive_prompt", ""), source_w, source_h)
        hires_model = model_ref
        if arch == "krea2" and reference_images:
            hires_model = b.add_model_sampling_flux(model_ref, source_w, source_h)
        hires_sampled = _add_split_sampler(
            b, hires_model, hires_pos, hires_neg,
            hires_latent,
            seed=hires_seed,
            steps=hires_steps,
            cfg=hires_cfg,
            sampler=hires_sampler,
            scheduler=hires_scheduler,
            denoise=hires_denoise,
        )
        final_image = b.add_vae_decode(hires_sampled, vae_ref)

    if face_enabled:
        # 修脸是局部裁切重绘, 而 ControlNet 控制图是整图 (不随裁切同步) ->
        # 不接 CN 条件, 恒用原始正/负提示词, 避免控制图被压进脸部裁切。
        if is_qwen_image21:
            face_rgba = b.add_split_image_alpha(final_image)
            final_image = face_rgba
        face_prompt = str(params.get("face_detailer_prompt", "")).strip()
        face_positive = encode_prompt(face_prompt)[0] if face_prompt else positive
        final_image = _add_face_detailer_chain(
            b, final_image, unpatched_model_ref, clip_ref, vae_ref, positive, negative,
            params, face_positive=face_positive,
        )
        if is_qwen_image21:
            final_image = b.add_join_image_alpha(final_image, (face_rgba, 1))

    if upscale_enabled:
        if is_qwen_image21:
            upscale_rgba = b.add_split_image_alpha(final_image)
            final_image = upscale_rgba
        final_image = _add_upscale_chain(
            b, final_image, params, source_w=source_w, source_h=source_h,
        )
        if is_qwen_image21:
            final_image = b.add_join_image_alpha(final_image, (upscale_rgba, 1))

    save_prefix_raw = str(params.get("save_prefix", "ComfyCarry")).strip() or "ComfyCarry"
    output_format = str(params.get("output_format", "png")).lower()
    if output_format not in ("png", "jpg", "jpeg", "webp", "tiff", "bmp", "gif"):
        output_format = "png"

    if '/' in save_prefix_raw:
        save_output_path, save_filename = save_prefix_raw.rsplit('/', 1)
    else:
        save_output_path, save_filename = '', save_prefix_raw

    saved_image = final_image
    if is_qwen_image21 and output_format in ("jpg", "jpeg", "bmp", "gif"):
        saved_image = b.add_split_image_alpha(final_image)
    b.add_save_image(saved_image, prefix=save_filename, output_path=save_output_path,
                     extension=output_format, batch_size=batch_size)

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


def build_qwen_image21_workflow(params: dict, turbo: bool = False) -> dict:
    return build_split_workflow(params, "qwen_image21_turbo" if turbo else "qwen_image21")


def build_flux2_workflow(params: dict) -> dict:
    """
    Flux2 (dev/klein) — 独立采样 builder (SamplerCustomAdvanced + Flux2Scheduler)。

    guider_mode 分支:
      - 'basic' (dev):  FluxGuidance(positive, guidance) → BasicGuider(model, positive)
                        (无负面, cfg 字段作为 guidance)
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
        cfg              (float) — [basic] Guidance / [cfg] CFGGuider 值
        steps / sampler / scheduler — 前端必传; scheduler='flux2' 选择专用调度器
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

    guider_mode = str(params["guider_mode"])

    reference_latents = []
    for ref in params.get("refs") or []:
        image = b.add_reference_image_scale(b.add_load_image(ref["name"]))
        latent = b.add_vae_encode(image, vae_ref)
        reference_latents.append(latent)
        pos_ref = (b.add_reference_latent(pos_ref, latent), 0)

    if guider_mode == "basic":
        guidance = float(params["cfg"])
        guided_pos = b.add_flux_guidance(pos_ref, guidance=guidance)
        guider = b.add_basic_guider(model_ref, (guided_pos, 0))
    else:
        negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)
        neg_ref = (negative, 0)
        for latent in reference_latents:
            neg_ref = (b.add_reference_latent(neg_ref, latent), 0)
        cfg = float(params["cfg"])
        guider = b.add_cfg_guider(model_ref, pos_ref, neg_ref, cfg)

    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    # flux2 仅 t2i: 直接喂编码 latent 会被全量重噪 = 忽略参考图, 故不接 i2i/inpaint 分支
    latent = b.add_empty_latent(
        int(params.get("width", 1024)),
        int(params.get("height", 1024)),
        batch_size=batch_size,
        class_type="EmptyFlux2LatentImage",
    )

    seed = int(params["seed"])
    noise = b.add_random_noise(seed)
    sampler = b.add_ksampler_select(str(params["sampler"]))
    steps = int(params["steps"])
    scheduler = str(params["scheduler"])
    if scheduler == "flux2_turbo":
        sigmas = b.add_manual_sigmas(FLUX2_TURBO_SIGMAS)
    elif scheduler == "flux2":
        sigmas = b.add_flux2_scheduler(steps, int(params["width"]), int(params["height"]))
    else:
        sigmas = b.add_basic_scheduler(model_ref, scheduler, steps)
    sampled = b.add_sampler_custom_advanced(noise, guider, sampler, sigmas, latent)

    decoded = b.add_vae_decode(sampled, vae_ref)

    final_image = decoded
    if bool(params.get("upscale_enabled", False)):
        final_image = _add_upscale_chain(b, decoded, params)

    # HiRes 二次采样对 flux2 需另一次 SamplerCustomAdvanced + SplitSigmas 分段去噪 (未实装) → 略过。

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

    速度档仅决定是否注入对应 variant 的 high+low 加速件对。
    步数、CFG、采样器、调度器均使用前端传值，两段在 steps//2 处交接。

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
        negative_prompt (str)             — 负向提示词
        width            (int)            — 宽度 (14B %16, 5B %32)
        height           (int)            — 高度
        duration_s       (float)          — 时长秒 (帧数 = fps×duration+1)
        length           (int)            — 帧数 (显式覆盖 duration_s 计算)
        batch_size       (int)            — 批量, 默认 1 (视频恒 1)
        seed             (int)            — 种子, -1 = 随机
        steps / cfg / sampler / scheduler — 前端必传的采样参数
        speed            (str, 14B)       — 'fast' | 'standard'
        start_image      (str, i2v/5b)    — 起始画面文件名 (ComfyUI input/)
        loras            (list)           — LoRA: [{name, strength, apply}]
        save_prefix      (str)            — 保存前缀 (默认 "video/ComfyCarry")

    返回值: ComfyUI /prompt API 所需的 prompt dict
    """
    if variant not in ("t2v", "i2v", "5b"):
        raise ValueError(f"不支持的 variant: {variant!r}, 应为 t2v/i2v/5b")

    b = WorkflowBuilder()

    # TE/VAE 全 variant 共用; 14B: 两个 UNETLoader (high/low), 5B: 单 UNETLoader。
    clip_node = b.add_clip_loader_single(
        params["clip"], type="wan",
        device=str(params.get("clip_device", "default")),
    )
    vae_node = b.add_vae_loader(params["vae"])
    clip_ref = (clip_node, 0)
    vae_ref = (vae_node, 0)

    is_14b = variant in ("t2v", "i2v")

    positive = b.add_clip_text_encode(params.get("positive_prompt", ""), clip_ref)
    pos_ref = (positive, 0)

    # WanImageToVideo 会分别改写正负条件，两者必须是独立引用。
    negative = b.add_clip_text_encode(params.get("negative_prompt", ""), clip_ref)
    neg_ref = (negative, 0)

    fps = WAN22_FPS[variant]
    shift = float(params.get("shift", WAN22_SHIFT[variant]))

    length = int(params.get("length", 0))
    if length <= 0:
        duration = float(params.get("duration_s", 5))
        length = max(1, int(fps * duration) + 1)

    width = int(params.get("width", 640 if is_14b else 1280))
    height = int(params.get("height", 640 if is_14b else 704))
    batch_size = max(1, min(int(params.get("batch_size", 1)), 1))  # 视频恒 1
    seed = int(params["seed"])

    if is_14b:
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
        if params["speed"] == "fast":
            lora_pair = WAN22_LIGHTNING_LORAS[variant]
            high_light = b.add_lora_loader_model_only(
                high_model, lora_pair["high"], strength_model=1.0,
            )
            high_model = (high_light, 0)
            low_light = b.add_lora_loader_model_only(
                low_model, lora_pair["low"], strength_model=1.0,
            )
            low_model = (low_light, 0)

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

        high_ms = b.add_model_sampling_sd3(high_model, shift=shift)
        low_ms = b.add_model_sampling_sd3(low_model, shift=shift)
        high_model = (high_ms, 0)
        low_model = (low_ms, 0)

        if variant == "i2v":
            start_image_name = str(params.get("start_image", "")).strip()
            start_image_node = b.add_load_image(start_image_name)
            i2v_node = b.add_wan_image_to_video(
                pos_ref, neg_ref, vae_ref, start_image_node,
                width=width, height=height, length=length, batch_size=batch_size,
                end_image_ref=b.add_load_image(params["last_image"]) if params.get("last_image") else None,
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
        steps = int(params["steps"])
        split = steps // 2
        cfg = float(params["cfg"])
        sampler = str(params["sampler"])
        scheduler = str(params["scheduler"])

        ks_pos = i2v_pos if i2v_pos is not None else pos_ref
        ks_neg = i2v_neg if i2v_neg is not None else neg_ref
        ks1 = b.add_ksampler_advanced(
            high_model, ks_pos, ks_neg, latent_ref,
            add_noise=True, steps=steps, cfg=cfg,
            sampler=sampler, scheduler=scheduler,
            start_at_step=0, end_at_step=split,
            return_with_leftover_noise=True, seed=seed,
        )
        ks2 = b.add_ksampler_advanced(
            low_model, ks_pos, ks_neg, (ks1, 0),
            add_noise=False, steps=steps, cfg=cfg,
            sampler=sampler, scheduler=scheduler,
            start_at_step=split, end_at_step=steps,
            return_with_leftover_noise=False, seed=seed,
        )
        sampled = (ks2, 0)
    else:
        unet_node = b.add_unet_loader(
            params["unet"],
            weight_dtype=str(params.get("unet_weight_dtype", "default")),
        )
        model_ref = (unet_node, 0)

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

        steps = int(params["steps"])
        cfg = float(params["cfg"])
        sampler = str(params["sampler"])
        scheduler = str(params["scheduler"])

        ks = b.add_ksampler(
            model_ref, pos_ref, neg_ref, latent_ref,
            seed=seed, steps=steps, cfg=cfg,
            sampler=sampler, scheduler=scheduler, denoise=1.0,
        )
        sampled = (ks, 0)

    decoded = b.add_vae_decode(sampled, vae_ref)
    video = b.add_create_video(decoded, fps=fps)
    save_prefix = str(params.get("save_prefix", "video/ComfyCarry")).strip() or "video/ComfyCarry"
    b.add_save_video(video, prefix=save_prefix, format="mp4", codec="h264")

    return b.build()


# MiniMax H3 (FL2VA, t2v/i2v) — CFG-distilled, 无 negative / cfg。
H3_FPS = 24
H3_DURATION_RANGE = (4, 15)      # 整数秒
H3_FRAME_GRID = 17               # length = 17k+5
H3_FRAME_GRID_OFFSET = 5
H3_MAX_PIXELS = 768 * 1344


def h3_align_length(frames: int) -> int:
    """返回 ≥ frames 的最小 17k+5 值 (MiniMax H3 帧网格约束)。"""
    k = max(0, (int(frames) - H3_FRAME_GRID_OFFSET + H3_FRAME_GRID - 1) // H3_FRAME_GRID)
    return H3_FRAME_GRID * k + H3_FRAME_GRID_OFFSET


def _h3_shared_setup(params: dict):
    """
    H3 家族 (FL2VA / Ref2VA) 公共前半段: 加载层 + 分辨率/帧数/种子/步数解析。
    返回: (builder, clip_node, vae_node, audio_vae_node, unet_node,
           length, width, height, seed, steps)
    """
    b = WorkflowBuilder()

    clip_node = b.add_clip_loader_single(
        params["clip"], type="minimax",
        device=str(params.get("clip_device", "default")),
    )
    vae_node = b.add_vae_loader(params["vae"])
    audio_vae_node = b.add_vae_loader(params["audio_vae"])
    unet_node = b.add_unet_loader(
        params["unet"],
        weight_dtype=str(params.get("unet_weight_dtype", "default")),
    )

    for lora in params.get("loras") or []:
        unet_node = b.add_lora_loader_model_only(unet_node, lora["name"], float(lora.get("strength", 1)))
    if params.get("fast"):
        shifted = b._next_id()
        b._nodes[shifted] = {"class_type": "MiniMaxH3SigmaShift", "inputs": {
            "model": [unet_node, 0], "shift_video": 12.0, "shift_audio": 3.0,
        }}
        unet_node = shifted

    # 帧数: 显式 length 优先, 否则按 duration_s×24 对齐 17k+5 兜底。
    length = int(params.get("length", 0))
    if length <= 0:
        duration = float(params.get("duration_s", 5))
        length = h3_align_length(int(round(H3_FPS * duration)))
    width = int(params.get("width", 1344))
    height = int(params.get("height", 768))
    seed = int(params["seed"])
    steps = int(params["steps"])
    for cn in params.get("controlnets") or []:
        if not cn.get("model") or not cn.get("image"):
            continue
        frames = b.add_control_video(cn, length, H3_FPS)
        unet_node = b.add_model_patch(unet_node, (vae_node, 0), frames, cn, "minimax_h3")
    return b, clip_node, vae_node, audio_vae_node, unet_node, length, width, height, seed, steps


def _h3_sampling_and_tail(b: WorkflowBuilder, unet_node, cond_latent, seed: int,
                          steps: int, vae_node, audio_vae_node, params: dict):
    """
    H3 家族公共后半段: 采样链 (RandomNoise + BasicGuider + KSamplerSelect +
    BasicScheduler → SamplerCustomAdvanced) + 尾链 (VAEDecode + VAEDecodeAudio →
    CreateVideo(fps=24, audio) → SaveVideo)。节点就地写入 builder。
    """
    noise = b.add_random_noise(seed)
    guider = b.add_basic_guider((unet_node, 0), (cond_latent, 0))
    sampler = b.add_ksampler_select(str(params["sampler"]))
    sigmas = b.add_basic_scheduler(
        (unet_node, 0),
        str(params["scheduler"]),
        steps, denoise=1.0,
    )
    sampled = b.add_sampler_custom_advanced(
        noise, guider, sampler, sigmas, (cond_latent, 1),
    )

    video_img = b.add_vae_decode(sampled, (vae_node, 0))
    audio = b.add_vae_decode_audio(sampled, (audio_vae_node, 0))
    video = b.add_create_video(video_img, fps=H3_FPS, audio_ref=audio)
    save_prefix = str(params.get("save_prefix", "video/MiniMax_H3")).strip() or "video/MiniMax_H3"
    b.add_save_video(video, prefix=save_prefix, format="mp4", codec="h264")


def build_minimax_h3_workflow(params: dict, variant: str = "i2v") -> dict:
    """
    MiniMax H3 (FL2VA) 视频工作流 — t2v / i2v 双模式。

    节点链 (顺序搭建):
      1. CLIPLoader(type=minimax) + VAELoader(视频 VAE) + VAELoader(音频 VAE) + UNETLoader
      2. (仅 i2v) LoadImage(start_image) / LoadImage(last_image)
      3. MiniMaxH3ImageToVideo(clip, vae, prompt, w, h, length) → [0]=positive, [1]=LATENT
      4. RandomNoise(seed) + BasicGuider(unet, cond) + KSamplerSelect + BasicScheduler
         → SamplerCustomAdvanced(noise, guider, sampler, sigmas, latent)
      5. VAEDecode(视频) + VAEDecodeAudio(音频) → CreateVideo(fps=24, audio) → SaveVideo(mp4/h264)

    特征: CFG-distilled → 无 negative、无 cfg、无 CLIPTextEncode 节点。
    length 满足 17k+5 (k≥0); 官方默认 fps=24, sampler=res_multistep, scheduler=simple,
    steps=20, denoise=1.0, 分辨率 1344×768, MAX_PIXELS=1032192, divisor=32。

    params 关键字段:
        unet             (str, 必填)     — UNet 文件名 (models/diffusion_models/)
        clip             (str, 必填)     — Text Encoder (CLIPLoader type=minimax)
        vae              (str, 必填)     — 视频 VAE
        audio_vae        (str, 必填)     — 音频 VAE (独立, 供 VAEDecodeAudio)
        unet_weight_dtype (str)          — UNet 权重精度, 默认 "default"
        clip_device      (str)           — CLIP 设备, 默认 "default"
        positive_prompt  (str)           — 正向提示词 (MiniMaxH3ImageToVideo.prompt)
        width            (int)           — 宽度 (默认 1344, 须 %32)
        height           (int)           — 高度 (默认 768, 须 %32)
        length           (int)           — 帧数 (须 17k+5; 无则由 duration_s×24 对齐兜底)
        duration_s       (float)         — 时长秒 (length 缺失时兜底计算)
        seed             (int)           — 种子, -1 = 随机
        steps / sampler / scheduler     — 前端必传的采样参数
        start_image      (str, i2v)      — 首帧文件名 (ComfyUI input/)
        last_image       (str, i2v 可选) — 尾帧文件名
        save_prefix      (str)           — 保存前缀 (默认 "video/MiniMax_H3")

    返回值: ComfyUI /prompt API 所需的 prompt dict
    """
    if variant not in ("t2v", "i2v"):
        raise ValueError(f"不支持的 variant: {variant!r}, 应为 t2v/i2v")

    b, clip_node, vae_node, audio_vae_node, unet_node, length, width, height, seed, steps = \
        _h3_shared_setup(params)

    load_start = load_last = None
    if variant == "i2v":
        start_image = str(params.get("start_image", "")).strip()
        if start_image:
            load_start = b.add_load_image(start_image)
        last_image = str(params.get("last_image", "")).strip()
        if last_image:
            load_last = b.add_load_image(last_image)

    cond_latent = b.add_minimax_h3_image_to_video(
        (clip_node, 0), (vae_node, 0),
        str(params.get("positive_prompt", "")),
        width, height, length,
        first_frame_ref=load_start, last_frame_ref=load_last,
    )

    _h3_sampling_and_tail(b, unet_node, cond_latent, seed, steps, vae_node, audio_vae_node, params)

    return b.build()


def build_minimax_h3_ref_workflow(params: dict) -> dict:
    """
    MiniMax H3 (FL2VA) Ref2VA 参考生成视频工作流。

    节点链 (顺序搭建):
      1. CLIPLoader(type=minimax) + VAELoader(视频 VAE) + VAELoader(音频 VAE) + UNETLoader
      2. 参考分组 (保持原顺序):
           image → LoadImage → ref_image_N
           video → LoadVideo → GetVideoComponents → ref_video_N 接 (gvc, 0)
           audio → LoadAudio → ref_audio_N
      3. MiniMaxH3ReferenceToVideo(clip, vae, audio_vae, prompt, w, h, length,
                                    ref_image_N / ref_video_N / ref_audio_N)
         → [0]=positive, [1]=LATENT
      4. RandomNoise(seed) + BasicGuider(unet, cond) + KSamplerSelect + BasicScheduler
         → SamplerCustomAdvanced(noise, guider, sampler, sigmas, latent)
      5. VAEDecode(视频) + VAEDecodeAudio(音频) → CreateVideo(fps=24, audio) → SaveVideo(mp4/h264)

    特征: 与 FL2VA 同 (CFG-distilled, 无 negative/cfg/CLIPTextEncode);
    length 满足 17k+5, fps=24, sampler=res_multistep, scheduler=simple。
    本期不接 ref_video_audio_N (源视频音轨配对留后续)。

    params 关键字段:
        unet / clip / vae / audio_vae  (str, 必填) — 与 FL2VA 相同
        refs          (list, 必填) — 参考列表, 每项 {"type": "image"|"video"|"audio", "name": str};
                        name 为 ComfyUI input/ 下文件名。空列表抛 ValueError。
        positive_prompt  (str)     — 正向提示词
        width / height   (int)     — 分辨率 (默认 1344×768, 须 %32)
        length           (int)     — 帧数 (须 17k+5; 无则由 duration_s×24 对齐兜底)
        duration_s       (float)   — 时长秒 (length 缺失时兜底计算)
        seed             (int)     — 种子, -1 = 随机
        steps / sampler / scheduler — 前端必传的采样参数
        save_prefix      (str)     — 保存前缀 (默认 "video/MiniMax_H3")

    返回值: ComfyUI /prompt API 所需的 prompt dict
    """
    refs = params.get("refs") or []
    if not refs:
        raise ValueError("refs 不能为空")

    b, clip_node, vae_node, audio_vae_node, unet_node, length, width, height, seed, steps = \
        _h3_shared_setup(params)

    image_refs: list = []
    video_refs: list = []
    audio_refs: list = []
    for item in refs:
        rtype = item.get("type")
        name = str(item.get("name", ""))
        if rtype == "image":
            image_refs.append(b.add_load_image(name))
        elif rtype == "video":
            lv = b.add_load_video(name)
            gvc = b.add_get_video_components(lv)
            video_refs.append((gvc, 0))
        elif rtype == "audio":
            audio_refs.append(b.add_load_audio(name))
        else:
            raise ValueError(f"不支持的 ref type: {rtype!r}")

    cond_latent = b.add_minimax_h3_reference_to_video(
        (clip_node, 0), (vae_node, 0), (audio_vae_node, 0),
        str(params.get("positive_prompt", "")),
        width, height, length,
        image_refs=image_refs, video_refs=video_refs, audio_refs=audio_refs,
    )

    _h3_sampling_and_tail(b, unet_node, cond_latent, seed, steps, vae_node, audio_vae_node, params)

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

    if params.get("video"):
        video = b.add_load_video(image)
        load_img = b.add_get_video_components(video)
    else:
        load_img = b.add_load_image(image)

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
        processed = b.add_depth_preprocessor(load_img, resolution=resolution, midas=bool(params.get("depth_midas")))
    elif pp_type == "lineart":
        processed = b.add_lineart_preprocessor(load_img, resolution=resolution, anime=bool(params.get("lineart_anime")))
    else:
        raise ValueError(f"不支持的预处理类型: {pp_type}")

    if params.get("video"):
        # 沿用源帧率保存，控制视频的动作时间与原片一致。
        result = b.add_create_video(processed, fps=(load_img, 2))
        b.add_save_video(result, prefix=save_prefix)
    else:
        b.add_save_image(processed, prefix=save_prefix, output_path=input_dir, extension='png')
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
