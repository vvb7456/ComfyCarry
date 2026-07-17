"""
comfycarry/services/arch_detect.py
────────────────────────────────────────
架构检测 — 纯 stdlib 模块 (json/struct/os/re/typing)。

从 routes/generate.py 抽出的模型架构检测逻辑:
  - arch_from_base_model: CivitAI baseModel 字符串 → 架构
  - detect_arch: 多源检测 (sidecar > header > 路径)
  - match_arch_from_keys: 从 safetensors/gguf tensor key 集合判定架构

模块可独立测试 (无 flask/COMFYUI_DIR 依赖)。
新增架构: 插入 _ARCH_KEY_RULES / _BASE_MODEL_RULES / _GGUF_ARCH_MAP + 测试用例即可。
"""

import json
import os
import re
import struct
from typing import Callable


# ── baseModel 映射 ──────────────────────────────────────────────────────────

# CivitAI baseModel 枚举 → 架构。子串匹配, 按序求值, 先匹配先赢。
# 新增架构在此插入一行即可。
_BASE_MODEL_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("anima", ("anima",)),
    ("krea2", ("krea",)),
    ("sd15", ("sd 1.4", "sd 1.5")),          # 含 "sd 1.5 lcm" / "sd 1.5 hyper" (子串)
    ("sdxl", ("sdxl", "pony", "illustrious", "noobai")),
    # Z-Image / Flux2 baseModel 映射必须在 ("flux", ("flux",)) 之前 —
    # 否则 CivitAI "Flux.2 Klein" 含 "flux" 会被判为 flux1, 污染 Flux 1 tab 下拉
    ("zimage", ("z-image", "z image", "zimage")),
    ("flux2", ("flux.2", "flux 2", "flux2")),
    ("flux", ("flux",)),
    ("sd3", ("sd 3", "sd3")),
]


def arch_from_base_model(base_model: str) -> str:
    """
    CivitAI baseModel 字符串 → 架构。
    baseModel 是 CivitAI 的固定枚举 (如 "SD 1.5" / "SDXL 1.0" / "Pony" / "Anima"
    / "Z-Image Turbo" / "Flux.2 Klein")，sidecar 元数据与下载子文件夹名均为该字符串。
    返回: "sd15" | "sdxl" | "flux" | "flux2" | "sd3" | "anima" | "krea2" | "zimage" | "unknown"
    """
    bm = base_model.strip().lower()
    if not bm:
        return "unknown"
    for arch, keywords in _BASE_MODEL_RULES:
        if any(k in bm for k in keywords):
            return arch
    return "unknown"


# ── 侧路径检测: sidecar / 路径 ──────────────────────────────────────────────

def _detect_arch_from_sidecar(filepath: str) -> str:
    """
    从 CivitAI 下载时保存的 .weilin-info.json sidecar 读取 baseModel 判断架构。
    无 sidecar / 解析失败 / baseModel 未映射时返回 "unknown"。
    """
    try:
        with open(filepath + ".weilin-info.json", encoding="utf-8") as f:
            info = json.load(f)
        return arch_from_base_model(info.get("baseModel", "") or "")
    except (OSError, json.JSONDecodeError):
        return "unknown"


def _detect_arch_from_path(name: str) -> str:
    """
    从模型路径中的 baseModel 子文件夹名推断架构。
    CivitAI 下载时会按 baseModel 创建子文件夹 (如 "SDXL 1.0/model.safetensors")。
    """
    parts = name.replace("\\", "/").split("/")
    if len(parts) < 2:
        return "unknown"
    return arch_from_base_model(parts[0])


# ── safetensors / GGUF header 嗅探 ──────────────────────────────────────────

def _detect_arch_safetensors(filepath: str) -> str:
    """从 safetensors 文件 header 的 tensor key 名称检测架构。"""
    try:
        with open(filepath, "rb") as f:
            header_len = struct.unpack("<Q", f.read(8))[0]
            if header_len <= 0 or header_len > 10_000_000:
                return "unknown"
            raw = f.read(header_len)
        header = json.loads(raw)
        keys = set(k for k in header if k != "__metadata__")
        return match_arch_from_keys(keys)
    except Exception:
        return "unknown"


_GGUF_MAGIC = 0x46554747  # "GGUF" little-endian
_GGUF_ARCH_MAP = {
    "flux": "flux", "sd1": "sd15", "sdxl": "sdxl", "sd3": "sd3",
    "krea2": "krea2",
}


