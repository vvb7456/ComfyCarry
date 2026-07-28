"""下载分类判定: 决定一个待下载文件应该落到哪个模型目录。

设计与实测依据见 docs/DOWNLOAD_CLASSIFICATION_SPEC.md。

三条核心原则:

1. **判定粒度是「文件」, 不是「版本」。**
   一个 Civitai version 可以同时含主权重 + VAE + Config (Pony V6 就是这样),
   它们必须各自定目录。旧实现让整个 version 共用一个 save_dir, 导致
   实测 575 个社区 VAE (sdxl_vae / kl-f8-anime2 / vae-ft-mse-840000 ...)
   被塞进 models/checkpoints/<baseModel>/ —— VAELoader 只读 models/vae/,
   等于文件消失。

2. **只用元数据, 不读文件头。**
   判据只有三样: file.type / model.type / 扩展名, 全是枚举。
   不读头 ⇒ 下载前就能定目录 ⇒ 不需要「下载后归位并物理移动文件」那一整套。

3. **判不出来就交给用户, 绝不猜。**
   ComfyUI 加载节点与目录硬绑定, 放错 = 在 UI 里彻底消失。
   宁可多问一次, 不可静默放错。
"""

import os

# ── 判定结果的哨兵值 ────────────────────────────────────────────────────────
# 返回此值表示「机器判不出, 必须由用户选目录」。
MANUAL = "__manual__"
# 返回此值表示「非模型资产, 不下载」(训练数据 / 附件压缩包)。
SKIP = "__skip__"
# 返回此值表示「跟随同 version 主文件的目录」(ControlNet 的 .yaml 之类)。
FOLLOW_PRIMARY = "__follow__"


# ── 第 2.5 层: 老架构白名单 ──────────────────────────────────────────────
# 这些 baseModel 不存在「拆分形态」—— UNet / TE / VAE 恒烘焙在同一个 ckpt 里,
# 所以裸 file.type=Model 必然是整合包。
#
# 实测依据 (2026-07-28, Civitai 公开 API 三轮采样共 25422 条老架构 Checkpoint 文件):
#   UNet / Diffusion Model / Text Encoder / CLIPVision 出现次数 = 0。
#   唯一的 UNet-only 分发件 nununuMix_v62IlUnet.safetensors (Illustrious)
#   自己标了 file.type=UNet, 会被第 1 层接走, 进不到本层。
#
# 精确字符串匹配。**失效模式是安全的**: 名单过期 → 多问用户一次, 而不是放错文件。
# 这与「按 key 前缀猜架构」的白名单性质完全不同 —— 那种过期会静默误判。
LEGACY_INTEGRATED_BASE_MODELS = frozenset({
    "SD 1.4", "SD 1.5", "SD 1.5 LCM", "SD 1.5 Hyper",
    "SD 2.0", "SD 2.0 768", "SD 2.1", "SD 2.1 768",
    "SDXL 0.9", "SDXL 1.0", "SDXL 1.0 LCM",
    "SDXL Lightning", "SDXL Hyper", "SDXL Turbo", "SDXL Distilled",
    "Pony", "Illustrious", "NoobAI",
})

# ── 第 1 层: file.type 细分档 → 目录 ─────────────────────────────────────
# Civitai 的**文件级** type。填了就信 —— 它比条目级 model.type 精确。
# 反向不成立: 没填不能推断「不是」(实测 Flux.1 D 有 395 条裸 Model,
# 其中既有整合包也有 UNet-only)。
_FILE_TYPE_TO_DIR_KEY = {
    "vae": "vae",
    "text encoder": "text_encoders",
    "clipvision": "clip_vision",
    "negative": "embeddings",          # 负面 embedding, 只出现在 TextualInversion 下
}

# file.type ∈ 此集合 → 扩散主干, 按扩展名分 gguf / safetensors
_FILE_TYPE_DIFFUSION = frozenset({"diffusion model", "unet"})

# file.type == "Training Data" → 训练集, 不是资产, 不下载。
#
# 注意 "Archive" **不在**此列 —— 它只表示「这是个压缩包」, 不表示用途:
# 实测 Poses(327) / Wildcards(583) / Workflows(807) 的正身文件全都标 Archive,
# 当作非资产会把它们整类丢掉。Archive 交给扩展名分支按 model.type 分流。
_FILE_TYPE_NON_ASSET = frozenset({"training data"})

# "Pruned Model" 是 "Model" 的同义词 (剪枝版), 表示打包规格而非用途。
# "Other" 表示上传者没有指明用途, 与"没填"等价 —— 对第 2.5 层白名单而言二者含义相同。
# 该常量只被第 2.5 层引用, 而那一层有 baseModel ∈ LEGACY_INTEGRATED_BASE_MODELS 这道闸
# (老架构不存在拆分形态, 裸文件必然是整合包), 故纳入 "other" 的失效模式仍是安全的。
_FILE_TYPE_GENERIC = frozenset({"model", "pruned model", "other", ""})

# ── 第 2 层: model.type 明确档 → 目录 ────────────────────────────────────
# 条目级 type。这些类型用途单一, 且上传者有强动机选对
# (选错自己的模型就从筛选里消失)。
_MODEL_TYPE_TO_DIR_KEY = {
    "lora": "loras",
    "locon": "loras",
    "lycoris": "loras",
    "dora": "loras",
    "textualinversion": "embeddings",
    "aestheticgradient": "embeddings",
    "controlnet": "controlnet",
    "vae": "vae",
    "upscaler": "upscale_models",
    "hypernetwork": "hypernetworks",
    "motionmodule": "animatediff_models",
    "poses": "poses",
    "wildcards": "wildcards",
    "workflows": "workflows",
}

