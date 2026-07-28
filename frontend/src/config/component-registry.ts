/**
 * component-registry.ts — 运行组件权威表
 *
 * "运行组件" = 拆分形态 (UNet + TE + VAE) 的模型所需的文本编码器与 VAE 文件。
 * 本文件是唯一定义源, modelDepConfigs.ts 的 TAB_DEP_CONFIGS 从此派生。
 *
 * 视频架构 (Wan 2.2) 额外引入 "lightning" 加速件 slot (LoRA, 落 loras/ 目录),
 * 以及条件 slot 机制: 带 `requiredWhen: 'fast'` 的文件仅在"速度=快速"时计入必需集。
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type ComponentTier = 'standard' | 'lite' | 'full'

/** slot 类型: clip/clip2/vae (图像架构) + lightning (视频加速件) */
export type ComponentSlot = 'clip' | 'clip2' | 'vae' | 'lightning'

/**
 * 条件必需谓词。
 * - `'fast'` = 仅"速度=快速"档时必需 (Lightning 加速件)
 * - 缺省 (undefined) = 无条件必需 (普通 TE/VAE)
 *
 * 声明式而非函数式: 视频只有"快速/标准"两档, 枚举足够; 且可被序列化/快照。
 */
export type RequiredWhen = 'fast'

/** 组件就绪判定上下文 (调用 requiredComponents 时传入)。 */
export interface ComponentContext {
  /** 速度档: true=快速 (加速件必需), false/缺省=标准 (加速件不计入必需集) */
  fast?: boolean
}

export interface ComponentFile {
  /** 稳定唯一 id */
  id: string
  /** 展示名, 如 'CLIP-L' / 'T5-XXL FP8' */
  label: string
  /** 文件名 (存在性判定与去重的唯一键) */
  filename: string
  /** HuggingFace 直链 (带 ?download=true) */
  url: string
  /** 相对 ComfyUI 根的目录 */
  subdir: string
  /** 精确字节数 (十进制) */
  bytes: number
  tier: ComponentTier
  /** 量化家族词干, 用于"兼容版本"匹配, 如 't5xxl' */
  stem: string
  /** 条件必需谓词: 'fast' = 仅快速模式必需; 缺省 = 无条件必需 */
  requiredWhen?: RequiredWhen
}

export interface ArchComponents {
  arch: string
  slots: Partial<Record<ComponentSlot, ComponentFile[]>>
}

// ── 共享常量 (多架构复用同一文件, 必须用同一个常量对象) ────────────────────────

const QWEN_IMAGE_VAE: ComponentFile = {
  id: 'qwen_image_vae',
  label: 'Qwen Image VAE',
  filename: 'qwen_image_vae.safetensors',
  url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors?download=true',
  subdir: 'models/vae',
  bytes: 253806246,
  tier: 'standard',
  stem: 'qwen_image_vae',
}

const AE_VAE: ComponentFile = {
  id: 'flux_ae',
  label: 'Flux AE',
  filename: 'ae.safetensors',
  url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors?download=true',
  subdir: 'models/vae',
  bytes: 335304388,
  tier: 'standard',
  stem: 'ae',
}

const FLUX2_VAE: ComponentFile = {
  id: 'flux2_vae',
  label: 'Flux2 VAE',
  filename: 'flux2-vae.safetensors',
  url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors?download=true',
  subdir: 'models/vae',
  bytes: 336213556,
  tier: 'standard',
  stem: 'flux2-vae',
}

// ── T5-XXL: flux1.clip2 与 chroma.clip 共用 ────────────────────────────────────

const T5XXL_FP8: ComponentFile = {
  id: 't5xxl_fp8',
  label: 'T5-XXL FP8',
  filename: 't5xxl_fp8_e4m3fn_scaled.safetensors',
  url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors?download=true',
  subdir: 'models/text_encoders',
  bytes: 5157348688,
  tier: 'standard',
  stem: 't5xxl',
}

const T5XXL_FP16: ComponentFile = {
  id: 't5xxl_fp16',
  label: 'T5-XXL FP16',
  filename: 't5xxl_fp16.safetensors',
  url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors?download=true',
  subdir: 'models/text_encoders',
  bytes: 9787841024,
  tier: 'full',
  stem: 't5xxl',
}

// ── Z-Image Qwen3-4B: zimage.clip 与 flux2klein4b.clip 同名同文件 (sha 一致) ────
// 注: 两个条目的仓库来源不同但 filename 相同 → 装过一个就等于装过另一个。
// zimage.clip 的 url 指向 z_image_turbo, flux2klein4b.clip 的 url 指向 Comfy-Org
// vae-text-encorder-for-flux-klein-4b, 但文件内容完全一致。