def _detect_arch_gguf(filepath: str) -> str:
    """
    从 GGUF 文件检测架构。
    优先读取 general.architecture 元数据，fallback 到 tensor 名称匹配。
    """
    try:
        with open(filepath, "rb") as f:
            magic = struct.unpack("<I", f.read(4))[0]
            if magic != _GGUF_MAGIC:
                return "unknown"
            _version = struct.unpack("<I", f.read(4))[0]
            tensor_count = struct.unpack("<Q", f.read(8))[0]
            kv_count = struct.unpack("<Q", f.read(8))[0]

            # 读取 metadata key-value 对，寻找 general.architecture
            arch_from_meta = _gguf_scan_metadata(f, kv_count)
            if arch_from_meta and arch_from_meta in _GGUF_ARCH_MAP:
                return _GGUF_ARCH_MAP[arch_from_meta]

            # Fallback: 解析 tensor 名称做特征匹配
            tensor_names = set()
            for _ in range(min(tensor_count, 500)):
                name = _gguf_read_string(f)
                n_dims = struct.unpack("<I", f.read(4))[0]
                f.read(n_dims * 8 + 4 + 8)  # dims + type + offset
                # 去除 model.diffusion_model. 前缀
                if name.startswith("model.diffusion_model."):
                    name = name[len("model.diffusion_model."):]
                tensor_names.add(name)
            return match_arch_from_keys(tensor_names)
    except Exception:
        return "unknown"


def _gguf_read_string(f) -> str:
    """读取 GGUF 格式的 length-prefixed UTF-8 字符串。"""
    length = struct.unpack("<Q", f.read(8))[0]
    if length > 1_000_000:
        raise ValueError("GGUF string too long")
    return f.read(length).decode("utf-8", errors="replace")


def _gguf_skip_value(f, vtype: int):
    """跳过一个 GGUF metadata value (不解析内容)。"""
    _FIXED_SIZES = {
        0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1,
        10: 8, 11: 8, 12: 8,
    }
    if vtype in _FIXED_SIZES:
        f.read(_FIXED_SIZES[vtype])
    elif vtype == 8:  # STRING
        _gguf_read_string(f)
    elif vtype == 9:  # ARRAY
        arr_type = struct.unpack("<I", f.read(4))[0]
        arr_len = struct.unpack("<Q", f.read(8))[0]
        for _ in range(arr_len):
            _gguf_skip_value(f, arr_type)
    else:
        raise ValueError(f"Unknown GGUF value type: {vtype}")


def _gguf_scan_metadata(f, kv_count: int) -> str | None:
    """扫描 GGUF metadata，返回 general.architecture 的值（如果存在）。"""
    for _ in range(kv_count):
        key = _gguf_read_string(f)
        vtype = struct.unpack("<I", f.read(4))[0]
        if key == "general.architecture" and vtype == 8:
            return _gguf_read_string(f)
        _gguf_skip_value(f, vtype)
    return None


# ── tensor key → 架构 (有序规则表) ──────────────────────────────────────────

# ── 架构判别规则表 ────────────────────────────────────────────────────────────
# 每条规则: (架构名, 判定函数)。按顺序求值, 先匹配先赢, 特异性强的规则必须在前。
# 新增架构三步走:
#   1. 找到该架构独有的 tensor key 特征 (以 ComfyUI comfy/model_detection.py 为准)
#   2. 在下表合适位置插入规则 (LoRA 变体规则紧随主模型规则), 注释写明证据来源
#   3. 在 tests/test_arch_detection.py 增加正反用例 (裸格式 / checkpoint 全量打包
#      带 model.diffusion_model. 前缀 / kohya LoRA / diffusers LoRA 四种形态)
#
# LoRA 训练格式全景 (每个架构最多需要三条 LoRA 规则):
#   1. kohya/sd-scripts:     lora_unet_<模块路径下划线>_.lora_down/up
#   2. diffusers/PEFT:       transformer.<模块路径>.lora_A/lora_B
#   3. musubi/ai-toolkit:    diffusion_model.<模块路径>.lora_A/lora_B (comfy 原生路径)
#   靠"架构特有模块名子串 + 前缀"组合判别。

def _has_prefix(keys: set[str], prefix: str) -> bool:
    return any(k.startswith(prefix) for k in keys)


def _has_sub(keys: set[str], sub: str) -> bool:
    return any(sub in k for k in keys)


