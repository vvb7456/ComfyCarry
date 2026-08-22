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
            ("lowvram", "Low VRAM (拆分 UNet)"),
            ("novram", "No VRAM (极限低显存)"),
        ],
        "flag_map": {
            "gpu-only": "--gpu-only", "highvram": "--highvram",
            "lowvram": "--lowvram",
            "novram": "--novram",
        },
    },
    "attention": {
        "label": "Attention 方案",
        "type": "select",
        "help": "PyTorch SDPA 推荐，自动调用最优内核。FlashAttention/SageAttention 可通过 Setup Wizard 安装",
        "options": [
            ("default", "默认 (自动选择)"),
            ("pytorch-cross", "PyTorch SDPA (推荐✓)"),
            ("split-cross", "Split Cross Attention (省VRAM)"),
            ("quad-cross", "Sub-Quadratic"),
            ("flash", "FlashAttention"),
            ("sage", "SageAttention"),
        ],
        "flag_map": {
            "pytorch-cross": "--use-pytorch-cross-attention",
            "split-cross": "--use-split-cross-attention",
            "quad-cross": "--use-quad-cross-attention",
            "flash": "--use-flash-attention",
            "sage": "--use-sage-attention",
        },
    },
    "upcast_attention": {
        "label": "注意力上采样",
        "type": "select",
        "help": "Attention 计算上采样到更高精度。黑图/花屏时可尝试强制上采样；禁用仅用于排查",
        "options": [
            ("default", "默认"),
            ("force", "强制上采样"),
            ("off", "禁用上采样"),
        ],
        "flag_map": {
            "force": "--force-upcast-attention",
            "off": "--dont-upcast-attention",
        },
    },
    "reserve_vram": {
        "label": "显存预留 (GB)",
        "type": "number",
        "help": "为操作系统/其他软件预留的显存 (GB)。大显存跑大模型时防止与桌面环境抢显存导致 OOM",
        "flag_prefix": "--reserve-vram",
    },
    "vram_headroom": {
        "label": "动态显存余量 (GB)",
        "type": "number",
        "help": "DynamicVRAM 在默认之上额外保持空闲的显存 (GB)。频繁 OOM 时可适当调大",
        "flag_prefix": "--vram-headroom",
    },
    "async_offload": {
        "label": "异步权重卸载",
        "type": "select",
        "help": "采样时异步预取权重到显存，减少加载停顿。Nvidia 平台默认启用",
        "options": [
            ("default", "默认"),
            ("on", "启用"),
            ("off", "禁用"),
        ],
        "flag_map": {
            "on": "--async-offload",
            "off": "--disable-async-offload",
        },
    },
    "dynamic_vram": {
        "label": "动态显存调度",
        "type": "select",
        "help": "DynamicVRAM 按实际显存压力动态调度模型加载。异常反复 OOM 时可禁用，改用估算式加载",
        "options": [
            ("default", "默认"),
            ("on", "强制启用"),
            ("off", "禁用"),
        ],
        "flag_map": {
            "on": "--enable-dynamic-vram",
            "off": "--disable-dynamic-vram",
        },
    },
    "cuda_device": {
        "label": "CUDA 设备",
        "type": "text",
        "help": "使用的 GPU 编号 (逗号分隔，如 0 或 0,1)。其余设备对 ComfyUI 不可见；留空使用全部",
        "flag_prefix": "--cuda-device",
    },
    "disable_xformers": {
        "label": "xFormers",
        "type": "select",
        "help": "xFormers 在新版 PyTorch 下已不推荐，建议禁用并使用 PyTorch SDPA",
        "options": [
            ("default", "默认"),
            ("disabled", "禁用"),
        ],
        "flag_map": {
            "disabled": "--disable-xformers",
        },
    },
    "unet_precision": {
        "label": "UNet 精度",
        "type": "select",
        "help": "控制 UNet 推理精度。FP8 可大幅减少显存占用，适合大模型；BF16 是 Ampere+ 推荐精度",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("fp8_e4m3fn", "FP8 (e4m3fn)"), ("fp8_e5m2", "FP8 (e5m2)"),
            ("fp8_e8m0fnu", "FP8 (e8m0fnu)"),
        ],
        "flag_map": {
            "fp32": "--fp32-unet", "fp16": "--fp16-unet", "bf16": "--bf16-unet",
            "fp8_e4m3fn": "--fp8_e4m3fn-unet", "fp8_e5m2": "--fp8_e5m2-unet",
            "fp8_e8m0fnu": "--fp8_e8m0fnu-unet",
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
        "label": "实验性优化",
        "type": "select",
        "help": "启用 ComfyUI 实验性加速，可能提升推理速度 10-20%，极少数工作流可能不兼容",
        "options": [
            ("default", "关闭"),
            ("enabled", "启用"),
        ],
        "flag_map": {
            "enabled": "--fast",
        },
    },
    "fp16_intermediates": {
        "label": "中间张量 FP16",
        "type": "select",
        "help": "节点间的中间张量改用 FP16 传输（实验性），可减少显存占用，个别工作流可能精度损失",
        "options": [
            ("default", "关闭"),
            ("enabled", "启用"),
        ],
        "flag_map": {
            "enabled": "--fp16-intermediates",
        },
    },
    "force_channels_last": {
        "label": "Channels Last",
        "type": "select",
        "help": "推理时强制 channels last 张量布局。部分 GPU（如 AMD）可提速，个别工作流可能变慢",
        "options": [
            ("default", "关闭"),
            ("enabled", "启用"),
        ],
        "flag_map": {
            "enabled": "--force-channels-last",
        },
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
    "preview_size": {
        "label": "预览最大尺寸",
        "type": "number",
        "help": "采样预览图的最大边长。调小可减少预览开销，调大预览更清晰",
        "flag_prefix": "--preview-size",
        # 预览方式为 none (无预览) 时尺寸无意义
        "depends_on": {"preview_method": "!none"},
    },
    "disable_metadata": {
        "label": "输出元数据",
        "type": "select",
        "help": "默认在输出文件中写入生成参数 (prompt/seed 等)。禁用后文件更干净、体积略小，但无法从文件回溯生成信息",
        "options": [
            ("default", "写入元数据"),
            ("disabled", "禁用写入"),
        ],
        "flag_map": {
            "disabled": "--disable-metadata",
        },
    },
    "fast_disk": {
        "label": "磁盘优先加载",
        "type": "select",
        "help": "模型权重走 page cache 而非匿名内存，大幅降低内存占用 (大模型场景尤其明显)。NVMe 盘推荐启用",
        "options": [
            ("default", "关闭"),
            ("enabled", "启用"),
        ],
        "flag_map": {
            "enabled": "--fast-disk",
        },
    },
    "mmap": {
        "label": "MMAP 文件映射",
        "type": "select",
        "help": "ckpt/pt 文件用 mmap 加载、safetensors 不用 mmap，进一步降低内存占用",
        "options": [
            ("default", "默认"),
            ("mmap", "启用 mmap"),
            ("no_mmap", "禁用 mmap"),
        ],
        "flag_map": {
            "mmap": "--mmap-torch-files",
            "no_mmap": "--disable-mmap",
        },
    },
    "pinned_memory": {
        "label": "Pinned 内存",
        "type": "select",
        "help": "Pinned memory 加速 CPU→GPU 传输但不可回收。内存紧张时可禁用",
        "options": [
            ("default", "默认"),
            ("off", "禁用"),
        ],
        "flag_map": {
            "off": "--disable-pinned-memory",
        },
    },
    "max_upload_size": {
        "label": "上传上限 (MB)",
        "type": "number",
        "help": "ComfyUI 侧的最大上传体积 (MB)。面板上传另有自己的限制，这里设大一点作为兜底",
        "flag_prefix": "--max-upload-size",
    },
    "cache": {
        "label": "缓存策略",
        "type": "select",
        "help": "控制节点输出缓存。仅当选择 LRU 时，LRU 缓存大小才会生效；经典模式缓存更激进、更快，但占用更多内存",
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
        "help": "LRU 最多保留多少个节点结果用于复用。值越大越容易命中缓存，但会占用更多内存。仅在缓存策略为 LRU 时生效",
        "flag_prefix": "--cache-lru",
        "depends_on": {"cache": "lru"},
    },
}


