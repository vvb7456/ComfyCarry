"""
comfycarry/services/arch_detect.py
────────────────────────────────────────
架构检测 — 纯 stdlib 模块 (json/struct/os/re/typing)。

从 routes/generate.py 抽出的模型架构检测逻辑:
  - arch_from_base_model: CivitAI baseModel 字符串 → 架构
  - detect_arch: 多源检测 (header > 路径)
  - match_arch_from_keys: 从 safetensors/gguf tensor key 集合判定架构
    (张量结构完全相同, 只能靠文件名区分 — 供下载配对与前端配对复用)

模块可独立测试 (无 flask/COMFYUI_DIR 依赖)。
新增架构: 在 _ARCH_KEY_RULES 按 ComfyUI detect_unet_config 顺序插入规则
+ _BASE_MODEL_RULES (如有 CivitAI 枚举) + 测试用例。

架构判别锚点以 ComfyUI comfy/model_detection.py detect_unet_config() 为准,
覆盖其全部 if 分支 (SD3/Cascade/AuraFlow/HunyuanDiT/HunyuanVideo/Flux系/
Mochi/MiniMax/LTXV/ACE/PixArt/Cosmos/PiD/PixelDiT/Lumina2族/CogVideoX/
SeedVR2/Wan/Hunyuan3D/TripoSplat/HiDream/CosmosPredict2/Anima/Boogu/
OmniGen2/Lens/MageFlow/Qwen/Ideogram4/Krea2/Kandinsky5/ACE1.5/RT-DETR/
DepthAnything3/Ernie/SAM3/JoyImage + UNet fallback SD1.5/SDXL)。
LoRA 训练格式判别 (kohya/diffusers/musubi) 为项目自维护, ComfyUI 不管。

视频架构 (Wan 2.2) 取舍说明:
  t2v/i2v 靠 patch_embedding 输入通道数 (16 vs 36)、14B/5B 靠隐藏维度判别。
   _detect_arch_safetensors 读 header 后把 key 名集合 + 形状传给
   match_arch_from_keys; 无形状时 (裸 key 集合) 退化为
   key 名判别 (img_emb.proj.0.bias 区分 14B i2v vs t2v)。
   GGUF 路径: 5B/i2v 子变体靠 shape 细分 (与 safetensors 同路径),
   t2v (in_dim=16) 与 Wan 2.1 无法区分, 保守返回通用 "wan"。
  设计取舍见 docs/VIDEO_GENERATION_PLAN.md。
"""

import json
import os
import re
import struct
from typing import Callable

# ── baseModel 映射 ──────────────────────────────────────────────────────────

# CivitAI baseModel 枚举 -> 架构。子串匹配, 按序求值, 先匹配先赢。
# 枚举来源: CivitAI /api/v1/enums ActiveBaseModel + BaseModel (2026-08-06 核对, 共 97 项)。
# 新增架构在此插入一行即可。
#
# 视频架构说明:
#   - wan22_i2v / wan22_t2v / wan22_5b: 本期生成条目 (familyOf='wan22')。
#   - wan21 / hunyuan / ltxv: 仅识别与展示, 不进生成。
#     仍映射为独立 arch, 让模型页能正确归类、选择器能同源过滤。
# 特异性强的在前: "wan video 2.2 i2v" / "t2v" / "ti2v-5b" 都含 "wan video 2.2",
# 必须把 5B/I2V/T2V 三条排在通用 "wan video" 之前。
_BASE_MODEL_RULES: list[tuple[str, tuple[str, ...]]] = [
    # ── CivitAI 官方枚举 (ActiveBaseModel) ──────────────────────────────────
    ("anima", ("anima",)),
    ("krea2", ("krea 2",)),               # CivitAI: "Krea 2" (不含 "Flux.1 Krea" -> flux)
    ("sd15", ("sd 1.4", "sd 1.5")),         # 含 "sd 1.5 lcm" / "sd 1.5 hyper" (子串)
    ("sdxl", ("sdxl", "pony", "illustrious", "noobai")),
    # Chroma baseModel 必须在 ("flux", ("flux",)) 之前 - Chroma 是 flux schnell 衍生
    # 但独立架构 (单 T5 + 真 CFG), baseModel "Chroma" 不含 "flux" 关键词, 顺序无冲突,
    # 仍按"特异性强的在前"惯例放置。
    ("chroma", ("chroma",)),
    # Z-Image / Flux2 baseModel 映射必须在 ("flux", ("flux",)) 之前 -
    # 否则 CivitAI "Flux.2 Klein" 含 "flux" 会被判为 flux1, 污染 Flux 1 tab 下拉
    # CivitAI: "ZImageTurbo" / "ZImageBase"
    # 注意: "Lumina" 不再归 zimage - ComfyUI 区分 lumina2 (dim=2304) 与 zimage (dim=3840)
    ("zimage", ("zimage", "z-image", "z image")),
    ("lumina2", ("lumina",)),               # CivitAI: "Lumina" (原版 Lumina 2, dim=2304)
    ("flux2", ("flux.2", "flux 2", "flux2")),
    ("flux", ("flux",)),                     # CivitAI: Flux.1 S/D/Krea/Kontext
    ("sd3", ("sd 3", "sd3")),
    # ── ComfyUI 架构对应的 CivitAI baseModel (合入) ──
    # 顺序: AuraFlow 含 "flux"? 否, "auraflow" 不含 "flux" 子串, 但放 flux 后安全。
    ("auraflow", ("auraflow",)),             # CivitAI: "AuraFlow"
    ("stablecascade", ("stable cascade",)),  # CivitAI: "Stable Cascade"
    ("pixart", ("pixart",)),                 # CivitAI: "PixArt a" / "PixArt E"
    ("mochi", ("mochi",)),                   # CivitAI: "Mochi"
    ("minimax_h3", ("minimax h3",)),         # CivitAI: "MiniMax H3"
    ("boogu", ("boogu",)),                   # CivitAI: "Boogu"
    ("mage_flow", ("mageflow", "mage flow")),  # CivitAI: "MageFlow"
    ("ideogram4", ("ideogram 4", "ideogram4")),  # CivitAI: "Ideogram 4.0"
    # ── 视频架构 - 顺序敏感: 2.2 具体条目在通用 wan 之前 ──
    # Wan 2.2 三条目 (本期生成)。baseModel 取自 Civitai 枚举原文。
    ("wan22_i2v", ("wan video 2.2 i2v-a14b",)),
    ("wan22_t2v", ("wan video 2.2 t2v-a14b",)),
    ("wan22_5b", ("wan video 2.2 ti2v-5b",)),
    # Wan 2.2 通用件 (VAE/TE 等): "Wan Video 2.2" 不含 i2v/t2v/5b 关键词,
    # 必须在 "wan video 14b"/"wan video" 之前, 否则被 wan21 吃掉。
    ("wan22", ("wan video 2.2",)),
    # Wan 2.5/2.7: 闭源 API, 无开源权重, 社区不会有 LoRA, 仅识别标记。
    # 必须在通用 "wan video" 之前 - 否则 "Wan Video 2.5 I2V" 含 "wan video" 会先命中 wan21。
    ("wan", ("wan video 2.5", "wan video 2.7", "wan image 2.7")),
    # Wan 2.1 仅兼容检测。Civitai 枚举: "Wan Video 14B t2v" /
    # "Wan Video 14B i2v 480p/720p" / "Wan Video 1.3B t2v" / "Wan Video" (clip/VAE 件)。
    # 不细分 i2v/t2v - 2.1 全系不进生成, 识别到 wan21 一档即可。
    ("wan21", ("wan video 14b", "wan video 1.3b", "wan video")),
    # Hunyuan Video: Civitai 枚举 "Hunyuan Video"。
    ("hunyuan", ("hunyuan video",)),
    # Hunyuan 1 (HunyuanImage, 图像架构; CivitAI 枚举 "Hunyuan 1")
    ("hunyuanimage", ("hunyuan 1", "hunyuanimage", "hunyuan image")),
    # LTXV: Civitai 枚举 "LTXV 2.3" / "LTXV2" / "LTXV"。
    # 2.3 与旧 0.9.x 合并识别 - 旧版衰退中, 不值得拆条目。
    ("ltxv", ("ltxv 2.3", "ltxv2", "ltxv")),
    # CogVideoX: CivitAI 枚举 "CogVideoX"
    ("cogvideox", ("cogvideox",)),
    # HiDream: CivitAI 枚举 "HiDream" / "HiDream-O1"
    ("hidream", ("hidream",)),
    # Ernie: CivitAI 枚举 "Ernie"
    ("ernie", ("ernie",)),
    # Lens: CivitAI 枚举 "Lens"
    ("lens", ("lens",)),
    # Qwen 3.5 必须在通用 qwen 之前 ("Qwen 3.5" 含 "qwen")
    ("qwen35", ("qwen 3.5", "qwen3.5")),
    # Qwen: CivitAI 枚举 "Qwen" / "Qwen 2"
    ("qwen", ("qwen",)),
    # ACE Audio: CivitAI 枚举 "ACE Audio"
    ("acestep", ("ace audio", "ace-step", "ace step")),
    # SVD: CivitAI 枚举 "SVD" / "SVD XT"
    ("svd", ("svd", "stable video")),
    # Hunyuan3D: CivitAI 枚举 "Hunyuan3D"
    ("hunyuan3d", ("hunyuan3d", "hunyuan 3d")),
    # ── HF 白名单独有 (CivitAI 枚举无, 自拟 baseModel 名) ──────────────────
    ("stableaudio", ("stable audio",)),
    ("kandinsky5", ("kandinsky",)),
    ("longcat", ("longcat",)),
    ("pixeldit", ("pixeldit", "pixel dit")),
    ("newbie", ("newbie",)),
    ("ovis", ("ovis",)),
    ("omnigen2", ("omnigen2", "omnigen 2")),
    ("triposplat", ("triposplat",)),
    ("lotus", ("lotus",)),
    ("rtdetr", ("rt-detr", "rt detr")),
    ("realesrgan", ("realesrgan", "real-esrgan", "real esrgan")),
    ("esrgan", ("esrgan",)),
    ("t5", ("t5",)),
    ("sam3", ("sam 3", "sam3")),
    ("sdpose", ("sdpose",)),
]