_ARCH_KEY_RULES: list[tuple[str, "Callable[[set[str]], bool]"]] = [
    # Z-Image / Lumina2 族 (NextDiT): cap_embedder + noise_refiner 双特征
    # (comfy model_detection.py 2026-07-17 master)。comfy 靠张量维度区分原版
    # Lumina2 与 Z-Image, key 名层面同族 — 统一判 zimage (原版 Lumina2 罕见, 可接受)。
    # 放最前 (特征极特异), 必须在 sd15 的 model.diffusion_model. 兜底之前。
    ("zimage", lambda ks: _has_sub(ks, "cap_embedder.") and _has_sub(ks, "noise_refiner.")),
    # Z-Image kohya LoRA: layers.N.attention.* → lora_unet_layers_N_attention_*
    # (待首个真实文件校准, 先按此特征上线并在测试中标注)。
    ("zimage", lambda ks: _has_prefix(ks, "lora_unet_layers_") and _has_sub(ks, "_attention_")),
    # Z-Image musubi/ai-toolkit 格式 LoRA (实测文件 NSFW_master_ZIT_000017532):
    # diffusion_model.layers.N.(attention|adaLN_modulation|feed_forward).*.lora_A/B。
    # layers.N + attention 结构为 Lumina2/Z-Image 族特有 (其余 DiT 用 blocks/transformer_blocks)。
    # 注意 adaLN_modulation 为大写 LN, 与 Anima 小写 adaln_modulation 规则不冲突 (刻意区分)。
    ("zimage", lambda ks: _has_prefix(ks, "diffusion_model.layers.")),
    # Z-Image diffusers/PEFT 格式 LoRA (待真实文件校准): transformer.layers.N.*
    ("zimage", lambda ks: _has_prefix(ks, "transformer.layers.")),
    # Krea2 主模型: SingleStreamDiT 独有 txtfusion.* (ComfyUI model_detection 用
    # txtfusion.projector.weight 判别)。用子串匹配兼容 checkpoint 全量打包的
    # model.diffusion_model.txtfusion.* 前缀 — 必须排在 sd15 的
    # model.diffusion_model. 兜底规则之前。
    ("krea2", lambda ks: _has_sub(ks, "txtfusion.")),
    # Krea2 kohya 格式 LoRA: blocks.N.attn.wq/wk/wv (GQA 分离 QKV) →
    # lora_unet_blocks_N_attn_wq_*。txtfusion 层 LoRA → lora_unet_txtfusion_*。
    # 必须在 Anima 的 lora_unet_blocks_ 规则之前 (前缀相同, 靠模块名区分)。
    ("krea2", lambda ks: _has_prefix(ks, "lora_unet_txtfusion_")
        or (_has_prefix(ks, "lora_unet_blocks_")
            and (_has_sub(ks, "_attn_wq") or _has_sub(ks, "_attn_wk")))),
    # Krea2 diffusers 格式 LoRA: transformer.blocks.N.attn.wq.lora_A.weight
    # (comfy/lora.py 按原生模块路径重映射)。flux 的 diffusers LoRA 前缀是
    # transformer.transformer_blocks. / transformer.single_transformer_blocks.,
    # 不会撞车。
    ("krea2", lambda ks: _has_prefix(ks, "transformer.blocks.")
        and (_has_sub(ks, ".attn.wq") or _has_sub(ks, "txtfusion"))),
    # Anima UNet: 裸格式所有 key 以 net.blocks. 开头 (685 tensors)。
    # civitai 全量打包格式前缀变为 model.diffusion_model.blocks. (无 net. 层)
    # 并附带 cond_stage_model.qwen3_06b + first_stage_model，会误命中 SD1.5 规则，
    # 故统一用小写 adaln_modulation 特征子串判别 (PixArt/DiT 系为大写 adaLN_modulation)
    ("anima", lambda ks: _has_prefix(ks, "net.blocks.") or _has_sub(ks, "adaln_modulation")),
    # Anima LoRA: lora_unet_blocks_<N>_(cross_attn|self_attn|mlp_layer)_*。
    # 收紧为必须含 Anima 特有模块名, 避免吞掉其它 DiT 架构的 kohya LoRA
    # (Krea2 同前缀但模块名是 attn_wq/attn_wk, 已在上方规则先行拦截)。
    ("anima", lambda ks: _has_prefix(ks, "lora_unet_blocks_")
        and (_has_sub(ks, "cross_attn") or _has_sub(ks, "self_attn") or _has_sub(ks, "mlp_layer"))),
    # Flux2: double_stream_modulation_img 为 flux2 独有 (flux1 无)。必须排在
    # flux1 的 double_blocks. 规则之前 — flux2 也可能含 double_stream 前缀。
    ("flux2", lambda ks: _has_sub(ks, "double_stream_modulation_img")),
    # Flux2 kohya LoRA (待校准): 单/双流模块名
    ("flux2", lambda ks: _has_sub(ks, "double_stream_modulation") or _has_prefix(ks, "lora_unet_double_stream_")),
    # ── 以下 flux 规则语义即 flux1 (检测输出用 "flux" 兼容现有 sidecar/缓存) ──
    # Flux1 主模型: double_blocks / single_blocks (保留原位, 在 flux2 规则之后)
    ("flux", lambda ks: _has_prefix(ks, "double_blocks.")),
    # SD3: joint_blocks
    ("sd3", lambda ks: _has_prefix(ks, "joint_blocks.")),
    # SDXL checkpoint: 双 text encoder (conditioner.embedders.1) 或 label_emb
    ("sdxl", lambda ks: _has_prefix(ks, "conditioner.embedders.1.")
        or "model.diffusion_model.label_emb.0.0.weight" in ks
        or "label_emb.0.0.weight" in ks),
    # SDXL alt: UNet 风格 + add_embedding
    ("sdxl", lambda ks: _has_prefix(ks, "add_embedding.")),
    # SD1.5 checkpoint: cond_stage_model / diffusion_model 但无以上任何标记
    ("sd15", lambda ks: _has_prefix(ks, "cond_stage_model.") or _has_prefix(ks, "model.diffusion_model.")
        or _has_prefix(ks, "input_blocks.") or _has_prefix(ks, "down_blocks.")),
    # LoRA 检测: lora_te2 = SDXL, 无 te2 + 有 te1/unet = SD1.5
    ("sdxl", lambda ks: _has_prefix(ks, "lora_te2_")),
    # UNet-only SDXL LoRA (无 te key): transformer_blocks 索引 >=1 仅 SDXL 存在
    # (SD1.5 每个 attention 层只有 1 个 transformer block, 索引恒为 0)
    ("sdxl", lambda ks: _has_prefix(ks, "lora_unet_")
        and any(re.search(r"transformer_blocks_[1-9]", k) for k in ks)),
    # Flux1 kohya LoRA: lora_unet_double_blocks_* / lora_unet_single_blocks_*
    # 必须排在 sd15 的 lora_unet_ 兜底之前 — 现状会误判 sd15! (回归修复)
    ("flux", lambda ks: _has_prefix(ks, "lora_unet_double_blocks_") or _has_prefix(ks, "lora_unet_single_blocks_")),
    # Flux1 diffusers LoRA: transformer.transformer_blocks. /
    # transformer.single_transformer_blocks. (与 krea2 的 transformer.blocks. 前缀不同, 不冲突)
    ("flux", lambda ks: _has_prefix(ks, "transformer.transformer_blocks.") or _has_prefix(ks, "transformer.single_transformer_blocks.")),
    ("sd15", lambda ks: _has_prefix(ks, "lora_te1_") or _has_prefix(ks, "lora_unet_")),
]