const ZIMAGE_QWEN3_4B: ComponentFile = {
  id: 'zimage_te',
  label: 'Qwen3-4B',
  filename: 'qwen_3_4b.safetensors',
  url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors?download=true',
  subdir: 'models/text_encoders',
  bytes: 8044982048,
  tier: 'standard',
  stem: 'qwen_3_4b',
}

// ── Wan 2.2 视频组件 (Comfy-Org/Wan_2.2_ComfyUI_Repackaged) ──────────────
// 三条目 (wan22_i2v / wan22_t2v / wan22_5b) 共享 umt5_xxl FP8 文本编码器;
// 14B 两档用 wan_2.1_vae (254MB), 5B 用 wan2.2_vae (1.41GB, 16×16×4 压缩)。
// 字节数取自 HF tree API LFS size (2026-07-27 校验, 8 文件全部 206 可达)。

const WAN_UMT5_XXL_FP8: ComponentFile = {
  id: 'wan_umt5_xxl_fp8',
  label: 'UMT5-XXL FP8',
  filename: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors?download=true',
  subdir: 'models/text_encoders',
  bytes: 6735906897,
  tier: 'standard',
  stem: 'umt5_xxl',
}

const WAN_21_VAE: ComponentFile = {
  id: 'wan_2_1_vae',
  label: 'Wan 2.1 VAE',
  filename: 'wan_2.1_vae.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors?download=true',
  subdir: 'models/vae',
  bytes: 253815318,
  tier: 'standard',
  stem: 'wan_2_1_vae',
}

const WAN22_VAE: ComponentFile = {
  id: 'wan2_2_vae',
  label: 'Wan 2.2 VAE',
  filename: 'wan2.2_vae.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors?download=true',
  subdir: 'models/vae',
  bytes: 1409400960,
  tier: 'standard',
  stem: 'wan2_2_vae',
}

// ── Lightning 加速 LoRA ────────────────────────────────────────────
// 仅"速度=快速"档必需 (requiredWhen:'fast'); 落 models/loras/ 目录。
// i2v 与 t2v 的加速件不通用 (文件名含 i2v/t2v 前缀); 5B 无加速件。
// 各 1.23 GB (1,226,977,424 字节)。

const WAN22_I2V_LIGHTNING_HI: ComponentFile = {
  id: 'wan22_i2v_lightning_hi',
  label: 'I2V Lightning High',
  filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors?download=true',
  subdir: 'models/loras',
  bytes: 1226977424,
  tier: 'standard',
  stem: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise',
  requiredWhen: 'fast',
}

const WAN22_I2V_LIGHTNING_LO: ComponentFile = {
  id: 'wan22_i2v_lightning_lo',
  label: 'I2V Lightning Low',
  filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors?download=true',
  subdir: 'models/loras',
  bytes: 1226977424,
  tier: 'standard',
  stem: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise',
  requiredWhen: 'fast',
}

const WAN22_T2V_LIGHTNING_HI: ComponentFile = {
  id: 'wan22_t2v_lightning_hi',
  label: 'T2V Lightning High',
  filename: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors?download=true',
  subdir: 'models/loras',
  bytes: 1226977424,
  tier: 'standard',
  stem: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise',
  requiredWhen: 'fast',
}

const WAN22_T2V_LIGHTNING_LO: ComponentFile = {
  id: 'wan22_t2v_lightning_lo',
  label: 'T2V Lightning Low',
  filename: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
  url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors?download=true',
  subdir: 'models/loras',
  bytes: 1226977424,
  tier: 'standard',
  stem: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise',
  requiredWhen: 'fast',
}

// ── COMPONENT_REGISTRY ─────────────────────────────────────────────────────────
// 约定: 每个 slot 的数组按 tier 排序, standard 档必须排第一 (派生函数默认取它)。