def arch_from_base_model(base_model: str) -> str:
    """
    CivitAI baseModel 字符串 → 架构。
    baseModel 是 CivitAI 的固定枚举 (如 "SD 1.5" / "SDXL 1.0" / "Pony" / "Anima"
    / "Z-Image Turbo" / "Flux.2 Klein" / "Wan Video 2.2 I2V-A14B" / "Hunyuan Video"
    / "LTXV 2.3")，下载子文件夹名沿用该字符串。
    返回: "sd15" | "sdxl" | "flux" | "flux2" | "sd3" | "anima" | "krea2" | "zimage"
          | "chroma" | "chroma_radiance" | "lumina2" | "wan22_i2v" | "wan22_t2v"
          | "wan22_5b" | "wan22" | "wan21" | "wan" | "hunyuan" | "hunyuanimage"
          | "ltxv" | "cogvideox" | "hidream" | "ernie" | "lens" | "qwen"
          | "acestep" | "ace1.5" | "svd" | "hunyuan3d" | "stableaudio"
          | "kandinsky5" | "longcat" | "pixeldit" | "newbie" | "esrgan"
          | "realesrgan" | "t5" | "qwen35" | "sam3" | "sdpose"
          | "stablecascade" | "auraflow" | "hydit" | "mochi" | "minimax_h3"
          | "pixart" | "cosmos" | "pid" | "seedvr2" | "boogu" | "mage_flow"
          | "ideogram4" | "depthanything3" | "sam3" | "joyimage"
          | "cosmos_predict2" | "ovis" | "unknown"
    """
    bm = base_model.strip().lower()
    if not bm:
        return "unknown"
    for arch, keywords in _BASE_MODEL_RULES:
        if any(k in bm for k in keywords):
            return arch
    return "unknown"


# ── 路径检测 ────────────────────────────────────────────────────────────────
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
    """从 safetensors 文件 header 的 tensor key 名称 + 形状检测架构。

    形状用于 Wan 2.2 三条目细分 (patch_embedding 输入通道 16/36/48 区分
    t2v/i2v/5B, head.modulation 隐藏维度 5120/3072 区分 14B/5B); 旧架构规则
    只看 key 名, 形状对它们是 no-op。
    """
    try:
        with open(filepath, "rb") as f:
            header_len = struct.unpack("<Q", f.read(8))[0]
            if header_len <= 0 or header_len > 10_000_000:
                return "unknown"
            raw = f.read(header_len)
        header = json.loads(raw)
        keys = set(k for k in header if k != "__metadata__")
        # safetensors header 每个张量: {"shape": [...], "dtype": "...", ...}
        # 仅提取形状 (规则只用到 patch_embedding / head.modulation 这两个锚点)。
        shapes = {}
        for k in keys:
            info = header.get(k)
            if isinstance(info, dict) and "shape" in info:
                shapes[k] = tuple(info["shape"])
        return match_arch_from_keys(keys, shapes)
    except Exception:
        return "unknown"