# ── 反向查找表: flag -> (group_key, value) ───────────────────
_FLAG_TO_PARAM = {}
for _gk, _gv in COMFYUI_PARAM_GROUPS.items():
    if "flag_map" in _gv:
        for _val, _flag in _gv["flag_map"].items():
            _FLAG_TO_PARAM[_flag] = (_gk, _val)


def parse_comfyui_args(args):
    """从命令行参数列表解析为结构化参数字典"""
    params = {k: (0 if v["type"] == "number" else ("default" if v["type"] == "select" else ""))
              for k, v in COMFYUI_PARAM_GROUPS.items()}
    params["listen"] = "0.0.0.0"
    params["port"] = 8188
    # 与 ComfyUI 真实默认一致 (cli_args.py: --preview-method 默认 NoPreviews)。
    # 这里曾填 "auto" —— 命令行没有该 flag 时设置页显示「自动」, 实际进程却没有任何
    # 实时预览, 用户改一次参数触发重建命令行才"莫名其妙好了"。
    # 我们想要的默认值 auto 由 DEFAULT_COMFYUI_ARGS 在启动侧显式给出, 不靠解析兜底。
    params["preview_method"] = "none"

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--listen" and i + 1 < len(args):
            params["listen"] = args[i + 1]; i += 2; continue
        elif a == "--port" and i + 1 < len(args):
            params["port"] = int(args[i + 1]); i += 2; continue
        elif a == "--cache-lru" and i + 1 < len(args):
            params["cache"] = "lru"
            params["cache_lru_size"] = int(args[i + 1]); i += 2; continue
        elif a in _FLAG_TO_PARAM:
            gk, val = _FLAG_TO_PARAM[a]
            params[gk] = val
        else:
            # 通用 flag_prefix 回显: 遍历参数表找匹配的 flag 并读取下一个值
            for gk, gv in COMFYUI_PARAM_GROUPS.items():
                if gv.get("flag_prefix") == a and i + 1 < len(args):
                    params[gk] = args[i + 1]
                    i += 2
                    break
            else:
                i += 1
            continue
        i += 1
    return params