# 归到 model.type 明确档但仍需用户裁决的类型。
# Detection: ultralytics 下 bbox 与 segm 是两个目录, 唯一信号是文件名里的
#            _bbox / _segm —— 这恰好是用户一眼能认、机器不该猜的。
_MODEL_TYPE_MANUAL = frozenset({"detection"})

_ARCHIVE_EXTS = frozenset({".zip", ".rar", ".7z"})
_SIDECAR_EXTS = frozenset({".json", ".yaml", ".yml", ".txt"})


def _ext_of(filename: str) -> str:
    """小写扩展名, 含点。无扩展名返回空串。"""
    return os.path.splitext(filename or "")[1].lower()


def classify_file(
    model_type: str = "",
    file_type: str = "",
    filename: str = "",
    base_model: str = "",
) -> str:
    """判定单个待下载文件的目标目录。

    Args:
        model_type: Civitai **条目级** type ("Checkpoint" / "LORA" / ...)
        file_type:  Civitai **文件级** type ("Model" / "VAE" / "UNet" / ...)
        filename:   文件名 (取扩展名用)
        base_model: Civitai baseModel ("SDXL 1.0" / "Flux.1 D" / ...)

    Returns:
        MODEL_DIRS 的 key, 或三个哨兵之一: MANUAL / SKIP / FOLLOW_PRIMARY。
    """
    mt = (model_type or "").strip().lower()
    ft = (file_type or "").strip().lower()
    bm = (base_model or "").strip()
    ext = _ext_of(filename)

    # ── 第 0 层: 非权重文件 ────────────────────────────────────────────────
    # file.type 的非权重档优先于扩展名 —— 实测 file.type=Workflow 既有 .json
    # 也有 .zip, 反过来 .zip 也可能是 Archive。先看 file.type 才不会错位。
    if ft == "workflow":
        return "workflows"
    if ft in _FILE_TYPE_NON_ASSET:
        return SKIP
    if ft == "config":
        return FOLLOW_PRIMARY

    # .sft 是 safetensors 的别名扩展名 (实测 flux_schnell.sft 等), 视同权重继续往下。
    if ext in _ARCHIVE_EXTS:
        if mt in ("poses", "wildcards", "workflows"):
            return _MODEL_TYPE_TO_DIR_KEY[mt]
        return MANUAL          # 压缩包内容未知, 不猜
    if ext in _SIDECAR_EXTS:
        return FOLLOW_PRIMARY

    # ── 第 1 层: file.type 细分档 (填了就信) ───────────────────────────────
    if ft in _FILE_TYPE_TO_DIR_KEY:
        return _FILE_TYPE_TO_DIR_KEY[ft]
    if ft in _FILE_TYPE_DIFFUSION:
        return "unet_gguf" if ext == ".gguf" else "diffusion_models"

    # GGUF 兜底: 走到这里说明 file.type 没给出用途 (实测 file.type 有
    # Model / Other / Diffusion Model 三种取值, 完全混乱)。GGUF 的加载节点
    # 目录与 safetensors 完全不同 (unet_gguf / clip_gguf), 且二者判不了,
    # 必须交给用户 —— 尤其不能让它掉进下面的老架构白名单落到 checkpoints/。
    if ext == ".gguf":
        return MANUAL

    # ── 第 2 层: model.type 明确档 ─────────────────────────────────────────
    if mt in _MODEL_TYPE_MANUAL:
        return MANUAL
    if mt in _MODEL_TYPE_TO_DIR_KEY:
        return _MODEL_TYPE_TO_DIR_KEY[mt]

    # ── 第 2.5 层: 老架构白名单 ────────────────────────────────────────────
    if mt == "checkpoint" and ft in _FILE_TYPE_GENERIC and bm in LEGACY_INTEGRATED_BASE_MODELS:
        return "checkpoints"

    # ── 第 3 层: 其余全部交给用户 ──────────────────────────────────────────
    # 涵盖: 新架构 Checkpoint 的裸 Model (整合包与 UNet-only 元数据同形),
    #       type=Other, .gguf (file.type 三种取值都出现过), 未知 model.type。
    return MANUAL


# ── 手动裁决时给前端的候选排序 ──────────────────────────────────────────────
# 这是**排序**, 不是预选。前端不得默认选中任何一项 —— 预选等于换个方式替用户
# 做决定, 而这一层的存在前提正是「机器没有把握」。
_SUGGEST_NEW_ARCH_CKPT = ("diffusion_models", "checkpoints", "vae", "text_encoders", "clip_vision")
_SUGGEST_GGUF = ("unet_gguf", "clip_gguf", "diffusion_models")
_SUGGEST_DETECTION = ("ultralytics_bbox", "ultralytics_segm", "ultralytics", "sams")
_SUGGEST_GENERIC = ("checkpoints", "diffusion_models", "loras", "vae", "text_encoders")


def suggest_dir_keys(
    model_type: str = "",
    file_type: str = "",
    filename: str = "",
    base_model: str = "",
) -> list[str]:
    """手动裁决时, 目录候选的展示顺序 (最可能的在前)。"""
    mt = (model_type or "").strip().lower()
    ext = _ext_of(filename)

    if ext == ".gguf":
        return list(_SUGGEST_GGUF)
    if mt == "detection":
        return list(_SUGGEST_DETECTION)
    if mt == "checkpoint":
        return list(_SUGGEST_NEW_ARCH_CKPT)
    return list(_SUGGEST_GENERIC)