_GGUF_MAGIC = 0x46554747  # "GGUF" little-endian
# GGUF general.architecture 元数据值 -> 架构。
# 来源: ComfyUI-GGUF (city96) loader.py IMG_ARCH_LIST。
# GGUF 元数据只标大类 (如 "wan"), 子变体 (i2v/t2v/5B) 靠 tensor shape 细分,
# 与 safetensors 完全同路径 (ComfyUI loader 也是解量化后走 detect_unet_config)。
_GGUF_ARCH_MAP = {
    "flux": "flux", "sd1": "sd15", "sdxl": "sdxl", "sd3": "sd3",
    "aura": "auraflow", "hidream": "hidream", "cosmos": "cosmos",
    "ltxv": "ltxv", "hyvid": "hunyuan", "wan": "wan",
    "lumina2": "lumina2", "qwen_image": "qwen",
}


def _detect_arch_gguf(filepath: str) -> str:
    """从 GGUF 文件检测架构。

    与 ComfyUI-GGUF loader 一致: 读 tensor info 区拿 key 名 + shape,
    传给 match_arch_from_keys, 与 safetensors 走同一条判别路径。
    shape 来源: tensor info 区的 n_dims + dims (反转得 torch shape)。
    被 reshape 的 tensor 另有 comfy.gguf.orig_shape.{key} 元数据 (ARRAY of INT32)。
    """
    try:
        with open(filepath, "rb") as f:
            magic = struct.unpack("<I", f.read(4))[0]
            if magic != _GGUF_MAGIC:
                return "unknown"
            _version = struct.unpack("<I", f.read(4))[0]
            tensor_count = struct.unpack("<Q", f.read(8))[0]
            kv_count = struct.unpack("<Q", f.read(8))[0]

            # 1. 扫描 metadata: 取 general.architecture + orig_shape 数组
            arch_meta, orig_shapes = _gguf_scan_metadata(f, kv_count)

            # 2. 读 tensor info 区: key 名 + shape (dims 反转)
            keys: set[str] = set()
            shapes: dict[str, tuple] = {}
            for _ in range(min(tensor_count, 2000)):
                name = _gguf_read_string(f)
                n_dims = struct.unpack("<I", f.read(4))[0]
                if n_dims > 8:
                    raise ValueError(f"GGUF tensor n_dims too large: {n_dims}")
                dims = [struct.unpack("<Q", f.read(8))[0] for _ in range(n_dims)]
                _type = struct.unpack("<I", f.read(4))[0]
                _offset = struct.unpack("<Q", f.read(8))[0]
                # 去除 model.diffusion_model. 前缀 (与 ComfyUI-GGUF loader 一致)
                short = name
                if short.startswith("model.diffusion_model."):
                    short = short[len("model.diffusion_model."):]
                keys.add(short)
                # torch shape = reversed(dims); 0 维 (标量) 为空 tuple
                shape = tuple(reversed(dims))
                # orig_shape 优先 (被 reshape 的 tensor 的原始形状)
                orig = orig_shapes.get(name) or orig_shapes.get(short)
                if orig is not None:
                    shape = orig
                if shape:
                    shapes[short] = shape

            # 3. 判别
            if arch_meta and arch_meta in _GGUF_ARCH_MAP:
                base = _GGUF_ARCH_MAP[arch_meta]
                if base == "wan":
                    # Wan GGUF: 元数据只有 "wan" 大类, 2.1/2.2 t2v 的 in_dim 均为 16
                    # 无法区分。但 5B (in_dim>=40) 与 i2v (in_dim=36) shape 可明确区分,
                    # 优先用 shape 细分; t2v 或无 shape 时保守返回通用 wan。
                    sub = match_arch_from_keys(keys, shapes)
                    if sub in ("wan22_5b", "wan22_i2v"):
                        return sub
                    return "wan"
                return base
            return match_arch_from_keys(keys, shapes)
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


def _gguf_scan_metadata(f, kv_count: int) -> tuple[str | None, dict[str, tuple]]:
    """扫描 GGUF metadata, 返回 (general.architecture, {tensor_name: orig_shape})。

    orig_shape 来源 comfy.gguf.orig_shape.{tensor_name} 元数据 (ARRAY of INT32),
    city96 转换器在 reshape tensor 时写入, loader 据此恢复原始 torch shape。
    形状已反转回 torch 顺序 (loader 同样做法)。
    """
    arch = None
    orig_shapes: dict[str, tuple] = {}
    PREFIX = "comfy.gguf.orig_shape."
    for _ in range(kv_count):
        key = _gguf_read_string(f)
        vtype = struct.unpack("<I", f.read(4))[0]
        if key == "general.architecture" and vtype == 8:
            arch = _gguf_read_string(f)
            continue
        if key.startswith(PREFIX) and vtype == 9:
            arr_type = struct.unpack("<I", f.read(4))[0]
            arr_len = struct.unpack("<Q", f.read(8))[0]
            if arr_type == 5:  # INT32
                dims = []
                for _ in range(arr_len):
                    dims.append(struct.unpack("<I", f.read(4))[0])
                tname = key[len(PREFIX):]
                orig_shapes[tname] = tuple(reversed(dims))
            else:
                # 数组头 (arr_type+arr_len) 已消费, 直接按元素类型跳过,
                # 不能调 _gguf_skip_value(f, 9) — 那会再读一次数组头导致 KV 流错位
                for _ in range(arr_len):
                    _gguf_skip_value(f, arr_type)
            continue
        _gguf_skip_value(f, vtype)
    return arch, orig_shapes


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
#
# 判定函数签名: (keys, shapes) → bool
#   keys:   tensor key 名集合 (旧规则只用这个)
#   shapes: 可选 {key_name: shape_tuple} (safetensors header 解析得到; GGUF 裸 key
#           回退时为 None)。Wan 2.2 三条目细分依赖 shapes — head.modulation 隐藏
#           维度 (14B=5120 / 5B=3072) 与 patch_embedding 输入通道 (t2v=16 / i2v=36 /
#           5B=48) 在 key 名层面同构, 必须靠形状区分。无 shapes 时 Wan 规则退化为
#           key 名判别 (img_emb.proj.0.bias 区分 14B i2v vs t2v), 5B 无法与 14B-t2v
#           区分 → 由 detect_arch 的文件名兜底 (_wan_subvariant_from_filename) 兜住。