def _depends_satisfied(params, gv):
    """depends_on 条件检查。值以 '!' 开头表示「不等于」；
    其余为「等于」。条件不满足时字段不产出命令行 flag。"""
    for dep_key, dep_val in (gv.get("depends_on") or {}).items():
        cur = params.get(dep_key)
        if isinstance(dep_val, str) and dep_val.startswith("!"):
            if str(cur) == dep_val[1:]:
                return False
        else:
            if str(cur) != str(dep_val):
                return False
    return True


def build_comfyui_args(params):
    """从结构化参数字典构建命令行参数字符串"""
    args = ["--listen", params.get("listen", "0.0.0.0"),
            "--port", str(params.get("port", 8188))]

    for gk, gv in COMFYUI_PARAM_GROUPS.items():
        val = params.get(gk)
        if val is None or val == "default" or val is False or val == "":
            continue
        # 联动条件不满足 → 不产出 flag (如 preview_method=none 时 preview_size 无效)
        if not _depends_satisfied(params, gv):
            continue
        if gv["type"] == "select" and "flag_map" in gv and val in gv["flag_map"]:
            args.append(gv["flag_map"][val])
        elif gv["type"] == "select" and "flag_prefix" in gv and val != "default":
            args.extend([gv["flag_prefix"], str(val)])
        elif gv["type"] == "number" and "flag_prefix" in gv:
            # 0 = 未设置 (默认值), 不产出 flag (含字符串 '0', 如命令行回显)
            if val in (0, "", None) or str(val) == "0":
                continue
            args.extend([gv["flag_prefix"], str(int(val))])
        elif gv["type"] == "text" and "flag_prefix" in gv:
            args.extend([gv["flag_prefix"], str(val)])

    return " ".join(args)


# ── 首次启动的默认命令行 ─────────────────────────────────────
# 部署引擎 / 容器重启自动恢复都必须走这里, 不要再手写字符串:
# 漏掉 --preview-method 就等于 ComfyUI 默认的 NoPreviews, 生成过程没有任何实时预览。
DEFAULT_COMFYUI_ARGS = "--listen 0.0.0.0 --port 8188 --preview-method auto"


def ensure_preview_method(args_str, method="auto"):
    """给历史遗留的启动参数补上 --preview-method (已有则原样返回)。

    老实例持久化的 comfyui_args 里没有这个 flag, 容器重启后照原样起进程 →
    仍然没有实时预览。这里只做追加, 不做 parse→build 归一化 (会丢掉用户
    通过 extra_args 传入的、参数表未收录的 flag)。
    """
    if not args_str:
        return DEFAULT_COMFYUI_ARGS
    if "--preview-method" in args_str:
        return args_str
    return f"{args_str} --preview-method {method}"
