"""
ComfyCarry — ComfyUI 启动参数定义与解析
"""


# ── 启动参数定义 ──────────────────────────────────────────────
COMFYUI_PARAM_GROUPS = {
    "vram": {
        "label": "VRAM 管理",
        "type": "select",
        "help": "控制模型显存分配策略。默认自动检测，High VRAM 适合大显存GPU不卸载模型，Low VRAM 适合小显存拆分推理",
        "options": [
            ("default", "默认 (自动)"),
            ("gpu-only", "GPU Only (全部保留在GPU)"),
            ("highvram", "High VRAM (模型不卸载)"),
            ("normalvram", "Normal VRAM (强制正常模式)"),
            ("lowvram", "Low VRAM (拆分 UNet)"),
            ("novram", "No VRAM (极限低显存)"),
        ],
        "flag_map": {
            "gpu-only": "--gpu-only", "highvram": "--highvram",
            "normalvram": "--normalvram", "lowvram": "--lowvram",
            "novram": "--novram",
        },
    },
    "attention": {
        "label": "Attention 方案",
        "type": "select",
        "help": "PyTorch SDPA 推荐，自动调用最优内核(含FlashAttention)。FlashAttention/SageAttention 需要额外安装对应包",
        "options": [
            ("default", "默认 (自动选择)"),
            ("pytorch-cross", "PyTorch SDPA (推荐✓)"),
            ("split-cross", "Split Cross Attention (省VRAM)"),
            ("quad-cross", "Sub-Quadratic"),
            ("flash", "FlashAttention (需flash-attn包)"),
            ("sage", "SageAttention (需sageattention包)"),
        ],
        "flag_map": {
            "pytorch-cross": "--use-pytorch-cross-attention",
            "split-cross": "--use-split-cross-attention",
            "quad-cross": "--use-quad-cross-attention",
            "flash": "--use-flash-attention",
            "sage": "--use-sage-attention",
        },
    },
    "disable_xformers": {
        "label": "禁用 xFormers",
        "type": "bool",
        "help": "xFormers 在新版 PyTorch 下已不推荐，建议禁用并使用 PyTorch SDPA",
        "flag": "--disable-xformers",
    },
    "unet_precision": {
        "label": "UNet 精度",
        "type": "select",
        "help": "控制 UNet 推理精度。FP8 可大幅减少显存占用，适合大模型；BF16 是 Ampere+ 推荐精度",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("fp8_e4m3fn", "FP8 (e4m3fn)"), ("fp8_e5m2", "FP8 (e5m2)"),
        ],
        "flag_map": {
            "fp32": "--fp32-unet", "fp16": "--fp16-unet", "bf16": "--bf16-unet",
            "fp8_e4m3fn": "--fp8_e4m3fn-unet", "fp8_e5m2": "--fp8_e5m2-unet",
        },
    },
    "vae_precision": {
        "label": "VAE 精度",
        "type": "select",
        "help": "VAE 解码精度。FP32 最稳定，FP16/BF16 更快。黑图时可尝试 FP32",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("cpu", "CPU (在CPU上运行)"),
        ],
        "flag_map": {
            "fp32": "--fp32-vae", "fp16": "--fp16-vae",
            "bf16": "--bf16-vae", "cpu": "--cpu-vae",
        },
    },
    "text_enc_precision": {
        "label": "Text Encoder 精度",
        "type": "select",
        "help": "文本编码器精度。通常默认即可，FP8 可节省显存",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("fp8_e4m3fn", "FP8 (e4m3fn)"), ("fp8_e5m2", "FP8 (e5m2)"),
        ],
        "flag_map": {
            "fp32": "--fp32-text-enc", "fp16": "--fp16-text-enc",
            "bf16": "--bf16-text-enc",
            "fp8_e4m3fn": "--fp8_e4m3fn-text-enc", "fp8_e5m2": "--fp8_e5m2-text-enc",
        },
    },
    "fast": {
        "label": "实验性优化 (--fast)",
        "type": "bool",
        "help": "启用 ComfyUI 实验性加速，可能提升推理速度 10-20%，极少数工作流可能不兼容",
        "flag": "--fast",
    },
    "preview_method": {
        "label": "预览方式",
        "type": "select",
        "help": "生成过程中的实时预览方式。TAESD 效果最好但稍慢，Latent2RGB 最快但模糊",
        "options": [
            ("auto", "自动"), ("none", "无"),
            ("latent2rgb", "Latent2RGB"), ("taesd", "TAESD"),
        ],
        "flag_prefix": "--preview-method",
    },
    "cache": {
        "label": "缓存策略",
        "type": "select",
        "help": "控制节点输出缓存。LRU 精细控制缓存大小，经典模式激进缓存更快但占更多内存",
        "options": [
            ("default", "默认"), ("classic", "经典 (Aggressive)"),
            ("lru", "LRU"), ("none", "禁用"),
        ],
        "flag_map": {
            "classic": "--cache-classic", "none": "--cache-none",
        },
    },
    "cache_lru_size": {
        "label": "LRU 缓存大小",
        "type": "number",
        "help": "LRU 缓存最大条目数，0 = 无限制。建议根据可用内存设置",
        "flag_prefix": "--cache-lru",
        "depends_on": {"cache": "lru"},
    },
}


# ── 反向查找表: flag -> (group_key, value) ───────────────────
_FLAG_TO_PARAM = {}
for _gk, _gv in COMFYUI_PARAM_GROUPS.items():
    if _gv["type"] == "bool":
        _FLAG_TO_PARAM[_gv["flag"]] = (_gk, True)
    elif "flag_map" in _gv:
        for _val, _flag in _gv["flag_map"].items():
            _FLAG_TO_PARAM[_flag] = (_gk, _val)


def parse_comfyui_args(args):
    """从命令行参数列表解析为结构化参数字典"""
    params = {k: (False if v["type"] == "bool" else 0 if v["type"] == "number" else "default")
              for k, v in COMFYUI_PARAM_GROUPS.items()}
    params["listen"] = "0.0.0.0"
    params["port"] = 8188

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--listen" and i + 1 < len(args):
            params["listen"] = args[i + 1]; i += 2; continue
        elif a == "--port" and i + 1 < len(args):
            params["port"] = int(args[i + 1]); i += 2; continue
        elif a == "--preview-method" and i + 1 < len(args):
            params["preview_method"] = args[i + 1]; i += 2; continue
        elif a == "--cache-lru" and i + 1 < len(args):
            params["cache"] = "lru"
            params["cache_lru_size"] = int(args[i + 1]); i += 2; continue
        elif a in _FLAG_TO_PARAM:
            gk, val = _FLAG_TO_PARAM[a]
            params[gk] = val
        i += 1
    return params


def build_comfyui_args(params):
    """从结构化参数字典构建命令行参数字符串"""
    args = ["--listen", params.get("listen", "0.0.0.0"),
            "--port", str(params.get("port", 8188))]

    for gk, gv in COMFYUI_PARAM_GROUPS.items():
        val = params.get(gk)
        if val is None or val == "default" or val is False:
            continue
        if gv["type"] == "bool" and val:
            args.append(gv["flag"])
        elif gv["type"] == "select" and "flag_map" in gv and val in gv["flag_map"]:
            args.append(gv["flag_map"][val])
        elif gv["type"] == "select" and "flag_prefix" in gv and val != "default":
            args.extend([gv["flag_prefix"], str(val)])
        elif gv["type"] == "number" and "flag_prefix" in gv and val is not None:
            if gk == "cache_lru_size" and params.get("cache") != "lru":
                continue
            args.extend([gv["flag_prefix"], str(int(val))])

    return " ".join(args)