def _has_prefix(keys: set[str], prefix: str) -> bool:
    return any(k.startswith(prefix) for k in keys)


def _has_sub(keys: set[str], sub: str) -> bool:
    return any(sub in k for k in keys)


def _shape_of(shapes: dict | None, key: str) -> tuple | None:
    """安全取一个 tensor 的形状; shapes 为 None 或缺 key 时返回 None。

    先精确查, 再回退到"以 key 结尾"的查找 — Wan 14B 全量打包件 key 前缀为
    model.diffusion_model., 但规则里用裸 patch_embedding.weight 等锚点名匹配,
    形状表里存的是带前缀的全名, 故需后缀回退。
    """
    if not shapes:
        return None
    if key in shapes:
        return shapes[key]
    # 后缀回退: 找一个以该 key 结尾的形状 (兼容 model.diffusion_model. 前缀打包件)
    for k, v in shapes.items():
        if k == key or k.endswith("." + key):
            return v
    return None


def _is_wan_model(keys: set[str]) -> bool:
    """Wan 2.1/2.2 全系共有的锚点: head.modulation (comfy model_detection.py:670)。
    该 key 在本项目已支持的图像架构中独有 (zimage 用 cap_embedder/noise_refiner,
    flux 用 double_blocks, anima 用 net.blocks.), 是 Wan 嗅探的可靠入口。
    兼容 checkpoint 全量打包的 model.diffusion_model.head.modulation 前缀。"""
    return _has_sub(keys, "head.modulation")


def _has_suffix(keys: set[str], key: str, suffixes: tuple[str, ...] = ("weight", "scale")) -> bool:
    """检查 keys 中是否存在 key+suffix 的任一组合 (对齐 ComfyUI any_suffix_in)。

    ComfyUI 部分架构 (chroma/flux) 的 norm 层参数可能是 .weight 或 .scale,
    用此函数兼容两种后缀。精确匹配 key+suffix (非子串), 兼容 model.diffusion_model. 前缀。
    """
    for suf in suffixes:
        full = f"{key}{suf}"
        if full in keys:
            return True
        # 兼容打包前缀: model.diffusion_model.xxx.weight
        for k in keys:
            if k == full or k.endswith("." + full):
                return True
    return False


def _is_lora(keys: set[str]) -> bool:
    """检测文件是否为 LoRA (而非主模型权重)。
    LoRA 文件的 tensor key 含 lora_down/lora_up (kohya) 或 lora_A/lora_B (diffusers)
    或 .alpha (rank 标量)。主模型权重不含这些。"""
    return (_has_sub(keys, "lora_down") or _has_sub(keys, "lora_A")
            or _has_sub(keys, "lora_B") or _has_sub(keys, ".alpha"))


# ── 架构判别规则表 (以 ComfyUI comfy/model_detection.py detect_unet_config 为准) ──
# 每条规则: (架构名, 判定函数)。按顺序求值, 先匹配先赢。
# 顺序严格对齐 ComfyUI detect_unet_config() 的 if 分支顺序, 确保特异性与上游一致。
#
# 新增架构三步走:
#   1. 在 ComfyUI comfy/model_detection.py 找到对应 if 分支的入口判别 key
#   2. 在下表对应位置插入规则, 注释写明 ComfyUI 源码行号
#   3. 补测试用例
#
# LoRA 训练格式 (ComfyUI 不管 LoRA, 以下为项目自维护):
#   1. kohya/sd-scripts:     lora_unet_<模块路径下划线>_.lora_down/up
#   2. diffusers/PEFT:       transformer.<模块路径>.lora_A/lora_B
#   3. musubi/ai-toolkit:    diffusion_model.<模块路径>.lora_A/lora_B
#
# 判定函数签名: (keys, shapes) -> bool
#   keys:   tensor key 名集合
#   shapes: 可选 {key_name: shape_tuple} (safetensors header 解析得到; GGUF 裸 key
#           回退时为 None)。Wan 2.2 三条目细分 + Lumina2/Z-Image dim 区分 +
#           Mage-Flow / LongCat 形状判据依赖 shapes。

