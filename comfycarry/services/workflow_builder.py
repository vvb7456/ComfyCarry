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
        positive_node_id: str,
        negative_node_id: str,
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
                "model": [model_node_id, 0],
                "positive": [positive_node_id, 0],
                "negative": [negative_node_id, 0],
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

    # Phase 2+ 扩展占位符:
    # def add_load_image(self, image_path): ...          ← Img2Img / ControlNet
    # def add_vae_encode(self, image_node_id, vae_node_id): ...
    # def add_controlnet_apply(self, ...): ...
    # def add_inpaint_model_conditioning(self, ...): ...

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

    # 4. 空 Latent (支持批量)
    batch_size = max(1, min(int(params.get("batch_size", 1)), 16))
    latent = b.add_empty_latent(
        int(params.get("width", 1024)),
        int(params.get("height", 1024)),
        batch_size=batch_size,
    )

    # 5. 采样
    sampled = b.add_ksampler(
        model_ref,
        positive,
        negative,
        latent,
        seed=int(params.get("seed", -1)),
        steps=int(params.get("steps", 20)),
        cfg=float(params.get("cfg", 7.0)),
        sampler=str(params.get("sampler", "euler")),
        scheduler=str(params.get("scheduler", "normal")),
    )

    # 6. VAE 解码 (VAE 始终来自原始 Checkpoint，index=2)
    decoded = b.add_vae_decode(sampled, ckpt)

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

    b.add_save_image(decoded, prefix=save_filename, output_path=save_output_path,
                     extension=output_format, batch_size=batch_size)

    # 8. PreviewImage — 加入工作流以触发 ComfyUI WS 预览帧广播
    #    (每执行步通过 WS 二进制帧推送 JPEG 预览给所有连接的客户端)
    b.add_preview_image(decoded)

    return b.build()


# Phase 2+ 扩展占位符:
# def build_flux_workflow(params): ...
# def build_zimage_workflow(params): ...