const COMPONENT_REGISTRY: ArchComponents[] = [
  {
    arch: 'anima',
    slots: {
      clip: [
        {
          id: 'anima_te',
          label: 'Qwen3 0.6B',
          filename: 'qwen_3_06b_base.safetensors',
          url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 1192135096,
          tier: 'standard',
          stem: 'qwen_3_06b',
        },
      ],
      vae: [QWEN_IMAGE_VAE],
    },
  },
  {
    arch: 'krea2',
    slots: {
      clip: [
        {
          id: 'krea2_te',
          label: 'Qwen3-VL-4B FP8',
          filename: 'qwen3vl_4b_fp8_scaled.safetensors',
          url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 5242467968,
          tier: 'standard',
          stem: 'qwen3vl_4b',
        },
        {
          id: 'krea2_te_full',
          label: 'Qwen3-VL-4B BF16',
          filename: 'qwen3vl_4b_bf16.safetensors',
          url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_bf16.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 8875719384,
          tier: 'full',
          stem: 'qwen3vl_4b',
        },
      ],
      vae: [QWEN_IMAGE_VAE],
    },
  },
  {
    arch: 'zimage',
    slots: {
      clip: [
        ZIMAGE_QWEN3_4B,
        {
          id: 'zimage_te_lite',
          label: 'Qwen3-4B FP8',
          filename: 'qwen_3_4b_fp8_mixed.safetensors',
          url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 5631994051,
          tier: 'lite',
          stem: 'qwen_3_4b',
        },
      ],
      vae: [AE_VAE],
    },
  },
  {
    arch: 'flux1',
    slots: {
      clip: [
        {
          id: 'clip_l',
          label: 'CLIP-L',
          filename: 'clip_l.safetensors',
          url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 246144152,
          tier: 'standard',
          stem: 'clip_l',
        },
      ],
      clip2: [T5XXL_FP8, T5XXL_FP16],
      vae: [AE_VAE],
    },
  },
  {
    arch: 'chroma',
    slots: {
      clip: [T5XXL_FP8, T5XXL_FP16],
      vae: [AE_VAE],
    },
  },
  {
    arch: 'flux2klein4b',
    slots: {
      clip: [
        {
          id: 'klein4b_te',
          label: 'Qwen3-4B',
          filename: 'qwen_3_4b.safetensors',
          url: 'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 8044982048,
          tier: 'standard',
          stem: 'qwen_3_4b',
        },
      ],
      vae: [FLUX2_VAE],
    },
  },
  {
    arch: 'flux2klein9b',
    slots: {
      clip: [
        {
          id: 'klein9b_te',
          label: 'Qwen3-8B FP8',
          filename: 'qwen_3_8b_fp8mixed.safetensors',
          url: 'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 8664848742,
          tier: 'standard',
          stem: 'qwen_3_8b',
        },
        {
          id: 'klein9b_te_full',
          label: 'Qwen3-8B',
          filename: 'qwen_3_8b.safetensors',
          url: 'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 16381517176,
          tier: 'full',
          stem: 'qwen_3_8b',
        },
      ],
      vae: [FLUX2_VAE],
    },
  },
  {
    arch: 'flux2dev',
    slots: {
      clip: [
        {
          id: 'flux2dev_te',
          label: 'Mistral-3-Small FP8',
          filename: 'mistral_3_small_flux2_fp8.safetensors',
          url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 18034640095,
          tier: 'standard',
          stem: 'mistral_3_small_flux2',
        },
        {
          id: 'flux2dev_te_lite',
          label: 'Mistral-3-Small FP4',
          filename: 'mistral_3_small_flux2_fp4_mixed.safetensors',
          url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp4_mixed.safetensors?download=true',
          subdir: 'models/text_encoders',
          bytes: 12275678071,
          tier: 'lite',
          stem: 'mistral_3_small_flux2',
        },
      ],
      vae: [FLUX2_VAE],
    },
  },
  // ── Wan 2.2 视频三条目 ──────────────────────────────────────────────────
  // 三条目共享 umt5_xxl FP8 (text_encoders/); 14B 两档用 wan_2.1_vae, 5B 用 wan2.2_vae。
  // lightning 加速件: i2v/t2v 各 high/low 两件 (requiredWhen:'fast'), 5B 无。
  {
    arch: 'wan22_i2v',
    slots: {
      clip: [WAN_UMT5_XXL_FP8],
      vae: [WAN_21_VAE],
      lightning: [WAN22_I2V_LIGHTNING_HI, WAN22_I2V_LIGHTNING_LO],
    },
  },
  {
    arch: 'wan22_t2v',
    slots: {
      clip: [WAN_UMT5_XXL_FP8],
      vae: [WAN_21_VAE],
      lightning: [WAN22_T2V_LIGHTNING_HI, WAN22_T2V_LIGHTNING_LO],
    },
  },
  {
    arch: 'wan22_5b',
    slots: {
      clip: [WAN_UMT5_XXL_FP8],
      vae: [WAN22_VAE],
    },
  },
]

// ── 派生函数 ──────────────────────────────────────────────────────────────────

const _ARCH_INDEX: Map<string, ArchComponents> = (() => {
  const m = new Map<string, ArchComponents>()
  for (const entry of COMPONENT_REGISTRY) m.set(entry.arch, entry)
  return m
})()

const TIER_ORDER: Record<ComponentTier, number> = { standard: 0, lite: 1, full: 2 }

/** 所有 slot 的遍历顺序 (含 lightning) */
const ALL_SLOTS: ComponentSlot[] = ['clip', 'clip2', 'vae', 'lightning']