_ARCH_KEY_RULES: list[tuple[str, "Callable[[set[str], dict | None], bool]"]] = [
    # ── Wan 2.2 视频系 (ComfyUI detect_unet_config: head.modulation, ~L699)
    #    必须前置: 14B 打包件附带 cond_stage_model 会被 sd15 兜底误吞。
    #    t2v/i2v/5B 靠 patch_embedding 输入通道形状区分。
    #    5B VAE (Wan2.2_VAE, 16×16×4) 与 14B VAE (Wan2.1_VAE, 4×8×8) 不兼容,
    #    必须区分 (musubi-tuner 官方文档确认)。
    ("wan22_5b", lambda ks, sh: _is_wan_model(ks)
        and _shape_of(sh, "patch_embedding.weight") is not None
        and _shape_of(sh, "patch_embedding.weight")[1] >= 40),
    ("wan22_i2v", lambda ks, sh: _is_wan_model(ks)
        and _shape_of(sh, "patch_embedding.weight") is not None
        and _shape_of(sh, "patch_embedding.weight")[1] == 36),
    ("wan22_t2v", lambda ks, sh: _is_wan_model(ks)
        and _shape_of(sh, "patch_embedding.weight") is not None
        and _shape_of(sh, "patch_embedding.weight")[1] == 16),
    # 无形状退化 (GGUF / 裸 key): img_emb.proj.0.bias 区分 i2v
    ("wan22_i2v", lambda ks, sh: _is_wan_model(ks)
        and _has_sub(ks, "img_emb.proj.0")),
    ("wan", lambda ks, sh: _is_wan_model(ks)),
    # Wan kohya LoRA: lora_unet_blocks_N_(self_attn|cross_attn|ffn)_*
    # 注意: 部分社区 LoRA 只训练 self_attn+ffn 不含 cross_attn, 不能要求 cross_attn
    # (否则会漏到 anima LoRA 规则被误判)。self_attn+ffn 已足够区分 Wan 与 anima
    # (anima 用 mlp_layer 而非 ffn)。
    ("wan", lambda ks, sh: _has_prefix(ks, "lora_unet_blocks_")
        and _has_sub(ks, "_self_attn_") and _has_sub(ks, "_ffn_")),
    # Wan musubi/ai-toolkit LoRA
    ("wan", lambda ks, sh: _has_prefix(ks, "diffusion_model.blocks.")
        and _has_sub(ks, ".self_attn.") and _has_sub(ks, ".cross_attn.")),

    # ── SD3 / MMDIT (ComfyUI L47: joint_blocks.0.context_block.attn.qkv.weight) ──
    ("sd3", lambda ks, sh: _has_sub(ks, "joint_blocks.0.context_block.attn.qkv.weight")),

    # ── Stable Cascade (ComfyUI L88: clf.1.weight) ──
    ("stablecascade", lambda ks, sh: _has_sub(ks, "clf.1.weight")),

    # ── Stable Audio (ComfyUI L116: transformer.rotary_pos_emb.inv_freq) ──
    ("stableaudio", lambda ks, sh: _has_sub(ks, "transformer.rotary_pos_emb.inv_freq")),

    # ── AuraFlow (ComfyUI L160: double_layers.0.attn.w1q.weight) ──
    ("auraflow", lambda ks, sh: _has_sub(ks, "double_layers.0.attn.w1q.weight")),

    # ── Hunyuan DiT 图像 (ComfyUI L170: mlp_t5.0.weight; 非 HunyuanVideo) ──
    ("hydit", lambda ks, sh: _has_sub(ks, "mlp_t5.0.weight")),

    # ── HunyuanVideo (ComfyUI L183: txt_in.individual_token_refiner.blocks.0.norm1.weight) ──
    ("hunyuan", lambda ks, sh: _has_sub(ks, "txt_in.individual_token_refiner.blocks.0.norm1.weight")),

    # ── Flux 系 (ComfyUI L235 入口: double_blocks.0.img_attn.norm.key_norm. [weight|scale]
    #    + img_in.weight 或 distilled_guidance_layer) ──
    # ── Flux 系 (ComfyUI L235 入口: double_blocks.0.img_attn.norm.key_norm. [weight|scale]
    #    AND (img_in.weight OR distilled_guidance_layer.norms.0. [weight|scale]))
    #    入口条件统一判 Flux/Chroma/ChromaRadiance, 内部再分叉 ──
    # Flux2 (ComfyUI L237: double_stream_modulation_img.lin.weight)
    ("flux2", lambda ks, sh: _has_suffix(ks, "double_blocks.0.img_attn.norm.key_norm.")
        and (_has_sub(ks, "img_in.weight") or _has_suffix(ks, "distilled_guidance_layer.norms.0."))
        and _has_sub(ks, "double_stream_modulation_img.lin.weight")),
    # Chroma Radiance (ComfyUI L300: chroma + nerf_blocks.0.norm. [weight|scale])
    ("chroma_radiance", lambda ks, sh: _has_suffix(ks, "double_blocks.0.img_attn.norm.key_norm.")
        and _has_suffix(ks, "distilled_guidance_layer.norms.0.")
        and _has_suffix(ks, "nerf_blocks.0.norm.")),
    # Chroma (ComfyUI L291: distilled_guidance_layer.{0.}norms.0. [weight|scale])
    ("chroma", lambda ks, sh: _has_suffix(ks, "double_blocks.0.img_attn.norm.key_norm.")
        and (_has_suffix(ks, "distilled_guidance_layer.0.norms.0.")
             or _has_suffix(ks, "distilled_guidance_layer.norms.0."))),
    # Ovis (ComfyUI L322: yak_mlp = double_blocks + img_mlp.gate_proj)
    ("ovis", lambda ks, sh: _has_sub(ks, "double_blocks.")
        and _has_sub(ks, "img_mlp.gate_proj")),
    # LongCat (ComfyUI L326: context_in_dim==3584 via txt_in.weight shape, vec_in None)
    ("longcat", lambda ks, sh: _has_sub(ks, "double_blocks.")
        and _shape_of(sh, "txt_in.weight") is not None
        and _shape_of(sh, "txt_in.weight")[1] == 3584),
    # Flux1 主模型 (ComfyUI L235 入口: double_blocks.0.img_attn.norm.key_norm. [weight|scale]
    #    AND img_in.weight)
    ("flux", lambda ks, sh: _has_suffix(ks, "double_blocks.0.img_attn.norm.key_norm.")
        and _has_sub(ks, "img_in.weight")),
    # Flux1 LoRA (项目自维护, ComfyUI 不管 LoRA)
    ("flux2", lambda ks, sh: _has_sub(ks, "double_stream_modulation")
        or _has_prefix(ks, "lora_unet_double_stream_")),
    ("flux", lambda ks, sh: _has_prefix(ks, "lora_unet_double_blocks_")
        or _has_prefix(ks, "lora_unet_single_blocks_")),
    ("flux", lambda ks, sh: (_has_prefix(ks, "transformer.transformer_blocks.")
        or _has_prefix(ks, "transformer.single_transformer_blocks."))
        and not _has_sub(ks, "add_k_proj")),  # 排除 Qwen Image diffusers LoRA

    # ── Mochi (ComfyUI L331: t5_yproj.weight) ──
    ("mochi", lambda ks, sh: _has_sub(ks, "t5_yproj.weight")),

    # ── MiniMax H3 (ComfyUI L362: video_patch_proj + audio_patch_proj) ──
    ("minimax_h3", lambda ks, sh: _has_sub(ks, "video_patch_proj.weight")
        and _has_sub(ks, "audio_patch_proj.weight")),

    # ── LTXV (ComfyUI L391: adaln_single.emb.timestep_embedder.linear_1.bias)
    #    排除 PixArt diffusers (同时含 pos_embed.proj.bias -> ComfyUI return None) ──
    ("ltxv", lambda ks, sh: _has_sub(ks, "adaln_single.emb.timestep_embedder.linear_1.bias")
        and not _has_sub(ks, "pos_embed.proj.bias")),

    # ── ACE-Step 音频 (ComfyUI L402: genre_embedder.weight) ──
    ("acestep", lambda ks, sh: _has_sub(ks, "genre_embedder.weight")
        or (_has_prefix(ks, "decoder.layers.") and _has_sub(ks, "scale_shift_table"))),

    # ── PixArt (ComfyUI L427: t_block.1.weight) ──
    ("pixart", lambda ks, sh: _has_sub(ks, "t_block.1.weight")),

    # ── Cosmos (ComfyUI L454: blocks.block0.blocks.0.block.attn.to_q.0.weight) ──
    ("cosmos", lambda ks, sh: _has_sub(ks, "blocks.block0.blocks.0.block.attn.to_q.0.weight")),

    # ── PiD (ComfyUI L500: lq_proj.latent_proj.0.weight) ──
    ("pid", lambda ks, sh: _has_sub(ks, "lq_proj.latent_proj.0.weight")),

    # ── PixelDiT (ComfyUI L544: core.pixel_embedder.proj.weight) ──
    ("pixeldit", lambda ks, sh: _has_sub(ks, "core.pixel_embedder.proj.weight")),

    # ── Lumina2 族 (ComfyUI L547 入口: cap_embedder.1.weight + noise_refiner.0.attention.k_norm.weight)
    #    靠 dim (cap_embedder.1.weight shape[0]) 与额外 key 分叉 ──
    # NewBie (ComfyUI L566: + clip_text_pooled_proj.0.weight)
    ("newbie", lambda ks, sh: _has_sub(ks, "cap_embedder.1.weight")
        and _has_sub(ks, "noise_refiner.0.attention.k_norm.weight")
        and _has_sub(ks, "clip_text_pooled_proj")),
    # Lumina2 (ComfyUI L558: dim==2304, 无 clip_text_pooled_proj)
    ("lumina2", lambda ks, sh: _has_sub(ks, "cap_embedder.1.weight")
        and _has_sub(ks, "noise_refiner.0.attention.k_norm.weight")
        and _shape_of(sh, "cap_embedder.1.weight") is not None
        and _shape_of(sh, "cap_embedder.1.weight")[0] == 2304),
    # Z-Image pixel 变体 (ComfyUI L589: + dec_net.cond_embed.weight)
    ("zimage", lambda ks, sh: _has_sub(ks, "cap_embedder.1.weight")
        and _has_sub(ks, "noise_refiner.0.attention.k_norm.weight")
        and _has_sub(ks, "dec_net.cond_embed.weight")),
    # Z-Image (ComfyUI L569: dim==3840 或无 shape)
    ("zimage", lambda ks, sh: _has_sub(ks, "cap_embedder.1.weight")
        and _has_sub(ks, "noise_refiner.0.attention.k_norm.weight")),
    # Z-Image LoRA (ComfyUI 不管, 项目自维护)
    ("zimage", lambda ks, sh: _has_prefix(ks, "lora_unet_layers_") and _has_sub(ks, "_attention_")),
    ("zimage", lambda ks, sh: _has_prefix(ks, "diffusion_model.layers.")),
    ("zimage", lambda ks, sh: _has_prefix(ks, "transformer.layers.")),

    # ── CogVideoX (ComfyUI L613: blocks.0.norm1.linear.weight) ──
    ("cogvideox", lambda ks, sh: "blocks.0.norm1.linear.weight" in ks),

    # ── SeedVR2 (ComfyUI L661/675/688: 三种变体) ──
    ("seedvr2", lambda ks, sh: _has_sub(ks, "blocks.35.mlp.vid.proj_out.weight")
        or _has_sub(ks, "blocks.35.mlp.all.proj_in_gate.weight")
        or _has_sub(ks, "blocks.31.mlp.all.proj_in_gate.weight")),

    # ── Hunyuan3D (ComfyUI L755: latent_in.weight; L770: t_embedder.mlp.2 + attn1.k_norm) ──
    ("hunyuan3d", lambda ks, sh: _has_sub(ks, "latent_in.weight")
        or (_has_sub(ks, "t_embedder.mlp.2.weight")
            and _has_sub(ks, "blocks.0.attn1.k_norm.weight"))),

    # ── TripoSplat (ComfyUI L783: cam_out_layer + repo_layers.0.final_map) ──
    ("triposplat", lambda ks, sh: _has_sub(ks, "cam_out_layer.weight")
        and _has_sub(ks, "repo_layers.0.final_map.weight")),

    # ── HiDream-O1 (ComfyUI L786: t_embedder1.mlp.0 + x_embedder.proj1) ──
    ("hidream", lambda ks, sh: _has_sub(ks, "t_embedder1.mlp.0.weight")
        and _has_sub(ks, "x_embedder.proj1.weight")),
    # ── HiDream (ComfyUI L789: caption_projection.0.linear.weight) ──
    ("hidream", lambda ks, sh: _has_sub(ks, "caption_projection.0.linear.weight")
        or _has_sub(ks, "t_embedder1.mlp.")
        or _has_prefix(ks, "model.final_layer2.")
        or _has_prefix(ks, "model.t_embedder1.")),

    # ── Cosmos Predict2 / Anima (ComfyUI L808: 共用入口 blocks.0.mlp.layer1.weight)
    #    Anima 多 llm_adapter.blocks.0.cross_attn.q_proj.weight ──
    ("anima", lambda ks, sh: _has_sub(ks, "blocks.0.mlp.layer1.weight")
        and _has_sub(ks, "llm_adapter.blocks.0.cross_attn.q_proj.weight")),
    ("cosmos_predict2", lambda ks, sh: _has_sub(ks, "blocks.0.mlp.layer1.weight")),
    # Anima 旧版兼容 (net.blocks. 前缀)
    ("anima", lambda ks, sh: _has_prefix(ks, "net.blocks.")),
    # Anima LoRA
    ("anima", lambda ks, sh: _has_prefix(ks, "lora_unet_blocks_")
        and (_has_sub(ks, "cross_attn") or _has_sub(ks, "self_attn") or _has_sub(ks, "mlp_layer"))),

    # ── Boogu (ComfyUI L862: double_stream_layers.0.img_instruct_attn.processor.img_to_q) ──
    ("boogu", lambda ks, sh: _has_sub(ks, "double_stream_layers.0.img_instruct_attn.processor.img_to_q.weight")),

    # ── OmniGen2 (ComfyUI L872: time_caption_embed.timestep_embedder.linear_1.bias) ──
    ("omnigen2", lambda ks, sh: _has_sub(ks, "time_caption_embed.timestep_embedder.linear_1.bias")
        or _has_prefix(ks, "ref_image_refiner.")
        or _has_sub(ks, "image_index_embedding")),

    # ── Lens (ComfyUI L892: transformer_blocks.0.attn.norm_added_q + img_mlp.w1) ──
    ("lens", lambda ks, sh: _has_sub(ks, "transformer_blocks.0.attn.norm_added_q.weight")
        and _has_sub(ks, "transformer_blocks.0.img_mlp.w1.weight")),

    # ── Mage-Flow (ComfyUI L916: txt_norm + proj_out + shape 2560/128) ──
    ("mage_flow", lambda ks, sh: _has_sub(ks, "txt_norm.weight")
        and _has_sub(ks, "proj_out.weight")
        and _shape_of(sh, "txt_norm.weight") is not None
        and _shape_of(sh, "txt_norm.weight")[0] == 2560
        and _shape_of(sh, "proj_out.weight") is not None
        and _shape_of(sh, "proj_out.weight")[0] == 128),

    # ── Qwen Image (ComfyUI L923: txt_norm.weight) ──
    #    必须在 Mage-Flow 之后 (Mage-Flow 也有 txt_norm 但靠 shape 区分)
    ("qwen", lambda ks, sh: _has_sub(ks, ".img_mod.") and _has_sub(ks, ".txt_mod.")
        and _has_sub(ks, "txt_norm") and not _is_lora(ks)),

    # ── Ideogram 4 (ComfyUI L935: embed_image_indicator.weight) ──
    ("ideogram4", lambda ks, sh: _has_sub(ks, "embed_image_indicator.weight")),

    # ── Krea 2 (ComfyUI L942: txtfusion.projector.weight) ──
    ("krea2", lambda ks, sh: _has_sub(ks, "txtfusion.")),
    ("krea2", lambda ks, sh: _has_prefix(ks, "lora_unet_txtfusion_")
        or (_has_prefix(ks, "lora_unet_blocks_")
            and (_has_sub(ks, "_attn_wq") or _has_sub(ks, "_attn_wk")))),
    ("krea2", lambda ks, sh: _has_prefix(ks, "transformer.blocks.")
        and (_has_sub(ks, ".attn.wq") or _has_sub(ks, "txtfusion"))),

    # ── Kandinsky 5 (ComfyUI L957: visual_transformer_blocks.0.cross_attention.key_norm) ──
    ("kandinsky5", lambda ks, sh: _has_sub(ks, "visual_transformer_blocks.0.cross_attention.key_norm.weight")
        or (_has_prefix(ks, "visual_transformer_blocks.")
            and _has_prefix(ks, "pooled_text_embeddings."))),

    # ── ACE 1.5 (ComfyUI L975: encoder.lyric_encoder; 与 ACE-Step 不同) ──
    ("ace1.5", lambda ks, sh: _has_sub(ks, "encoder.lyric_encoder.layers.0.input_layernorm.weight")),

    # ── RT-DETR v4 (ComfyUI L989: encoder.pan_blocks.1.cv4.conv.weight) ──
    ("rtdetr", lambda ks, sh: _has_sub(ks, "encoder.pan_blocks.1.cv4.conv.weight")
        or _has_sub(ks, "sampling_offsets")
        or _has_prefix(ks, "decoder.dec_bbox_head")),

    # ── DepthAnything3 (ComfyUI L996: backbone.embeddings.patch_embeddings.projection) ──
    ("depthanything3", lambda ks, sh: _has_sub(ks, "backbone.embeddings.patch_embeddings.projection.weight")),

    # ── Ernie Image (ComfyUI L1084: layers.0.mlp.linear_fc2.weight) ──
    ("ernie", lambda ks, sh: "layers.0.mlp.linear_fc2.weight" in ks
        or _has_sub(ks, "adaLN_mlp_ln") or _has_sub(ks, "adaLN_sa_ln")),

    # ── SAM3 / SAM3.1 (ComfyUI L1089: detector.backbone.vision_backbone.trunk) ──
    ("sam3", lambda ks, sh: _has_sub(ks, "detector.backbone.vision_backbone.trunk.blocks.0.attn.qkv.weight")),

    # ── JoyImage (ComfyUI L1097: double_blocks.0.attn.img_attn_qkv + img_attn_q_norm
    #    + condition_embedder.time_embedder + img_in 5D) ──
    ("joyimage", lambda ks, sh: _has_sub(ks, "double_blocks.0.attn.img_attn_qkv.weight")
        and _has_sub(ks, "double_blocks.0.attn.img_attn_q_norm.weight")
        and _has_sub(ks, "condition_embedder.time_embedder.linear_1.weight")),

    # ── SDXL (ComfyUI UNet fallback: label_emb / add_embedding / conditioner.embedders) ──
    ("sdxl", lambda ks, sh: _has_prefix(ks, "conditioner.embedders.1.")
        or "model.diffusion_model.label_emb.0.0.weight" in ks
        or "label_emb.0.0.weight" in ks),
    ("sdxl", lambda ks, sh: _has_prefix(ks, "add_embedding.")),

    # ── Lotus (diffusers UNet + class_embedding) ──
    ("lotus", lambda ks, sh: _has_prefix(ks, "class_embedding.")
        and _has_prefix(ks, "down_blocks.")),

    # ── SD1.5 (ComfyUI UNet fallback: input_blocks) ──
    ("sd15", lambda ks, sh: _has_prefix(ks, "cond_stage_model.")
        or _has_prefix(ks, "model.diffusion_model.")
        or _has_prefix(ks, "input_blocks.") or _has_prefix(ks, "down_blocks.")),

    # ── 放大模型 (非扩散) ──
    ("realesrgan", lambda ks, sh: _has_sub(ks, "rdb") and _has_prefix(ks, "body.")),
    ("esrgan", lambda ks, sh: _has_sub(ks, "RDB") or _has_prefix(ks, "model.1.sub.")),

    # ── LoRA (ComfyUI 不管 LoRA, 以下为项目自维护) ──
    ("qwen", lambda ks, sh: _has_prefix(ks, "lora_unet_transformer_blocks_")
        and _has_sub(ks, "add_k_proj")),
    ("qwen", lambda ks, sh: _has_prefix(ks, "diffusion_model.transformer_blocks.")
        and _has_sub(ks, "add_k_proj")),
    ("qwen", lambda ks, sh: _has_prefix(ks, "transformer.transformer_blocks.")
        and _has_sub(ks, "add_k_proj")),
    ("qwen", lambda ks, sh: any(k.startswith("transformer_blocks.") for k in ks)
        and _has_sub(ks, "add_k_proj")),
    ("sdxl", lambda ks, sh: _has_prefix(ks, "lora_te2_")),
    ("sdxl", lambda ks, sh: _has_prefix(ks, "lora_unet_")
        and any(re.search(r"transformer_blocks_[1-9]", k) for k in ks)),
    ("sd15", lambda ks, sh: _has_prefix(ks, "lora_te1_")
        or _has_prefix(ks, "lora_unet_")),
]


