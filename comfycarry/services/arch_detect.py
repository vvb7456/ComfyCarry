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
新增架构: 插入 _ARCH_KEY_RULES / _BASE_MODEL_RULES / _GGUF_ARCH_MAP + 测试用例即可。

视频架构 (Wan 2.2) 取舍说明:
  t2v/i2v 靠 patch_embedding 输入通道数 (16 vs 36)、14B/5B 靠隐藏维度判别。
  _detect_arch_safetensors 读 header 后把 key 名集合 + 形状传给
  match_arch_from_keys; 无形状时 (GGUF tensor 名回退 / 裸 key 集合) 退化为
  key 名判别 (img_emb.proj.0.bias 区分 14B i2v vs t2v) + 文件名兜底 (5B
  与 14B-t2v 在 key 名层面同构, 只能靠文件名或 patch_embedding 形状区分)。
  设计取舍见 docs/VIDEO_GENERATION_PLAN.md。
"""

import json
import os
import re
import struct
from typing import Callable


# ── baseModel 映射 ──────────────────────────────────────────────────────────

# CivitAI baseModel 枚举 → 架构。子串匹配, 按序求值, 先匹配先赢。
# 新增架构在此插入一行即可。
#
# 视频架构说明:
#   - wan22_i2v / wan22_t2v / wan22_5b: 本期生成条目 (familyOf='wan22')。
#   - wan21 / hunyuan / ltxv / ltxv2: 仅识别与展示, 不进生成。
#     仍映射为独立 arch, 让模型页能正确归类、选择器能同源过滤。
# 来源: Civitai 源码 src/server/common/constants.ts baseModelLicenses 全枚举
#        (2026-07-27 核对)。Wan 2.5 闭源仅有 API, 开源社区无 LoRA, 映射到 wan
#        通用标记仅作识别。
# 特异性强的在前: "wan video 2.2 i2v" / "t2v" / "ti2v-5b" 都含 "wan video 2.2",
# 必须把 5B/I2V/T2V 三条排在通用 "wan video" 之前。
_BASE_MODEL_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("anima", ("anima",)),
    ("krea2", ("krea",)),
    ("sd15", ("sd 1.4", "sd 1.5")),          # 含 "sd 1.5 lcm" / "sd 1.5 hyper" (子串)
    ("sdxl", ("sdxl", "pony", "illustrious", "noobai")),
    # Chroma baseModel 必须在 ("flux", ("flux",)) 之前 — Chroma 是 flux schnell 衍生
    # 但独立架构 (单 T5 + 真 CFG), baseModel "Chroma" 不含 "flux" 关键词, 顺序无冲突,
    # 仍按"特异性强的在前"惯例放置。
    ("chroma", ("chroma",)),
    # Z-Image / Flux2 baseModel 映射必须在 ("flux", ("flux",)) 之前 —
    # 否则 CivitAI "Flux.2 Klein" 含 "flux" 会被判为 flux1, 污染 Flux 1 tab 下拉
    ("zimage", ("z-image", "z image", "zimage")),
    ("flux2", ("flux.2", "flux 2", "flux2")),
    ("flux", ("flux",)),
    ("sd3", ("sd 3", "sd3")),
    # ── 视频架构 — 顺序敏感: 2.2 具体条目在通用 wan 之前 ──
    # Wan 2.2 三条目 (本期生成)。baseModel 取自 Civitai 枚举原文。
    ("wan22_i2v", ("wan video 2.2 i2v-a14b",)),
    ("wan22_t2v", ("wan video 2.2 t2v-a14b",)),
    ("wan22_5b", ("wan video 2.2 ti2v-5b",)),
    # Wan 2.5: 闭源 API, 无开源权重, 社区不会有 LoRA, 仅识别标记。
    # 必须在通用 "wan video" 之前 — 否则 "Wan Video 2.5 I2V" 含 "wan video" 会先命中 wan21。
    ("wan", ("wan video 2.5",)),
    # Wan 2.1 仅兼容检测。Civitai 枚举: "Wan Video 14B t2v" /
    # "Wan Video 14B i2v 480p/720p" / "Wan Video 1.3B t2v" / "Wan Video" (clip/VAE 件)。
    # 不细分 i2v/t2v — 2.1 全系不进生成, 识别到 wan21 一档即可。
    ("wan21", ("wan video 14b", "wan video 1.3b", "wan video")),
    # Hunyuan Video: Civitai 枚举 "Hunyuan Video"。
    ("hunyuan", ("hunyuan video",)),
    # LTXV: Civitai 枚举 "LTXV 2.3" / "LTXV2" / "LTXV"。
    # 2.3 与旧 0.9.x 合并识别 — 旧版衰退中, 不值得拆条目。
    ("ltxv", ("ltxv 2.3", "ltxv2", "ltxv")),
]


def arch_from_base_model(base_model: str) -> str:
    """
    CivitAI baseModel 字符串 → 架构。
    baseModel 是 CivitAI 的固定枚举 (如 "SD 1.5" / "SDXL 1.0" / "Pony" / "Anima"
    / "Z-Image Turbo" / "Flux.2 Klein" / "Wan Video 2.2 I2V-A14B" / "Hunyuan Video"
    / "LTXV 2.3")，下载子文件夹名沿用该字符串。
    返回: "sd15" | "sdxl" | "flux" | "flux2" | "sd3" | "anima" | "krea2" | "zimage"
          | "wan22_i2v" | "wan22_t2v" | "wan22_5b" | "wan21" | "wan" | "hunyuan"
          | "ltxv" | "chroma" | "unknown"
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
# GGUF general.architecture 元数据值 → 架构。
# 来源: ComfyUI-GGUF (city96) loader.py IMG_ARCH_LIST 与 convert.py ModelTemplate。
#   - "wan": Wan 2.1 / 2.2 共用 (ComfyUI ModelWan 5D 张量处理 + .modulation 高精度键)。
#     本期不支持 GGUF 加载, 仅识别提示。
#   - GGUF 元数据不携带 t2v/i2v/5B 子变体信息, 无法像 safetensors 那样靠
#     patch_embedding 形状细分 → 统一映射为 "wan" 通用标记 (调用方可再靠
#     _wan_subvariant_from_filename 做子变体兜底)。
_GGUF_ARCH_MAP = {
    "flux": "flux", "sd1": "sd15", "sdxl": "sdxl", "sd3": "sd3",
    "krea2": "krea2",
    "wan": "wan",            # 仅识别, 本期不支持 GGUF 加载
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
            # GGUF 不在此解析张量形状 (llama.cpp 布局复杂且维度需反量化还原),
            # 故 match_arch_from_keys 收到空 shapes → Wan 规则退化为 key 名判别 +
            # (调用方 detect_arch 的) 文件名兜底。
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


_ARCH_KEY_RULES: list[tuple[str, "Callable[[set[str], dict | None], bool]"]] = [
    # ── Wan 2.2 视频系 (14B 双 UNet 高噪/低噪张量结构相同,
    #    t2v/i2v/5B 靠形状; 细节见 _is_wan_model 与下方规则注释) ───────────────
    # 必须在所有图像架构之前: head.modulation 是 Wan 独有锚点, 但 14B 打包件
    # 可能附带 cond_stage_model / first_stage_model (Wan 2.1 整合包), 会被 sd15
    # 的 cond_stage_model. 兜底误吞 — 故 Wan 规则整体前置。
    #
    # 5B TI2V (dim=3072, in_dim=48) — 形状优先。
    #   wan2.2_ti2v_5B_fp16.safetensors, head.modulation.shape[-1]=3072,
    #   patch_embedding.weight.shape[1]=48 (Wan-AI config.json 核对)。
    #   14B 的 dim=5120, 故 dim<=4096 即判 5B (留余量给未来更小变体)。
    ("wan22_5b", lambda ks, sh: _is_wan_model(ks)
        and _shape_of(sh, "patch_embedding.weight") is not None
        and _shape_of(sh, "patch_embedding.weight")[1] >= 40),
    # 14B I2V (dim=5120, in_dim=36) — 形状优先。
    #   patch_embedding.weight.shape[1]==36 (Wan-AI Wan2.2-I2V-A14B config.json)。
    #   in_dim 36 = 16 (latent) + 16 (mask) + 4 (image) 拼接, I2V 独有。
    ("wan22_i2v", lambda ks, sh: _is_wan_model(ks)
        and _shape_of(sh, "patch_embedding.weight") is not None
        and _shape_of(sh, "patch_embedding.weight")[1] == 36),
    # 14B T2V (dim=5120, in_dim=16) — 形状优先。
    #   patch_embedding.weight.shape[1]==16 (Wan-AI Wan2.2-T2V-A14B config.json)。
    ("wan22_t2v", lambda ks, sh: _is_wan_model(ks)
        and _shape_of(sh, "patch_embedding.weight") is not None
        and _shape_of(sh, "patch_embedding.weight")[1] == 16),
    # ── Wan 形状缺失时的 key 名退化判别 (GGUF tensor 名回退 / 裸 key 集合) ──
    # 14B I2V 有 img_emb.proj.0.bias (MLPProj, comfy/ldm/wan/model.py:513-514,
    # model_type=='i2v' 才实例化); 14B T2V 无此 key (img_emb=None)。
    # 5B ti2v 的 img_emb 有无取决于打包方式 — 无形状时无法可靠区分 5B 与 14B-t2v,
    # 此处只判 i2v, 5B 交给 detect_arch 的文件名兜底 (5b/ti2v 文件名模式)。
    ("wan22_i2v", lambda ks, sh: _is_wan_model(ks)
        and _has_sub(ks, "img_emb.proj.0")),
    # Wan 主模型 (无 img_emb, 无形状) — 退化为通用 wan 标记。
    # 命中此条意味着 14B T2V 或 5B (key 名层面无法再分), detect_arch 会用文件名
    # 兜底尝试细化为 wan22_5b / wan22_t2v。
    ("wan", lambda ks, sh: _is_wan_model(ks)),
    # Wan kohya LoRA: lora_unet_blocks_N_(self_attn|cross_attn|ffn)_*
    # Wan 模块名为 self_attn/cross_attn/ffn (comfy/ldm/wan/model.py WanAttentionBlock),
    # 与 anima 的 cross_attn/self_attn/mlp_layer 名字接近但 anima 用 net.blocks.
    # 前缀且无 head.modulation — Wan LoRA 无 head.modulation, 走 blocks+self_attn+ffn
    # 组合。必须排在 anima 的 lora_unet_blocks_ 规则之前 (前缀相同, 靠 ffn 区分)。
    ("wan", lambda ks, sh: _has_prefix(ks, "lora_unet_blocks_")
        and _has_sub(ks, "_self_attn_") and _has_sub(ks, "_ffn_")),
    # Wan musubi/ai-toolkit LoRA: diffusion_model.blocks.N.*.lora_A/B (comfy 原生路径)
    # 与 anima 的 diffusion_model.layers. 不同 (Wan 用 blocks.), 与 zimage 的
    # diffusion_model.layers. 也不同。需同时含 head.modulation 派生的 LoRA 锚点不可得
    # (LoRA 不含 head), 故靠 blocks. + self_attn + cross_attn 组合判。
    ("wan", lambda ks, sh: _has_prefix(ks, "diffusion_model.blocks.")
        and _has_sub(ks, ".self_attn.") and _has_sub(ks, ".cross_attn.")),
    # ── Z-Image / Lumina2 族 (NextDiT): cap_embedder + noise_refiner 双特征
    # (comfy model_detection.py 2026-07-17 master)。comfy 靠张量维度区分原版
    # Lumina2 与 Z-Image, key 名层面同族 — 统一判 zimage (原版 Lumina2 罕见, 可接受)。
    # 放最前 (特征极特异), 必须在 sd15 的 model.diffusion_model. 兜底之前。
    ("zimage", lambda ks, sh: _has_sub(ks, "cap_embedder.") and _has_sub(ks, "noise_refiner.")),
    # Z-Image kohya LoRA: layers.N.attention.* → lora_unet_layers_N_attention_*
    # (待首个真实文件校准, 先按此特征上线并在测试中标注)。
    ("zimage", lambda ks, sh: _has_prefix(ks, "lora_unet_layers_") and _has_sub(ks, "_attention_")),
    # Z-Image musubi/ai-toolkit 格式 LoRA (实测文件 NSFW_master_ZIT_000017532):
    # diffusion_model.layers.N.(attention|adaLN_modulation|feed_forward).*.lora_A/B。
    # layers.N + attention 结构为 Lumina2/Z-Image 族特有 (其余 DiT 用 blocks/transformer_blocks)。
    # 注意 adaLN_modulation 为大写 LN, 与 Anima 小写 adaln_modulation 规则不冲突 (刻意区分)。
    ("zimage", lambda ks, sh: _has_prefix(ks, "diffusion_model.layers.")),
    # Z-Image diffusers/PEFT 格式 LoRA (待真实文件校准): transformer.layers.N.*
    ("zimage", lambda ks, sh: _has_prefix(ks, "transformer.layers.")),
    # Krea2 主模型: SingleStreamDiT 独有 txtfusion.* (ComfyUI model_detection 用
    # txtfusion.projector.weight 判别)。用子串匹配兼容 checkpoint 全量打包的
    # model.diffusion_model.txtfusion.* 前缀 — 必须排在 sd15 的
    # model.diffusion_model. 兜底规则之前。
    ("krea2", lambda ks, sh: _has_sub(ks, "txtfusion.")),
    # Krea2 kohya 格式 LoRA: blocks.N.attn.wq/wk/wv (GQA 分离 QKV) →
    # lora_unet_blocks_N_attn_wq_*。txtfusion 层 LoRA → lora_unet_txtfusion_*。
    # 必须在 Anima 的 lora_unet_blocks_ 规则之前 (前缀相同, 靠模块名区分)。
    ("krea2", lambda ks, sh: _has_prefix(ks, "lora_unet_txtfusion_")
        or (_has_prefix(ks, "lora_unet_blocks_")
            and (_has_sub(ks, "_attn_wq") or _has_sub(ks, "_attn_wk")))),
    # Krea2 diffusers 格式 LoRA: transformer.blocks.N.attn.wq.lora_A.weight
    # (comfy/lora.py 按原生模块路径重映射)。flux 的 diffusers LoRA 前缀是
    # transformer.transformer_blocks. / transformer.single_transformer_blocks.,
    # 不会撞车。
    ("krea2", lambda ks, sh: _has_prefix(ks, "transformer.blocks.")
        and (_has_sub(ks, ".attn.wq") or _has_sub(ks, "txtfusion"))),
    # Anima UNet: 裸格式所有 key 以 net.blocks. 开头 (685 tensors)。
    # civitai 全量打包格式前缀变为 model.diffusion_model.blocks. (无 net. 层)
    # 并附带 cond_stage_model.qwen3_06b + first_stage_model，会误命中 SD1.5 规则，
    # 故统一用小写 adaln_modulation 特征子串判别 (PixArt/DiT 系为大写 adaLN_modulation)
    ("anima", lambda ks, sh: _has_prefix(ks, "net.blocks.") or _has_sub(ks, "adaln_modulation")),
    # Anima LoRA: lora_unet_blocks_<N>_(cross_attn|self_attn|mlp_layer)_*。
    # 收紧为必须含 Anima 特有模块名, 避免吞掉其它 DiT 架构的 kohya LoRA
    # (Krea2 同前缀但模块名是 attn_wq/attn_wk, 已在上方规则先行拦截)。
    ("anima", lambda ks, sh: _has_prefix(ks, "lora_unet_blocks_")
        and (_has_sub(ks, "cross_attn") or _has_sub(ks, "self_attn") or _has_sub(ks, "mlp_layer"))),
    # Flux2: double_stream_modulation_img 为 flux2 独有 (flux1 无)。必须排在
    # flux1 的 double_blocks. 规则之前 — flux2 也可能含 double_stream 前缀。
    ("flux2", lambda ks, sh: _has_sub(ks, "double_stream_modulation_img")),
    # Flux2 kohya LoRA (待校准): 单/双流模块名
    ("flux2", lambda ks, sh: _has_sub(ks, "double_stream_modulation") or _has_prefix(ks, "lora_unet_double_stream_")),
    # ── 以下 flux 规则语义即 flux1，检测输出沿用架构键 "flux" ──
    # Flux1 主模型: double_blocks / single_blocks — 子串匹配兼容 checkpoint 全量打包的
    # model.diffusion_model.double_blocks. 前缀 (修复 _has_prefix 漏匹配整合包的 bug, 与 flux2 一致)。
    ("flux", lambda ks, sh: _has_sub(ks, "double_blocks.")),
    # SD3: joint_blocks
    ("sd3", lambda ks, sh: _has_prefix(ks, "joint_blocks.")),
    # SDXL checkpoint: 双 text encoder (conditioner.embedders.1) 或 label_emb
    ("sdxl", lambda ks, sh: _has_prefix(ks, "conditioner.embedders.1.")
        or "model.diffusion_model.label_emb.0.0.weight" in ks
        or "label_emb.0.0.weight" in ks),
    # SDXL alt: UNet 风格 + add_embedding
    ("sdxl", lambda ks, sh: _has_prefix(ks, "add_embedding.")),
    # SD1.5 checkpoint: cond_stage_model / diffusion_model 但无以上任何标记
    ("sd15", lambda ks, sh: _has_prefix(ks, "cond_stage_model.") or _has_prefix(ks, "model.diffusion_model.")
        or _has_prefix(ks, "input_blocks.") or _has_prefix(ks, "down_blocks.")),
    # LoRA 检测: lora_te2 = SDXL, 无 te2 + 有 te1/unet = SD1.5
    ("sdxl", lambda ks, sh: _has_prefix(ks, "lora_te2_")),
    # UNet-only SDXL LoRA (无 te key): transformer_blocks 索引 >=1 仅 SDXL 存在
    # (SD1.5 每个 attention 层只有 1 个 transformer block, 索引恒为 0)
    ("sdxl", lambda ks, sh: _has_prefix(ks, "lora_unet_")
        and any(re.search(r"transformer_blocks_[1-9]", k) for k in ks)),
    # Flux1 kohya LoRA: lora_unet_double_blocks_* / lora_unet_single_blocks_*
    # 必须排在 sd15 的 lora_unet_ 兜底之前 — 现状会误判 sd15! (回归修复)
    ("flux", lambda ks, sh: _has_prefix(ks, "lora_unet_double_blocks_") or _has_prefix(ks, "lora_unet_single_blocks_")),
    # Flux1 diffusers LoRA: transformer.transformer_blocks. /
    # transformer.single_transformer_blocks. (与 krea2 的 transformer.blocks. 前缀不同, 不冲突)
    ("flux", lambda ks, sh: _has_prefix(ks, "transformer.transformer_blocks.") or _has_prefix(ks, "transformer.single_transformer_blocks.")),
    ("sd15", lambda ks, sh: _has_prefix(ks, "lora_te1_") or _has_prefix(ks, "lora_unet_")),
]


def match_arch_from_keys(keys: set[str], shapes: dict | None = None) -> str:
    """从 tensor key 名称集合 (+ 可选形状) 匹配模型架构。规则见 _ARCH_KEY_RULES。

    shapes 为 safetensors header 解析出的 {key_name: shape_tuple}, 仅 Wan 2.2
    三条目细分 (t2v/i2v/5B) 用到; 旧图像架构规则忽略 shapes。传 None / 空 dict
    时 Wan 规则退化为 key 名判别 (5B 无法与 14B-t2v 区分, 由调用方文件名兜底)。
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


# ── Wan 子变体文件名兜底 (header 无形状时细化 5B / t2v / i2v) ─────────────────
# 5B 与 14B-t2v 在 key 名层面同构 (均无 img_emb), 当 header 拿不到
# patch_embedding 形状 (GGUF / 读头失败) 时, 用文件名兜底细分。

# 5B 文件名特征 (官方 wan2.2_ti2v_5B / 社区 ti2v-5b 等)。
# "5b" 必须由分隔符引出且后不接字母数字, 且前一位不能是数字或小数点 ——
# 否则版本号会误命中: v1.5b / v25b 都含 "5b", 而 Wan LoRA 带版本号是常态。
_WAN_5B_RE = re.compile(r"(?i)(?:ti2v[\s_-]?5b|(?<![0-9.])[\s_.-]5b(?![a-z0-9]))")
# I2V 文件名特征 (i2v / img2vid)。T2V 为默认 (无 i2v 标记即视作 t2v)。
_WAN_I2V_RE = re.compile(r"(?i)(?:[\s_-]i2v[\s_.-]|img2vid|image2video)")
# 14B 文件名特征 (排除误把 5B 当 14B)。
_WAN_14B_RE = re.compile(r"(?i)(?:14b|a14b)")


def _wan_subvariant_from_filename(filename: str) -> str | None:
    """从文件名推断 Wan 2.2 子变体 arch (wan22_5b / wan22_i2v / wan22_t2v)。

    仅在 header 拿不到形状 (GGUF) 或裸 key 名回退时由 detect_arch 调用兜底。
    无 Wan 文件名特征 (不含 wan / ti2v 等) 时返回 None (不强行判)。
    """
    low = filename.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if not any(t in low for t in ("wan", "ti2v", "t2v", "i2v", "lightning", "lightx2v")):
        return None
    # 14B 先判: "a14b"/"14b" 是极特异 token, 命中即可定论。放在 5B 之前可消掉
    # 整类顺序踩雷 —— 如 wan2.2-i2v-a14b-lightning-v1.5b 明确写着 a14b, 不应因
    # 版本号里的 "5b" 被判成 5B。
    if _WAN_14B_RE.search(low):
        return "wan22_i2v" if _WAN_I2V_RE.search(low) else "wan22_t2v"
    if _WAN_5B_RE.search(low):
        return "wan22_5b"
    if _WAN_I2V_RE.search(low):
        return "wan22_i2v"
    if "t2v" in low:
        return "wan22_t2v"
    return None


# ── 综合检测入口 ─────────────────────────────────────────────────────────────

def detect_arch(filepath: str, name: str = "") -> str:
    """
    检测模型架构，优先级: 文件 header > 路径子文件夹 > 文件名兜底。
    返回: "sd15" | "sdxl" | "flux" | "flux2" | "sd3" | "anima" | "krea2" | "zimage"
          | "chroma" | "wan22_i2v" | "wan22_t2v" | "wan22_5b" | "wan21" | "wan"
          | "hunyuan" | "ltxv" | "unknown"

    下载与 enrich 流程优先通过 arch_from_base_model() 使用 CivitAI 官方枚举；
    本函数的 header 嗅探覆盖基础索引记录 (仅 safetensors/GGUF)；
    路径兜底覆盖 header 读不了的格式 (.ckpt 等)。
    Wan 文件名兜底: header 只判出通用 "wan" (GGUF 无形状 / 5B 与 14B-t2v key 名同构)
    时, 用文件名细化为 wan22_5b / wan22_i2v / wan22_t2v。
    """
    result = "unknown"
    if filepath.endswith(".safetensors"):
        result = _detect_arch_safetensors(filepath)
    elif filepath.endswith(".gguf"):
        result = _detect_arch_gguf(filepath)
    # Wan 文件名兜底: header 只判出通用 "wan" 时细化子变体。
    # (5B / 14B-t2v 在 key 名层面同构, GGUF 元数据也只有 "wan", 必须靠文件名)
    if result == "wan":
        fn = name or filepath
        sub = _wan_subvariant_from_filename(fn)
        if sub:
            return sub
    if result == "unknown" and name:
        result = _detect_arch_from_path(name)
    return result