def match_arch_from_keys(keys: set[str]) -> str:
    """从 tensor key 名称集合匹配模型架构。规则见 _ARCH_KEY_RULES。"""
    for arch, rule in _ARCH_KEY_RULES:
        if rule(keys):
            return arch
    return "unknown"


# ── 综合检测入口 ─────────────────────────────────────────────────────────────

def detect_arch(filepath: str, name: str = "") -> str:
    """
    检测模型架构，优先级: sidecar 元数据 > 文件 header > 路径子文件夹。
    返回: "sd15" | "sdxl" | "flux" | "flux2" | "sd3" | "anima" | "krea2" | "zimage" | "unknown"

    sidecar baseModel 是 CivitAI 官方枚举，不受打包格式影响，最可靠；
    header 嗅探覆盖无 sidecar 的文件 (rclone 同步/手动上传, 仅 safetensors/GGUF)；
    路径兜底覆盖 header 读不了的格式 (.ckpt 等)。
    """
    result = _detect_arch_from_sidecar(filepath)
    if result != "unknown":
        return result
    if filepath.endswith(".safetensors"):
        result = _detect_arch_safetensors(filepath)
    elif filepath.endswith(".gguf"):
        result = _detect_arch_gguf(filepath)
    if result == "unknown" and name:
        result = _detect_arch_from_path(name)
    return result