def match_arch_from_keys(keys: set[str], shapes: dict | None = None) -> str:
    """从 tensor key 名称集合 (+ 可选形状) 匹配模型架构。规则见 _ARCH_KEY_RULES。

    shapes 为 safetensors header 解析出的 {key_name: shape_tuple}, 仅 Wan 2.2
    三条目细分 (t2v/i2v/5B) 用到; 旧图像架构规则忽略 shapes。传 None / 空 dict
    时 Wan 规则退化为 key 名判别 (5B 无法与 14B-t2v 区分)。
    GGUF 路径不调用此函数细分 Wan (保守返回通用 "wan")。
    """
    for arch, rule in _ARCH_KEY_RULES:
        if rule(keys, shapes):
            return arch
    return "unknown"


# ── 打包形态检测 (整合包 vs 拆分) ─────────────────────────────────────────────
# 打包形态是文件属性而非架构属性。含 TE 且含 VAE key → 整合包;
# 否则 → 拆分 (UNet-only / GGUF 实践中恒 split)。
# 调用方: services/header_probe.py (下载前探针)。本地扫描侧 (options API)
# 已不再调用此判据 — 形态改由文件所在目录/列表归属推导。

# TE (text encoder) key 特征。覆盖各架构实际命名:
#   - sdxl/sd15:    cond_stage_model.*
#   - flux1/sd3:    text_encoders.* (DualCLIP 单文件打包用此键)
#   - DiT 系 (comfy): conditioner.embedders.*
#   - SD1.5 CLIP:   text_model.*
#   - Z-Image/Flux2: t5xxl* / qwen* / mistral* (loader 内部分离式 TE, 整合包里这些前缀也存在)
# 注: 不含 "txt_in." — 它是 Flux transformer 的文本条件输入投影 (非 text encoder),
#     UNet-only flux 文件也有此键, 会误判 has_te (仅靠 has_vae=False 兜底, 太脆)。
_TE_MARKERS = (
    "cond_stage_model.",
    "text_encoders.",
    "conditioner.embedders.",
    "text_model.",
    "t5xxl",
    "qwen",
    "mistral",
)