/** 文件的条件谓词在给定上下文下是否满足 */
function isRequired(file: ComponentFile, ctx?: ComponentContext): boolean {
  if (!file.requiredWhen) return true
  if (file.requiredWhen === 'fast') return ctx?.fast === true
  return true
}

/**
 * 该架构在给定档位/上下文下的必需文件。arch 不在表中返回 []。
 *
 * 分两类:
 * - 无条件文件 (requiredWhen 缺省): 每 slot 取 1 个 (按 tier 优先级), 图像架构的 TE/VAE。
 * - 条件文件 (requiredWhen:'fast'): 满足 ctx 时该 slot 下全部计入 (high/low 两件都要),
 *   不满足时整 slot 跳过。用于视频加速件。
 *
 * 第二参数 tier 仅影响无条件文件的档位选择; ctx 控制条件 slot 是否计入。
 * 两者独立, 可组合 (目前视频架构无条件多档位, 图像架构无条件 slot)。
 */
export function requiredComponents(
  arch: string,
  tier?: ComponentTier,
  ctx?: ComponentContext,
): ComponentFile[] {
  const entry = _ARCH_INDEX.get(arch)
  if (!entry) return []
  const result: ComponentFile[] = []
  for (const slot of ALL_SLOTS) {
    const files = entry.slots[slot]
    if (!files || files.length === 0) continue

    // 条件文件 (带 requiredWhen): 满足 ctx 时全部计入, 否则整 slot 跳过
    const conditional = files.filter(f => f.requiredWhen)
    if (conditional.length > 0) {
      for (const f of conditional) {
        if (isRequired(f, ctx)) result.push(f)
      }
      continue
    }

    // 无条件文件: 每 slot 取 1 个 (按 tier 优先级)
    let chosen: ComponentFile | undefined
    if (tier) chosen = files.find(f => f.tier === tier)
    if (!chosen) chosen = files.find(f => f.tier === 'standard')
    if (!chosen) chosen = files[0]
    result.push(chosen)
  }
  return result
}

/**
 * 该架构某个 slot 的全部档位; 无则返回 []。
 * 返回的是按 tier 排序的副本 (standard 优先)。
 */
export function componentsForSlot(arch: string, slot: ComponentSlot): ComponentFile[] {
  const entry = _ARCH_INDEX.get(arch)
  if (!entry) return []
  const files = entry.slots[slot]
  if (!files || files.length === 0) return []
  return [...files].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
}

/**
 * 反向索引: 哪些架构用到该文件名 (返回 arch key 数组, 已去重, 按 registry 声明顺序)。
 */
export function archsUsingFile(filename: string): string[] {
  const result: string[] = []
  for (const entry of COMPONENT_REGISTRY) {
    let found = false
    for (const slot of ALL_SLOTS) {
      const files = entry.slots[slot]
      if (!files) continue
      if (files.some(f => f.filename === filename)) {
        found = true
        break
      }
    }
    if (found) result.push(entry.arch)
  }
  return result
}

/**
 * registry 中所有组件文件名的聚合集合 (含加速件, 不含档位去重)。
 * 用途: 模型页隐藏 / LoRA 选择器同源过滤。
 * 加速件文件名必须在此集合内, 否则会泄漏进 LoRA 选择器。
 */
export const COMPONENT_FILENAMES: ReadonlySet<string> = (() => {
  const s = new Set<string>()
  for (const entry of COMPONENT_REGISTRY) {
    for (const slot of ALL_SLOTS) {
      const files = entry.slots[slot]
      if (!files) continue
      for (const f of files) s.add(f.filename)
    }
  }
  return s
})()

/**
 * 剥掉量化/精度后缀得到家族词干, 用于"兼容版本"匹配。
 * 实现: 取 basename → 去扩展名 → 小写 → 反复剥除结尾的
 * (fp32|fp16|bf16|fp8|fp4|e4m3fn|e5m2|scaled|mixed|q\d+|int8|gguf) 片段及其前面的分隔符 [_-]
 */
export function stemOf(filename: string): string {
  let s = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  s = s.includes('.') ? s.slice(0, s.lastIndexOf('.')) : s
  s = s.toLowerCase()
  const suffixRe = /(?:fp32|fp16|bf16|fp8|fp4|e4m3fn|e5m2|scaled|mixed|q\d+|int8|gguf)$/
  const sepRe = /[_-]$/
  // 循环剥除: 'fp8mixed' 需要两轮 (先剥 'mixed', 再剥 'fp8' + 分隔符)
  let prev = ''
  while (prev !== s) {
    prev = s
    if (suffixRe.test(s)) s = s.replace(suffixRe, '')
    else break
    if (sepRe.test(s)) s = s.replace(sepRe, '')
  }
  return s
}
