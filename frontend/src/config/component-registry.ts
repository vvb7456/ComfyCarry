/**
 * component-registry.ts — 运行组件权威表
 *
 * "运行组件" = 拆分形态 (UNet + TE + VAE) 的模型所需的文本编码器与 VAE 文件。
 * 本文件是唯一定义源, modelDepConfigs.ts 的 TAB_DEP_CONFIGS 从此派生。
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type ComponentTier = 'standard' | 'lite' | 'full'
export type ComponentSlot = 'clip' | 'clip2' | 'vae'

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
]

// ── 派生函数 ──────────────────────────────────────────────────────────────────

const _ARCH_INDEX: Map<string, ArchComponents> = (() => {
  const m = new Map<string, ArchComponents>()
  for (const entry of COMPONENT_REGISTRY) m.set(entry.arch, entry)
  return m
})()

const TIER_ORDER: Record<ComponentTier, number> = { standard: 0, lite: 1, full: 2 }

/**
 * 该架构在给定档位下的必需文件 (每 slot 取 1 个: 优先 tier 匹配,
 * 否则取 standard, 再否则取第一个)。arch 不在表中返回 []。
 */
export function requiredComponents(arch: string, tier?: ComponentTier): ComponentFile[] {
  const entry = _ARCH_INDEX.get(arch)
  if (!entry) return []
  const result: ComponentFile[] = []
  for (const slot of ['clip', 'clip2', 'vae'] as ComponentSlot[]) {
    const files = entry.slots[slot]
    if (!files || files.length === 0) continue
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
    for (const slot of ['clip', 'clip2', 'vae'] as ComponentSlot[]) {
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

/** registry 中出现的全部文件名 */
export const REGISTRY_FILENAMES: Set<string> = (() => {
  const s = new Set<string>()
  for (const entry of COMPONENT_REGISTRY) {
    for (const slot of ['clip', 'clip2', 'vae'] as ComponentSlot[]) {
      const files = entry.slots[slot]
      if (!files) continue
      for (const f of files) s.add(f.filename)
    }
  }
  return s
})()