# VAE key 特征:
#   - SD1.5/SDXL: first_stage_model.* (整合包内 VAE 烘焙于此)
#   - Flux1/Chroma/Z-Image (vae.* 显式, 或 ae 文件烘焙为 vae.*)
#   - 显式 VAE 节点 key: decoder.conv_in / encoder.down (VAE encoder/decoder 子模块)
_VAE_MARKERS = (
    "first_stage_model.",
    "vae.",
    "decoder.conv_in",
    "encoder.down",
)


def detect_packaging(keys: set[str], shapes: dict | None = None) -> str:
    """含 TE 且含 VAE key → 'checkpoint' (整合包); 否则 → 'split' (拆分/UNet-only)。

    输入为 safetensors header 的 tensor key 集合 (不含 ``__metadata__``)。
    GGUF / 无法读头时调用方应默认 'split' (GGUF 实践中恒 UNet-only)。

    视频主权重短路: 视频权重永远是 UNet-only, 恒 split。
    Wan 2.2 的 head.modulation 锚点命中即短路, 避免 14B 打包件 (附带 cond_stage_model
    + first_stage_model) 被误判为整合包 — 它们实际仍是分发的 UNet 主权重, TE/VAE
    是同仓附带的运行件而非烘焙进同一权重。LTX-2.3 整合包 (CheckpointLoaderSimple
    加载) 不在此短路范围 — 它是真整合包 (TE+VAE+UNet 同 ckpt), 走正常 has_te/has_vae。
    """
    if _is_wan_model(keys):
        return "split"
    has_te = any(any(m in k for m in _TE_MARKERS) for k in keys)
    has_vae = any(any(m in k for m in _VAE_MARKERS) for k in keys)
    return "checkpoint" if (has_te and has_vae) else "split"


# ── 内容角色判定已删除 ──────────────────────────────────────────────────────
# 旧实现 detect_content_role() / detect_content_role_from_file() 读 safetensors
# 头, 按张量 key 判「这个文件是整合包 / VAE / UNet」, 供下载后归位决定目标目录。
#
# 已整体废弃。目录判定迁到 services/download_classify.py: 改用 Civitai 元数据
# (file.type / model.type / 扩展名) 在**下载前**逐文件定目录, 判不出的交给用户选。
# 契约与实测依据见 docs/DOWNLOAD_CLASSIFICATION_SPEC.md。
#
# 随之删除的还有 _DIFFUSION_MARKERS / _AE_ENCODER_PREFIXES / _AE_DECODER_PREFIXES
# —— 它们只服务于上面两个函数。
#
# detect_packaging_from_file() (路径版) 已删除: 本地模型形态由索引中的 category
# 推导。detect_packaging(keys, shapes) 保留, 供 header_probe.py 下载前探针使用。
#
# **保留** detect_packaging / match_arch_from_keys / detect_arch 及其 markers:
# 那些服务于「本地已有模型的架构识别」(生成页选主权重时判 SDXL/Flux/Wan),
# 与下载归位无关。


# ── Wan 子变体判别说明 ──────────────────────────────────────────────────────
# Wan 2.2 的 t2v/i2v/5B 子变体靠 patch_embedding.weight 的 in_dim (shape[1]) 区分:
#   t2v=16, i2v=36, 5b=48 (ComfyUI detect_unet_config:715 in_dim)。
# safetensors 与 GGUF 都能拿到 shape (GGUF tensor info 区的 n_dims+dims 反转即 torch shape),
# 故与 ComfyUI 走同一条判别路径, 无需文件名兜底。
# GGUF 带 general.architecture="wan" 元数据时: 5B/i2v 仍用 shape 细分,
# t2v (in_dim=16) 与 Wan 2.1 无法区分 -> 保守返回通用 "wan"。
# 旧 _wan_subvariant_from_filename 文件名兜底逻辑已删除 (实测 GGUF shape 可读, 见测试)。


# ── 综合检测入口 ─────────────────────────────────────────────────────────────

def detect_arch(filepath: str, name: str = "") -> str:
    """
    检测模型架构，优先级: 文件 header > 路径子文件夹。
    返回: 见 arch_from_base_model() 的 arch 列表 (header 嗅探覆盖 ComfyUI
    detect_unet_config 全部架构分支)。

    下载与 enrich 流程优先通过 arch_from_base_model() 使用 CivitAI 官方枚举；
    本函数的 header 嗅探覆盖基础索引记录 (safetensors + GGUF, 两者均能拿 shape)；
    路径兜底覆盖 header 读不了的格式 (.ckpt 等)。
    """
    result = "unknown"
    if filepath.endswith(".safetensors"):
        result = _detect_arch_safetensors(filepath)
    elif filepath.endswith(".gguf"):
        result = _detect_arch_gguf(filepath)
    if result == "unknown" and name:
        result = _detect_arch_from_path(name)
    return result
