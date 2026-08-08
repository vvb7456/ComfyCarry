/**
 * component-registry.ts — 运行组件权威表
 *
 * "运行组件" = 拆分形态 (UNet + TE + VAE) 的模型所需的文本编码器与 VAE 文件。
 * 本文件是唯一定义源, modelDepConfigs.ts 的依赖行从此派生。
 * 主权重 (UNet) 不在此表: 按项目惯例由用户在 unet 选择器中自选, 不做推荐/预下载。
 *
 * 文件事实单一来源: 每个组件通过 hfVersionId 锚定 HF 白名单
 * (huggingface-models.ts) 条目, filename/url/bytes/subdir/sha256 全部派生,
 * 本文件不再手抄。白名单缺锚点会在模块加载时抛错 (fail-fast)。
 *
 * 视频架构 (Wan 2.2) 额外引入 "lightning" 加速件 slot (LoRA, 落 loras/ 目录),
 * 以及条件 slot 机制: 带 `requiredWhen: 'fast'` 的文件仅在"速度=快速"时计入必需集。
 */

import { HF_VERSION_INDEX, MODEL_TYPE_DIRS } from './huggingface-models'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type ComponentTier = 'standard' | 'lite' | 'full'

/** slot 类型: clip/clip2/vae/audio_vae (图像架构 + 视频) + lightning (视频加速件) */
export type ComponentSlot = 'clip' | 'clip2' | 'vae' | 'audio_vae' | 'lightning'

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
  readonly id: string
  /** 展示名, 如 'CLIP-L' / 'T5-XXL FP8' */
  readonly label: string
  readonly tier: ComponentTier
  /** 条件必需谓词: 'fast' = 仅快速模式必需; 缺省 = 无条件必需 */
  readonly requiredWhen?: RequiredWhen
  /** HF 白名单版本锚点 — 文件事实唯一来源 */
  readonly hfVersionId: number

  // ── 以下字段由 hf() 工厂从白名单派生填充, 禁止手写 ──
  /** 文件名 (存在性判定与去重的唯一键) */
  readonly filename: string
  /** HuggingFace 直链 */
  readonly url: string
  /** 精确字节数 (十进制) */
  readonly bytes: number
  /** 相对 ComfyUI 根的目录 */
  readonly subdir: string
  readonly sha256: string
}

export interface ArchComponents {
  arch: string
  slots: Partial<Record<ComponentSlot, ComponentFile[]>>
}

// ── 工厂: 从白名单派生组件文件 ────────────────────────────────────────────────

function hf(
  id: string,
  label: string,
  hfVersionId: number,
  tier: ComponentTier,
  requiredWhen?: RequiredWhen,
): ComponentFile {
  const hit = HF_VERSION_INDEX.get(hfVersionId)
  if (!hit) throw new Error(`component-registry: 白名单版本 ${hfVersionId} 不存在 (组件 ${id})`)
  const file = hit.version.file
  const subdir = MODEL_TYPE_DIRS[file.modelType]
  if (!subdir) throw new Error(`component-registry: modelType ${file.modelType} 无目录映射 (组件 ${id})`)
  return {
    id, label, tier, hfVersionId,
    ...(requiredWhen ? { requiredWhen } : {}),
    filename: file.filename,
    url: file.url,
    bytes: file.sizeBytes,
    subdir,
    sha256: file.sha256,
  }
}

// ── 共享常量 (多架构复用同一文件, 必须用同一个常量对象) ────────────────────────

const QWEN_IMAGE_VAE = hf('qwen_image_vae', 'Qwen Image VAE', -10000301, 'standard')
const AE_VAE = hf('flux_ae', 'Flux AE', -10000113, 'standard')
const FLUX2_VAE = hf('flux2_vae', 'Flux2 VAE', -10000296, 'standard')

// T5-XXL: flux1.clip2 与 chroma.clip 共用
const T5XXL_FP8 = hf('t5xxl_fp8', 'T5-XXL FP8', -10000116, 'standard')
const T5XXL_FP16 = hf('t5xxl_fp16', 'T5-XXL FP16', -10000342, 'full')

// Z-Image Qwen3-4B: zimage.clip 与 flux2klein4b.clip 同文件 (sha 一致, 锚定同一条目)。
// 白名单条目仓库为 z_image_turbo; 旧 klein-4b 仓库副本内容完全相同, 装过一个即等于装过另一个。
const ZIMAGE_QWEN3_4B = hf('zimage_te', 'Qwen3-4B', -10000336, 'standard')

// ── Wan 2.2 视频组件 (Comfy-Org/Wan_2.1_ComfyUI_repackaged 等) ──────────────
// 三条目 (wan22_i2v / wan22_t2v / wan22_5b) 共享 umt5_xxl FP8 文本编码器;
// 14B 两档用 wan_2.1_vae (254MB), 5B 用 wan2.2_vae (1.41GB, 16×16×4 压缩)。
const WAN_UMT5_XXL_FP8 = hf('wan_umt5_xxl_fp8', 'UMT5-XXL FP8', -10000117, 'standard')
const WAN_21_VAE = hf('wan_2_1_vae', 'Wan 2.1 VAE', -10000304, 'standard')
const WAN22_VAE = hf('wan2_2_vae', 'Wan 2.2 VAE', -10000303, 'standard')

// Lightning 加速 LoRA: 仅"速度=快速"档必需 (requiredWhen:'fast'); 落 models/loras/。
// i2v 与 t2v 的加速件不通用 (文件名含 i2v/t2v 前缀); 5B 无加速件。各 1.23 GB。
const WAN22_I2V_LIGHTNING_HI = hf('wan22_i2v_lightning_hi', 'I2V Lightning High', -10000109, 'standard', 'fast')
const WAN22_I2V_LIGHTNING_LO = hf('wan22_i2v_lightning_lo', 'I2V Lightning Low', -10000285, 'standard', 'fast')
const WAN22_T2V_LIGHTNING_HI = hf('wan22_t2v_lightning_hi', 'T2V Lightning High', -10000286, 'standard', 'fast')
const WAN22_T2V_LIGHTNING_LO = hf('wan22_t2v_lightning_lo', 'T2V Lightning Low', -10000287, 'standard', 'fast')

// ── MiniMax H3 (FL2V) 视频组件 (白名单锚点已就绪) ──────────────────────────
// clip = Qwen3-VL 32B NVFP4 AWQ (官方推荐档); 视频/音频两个 VAE 是音视频同出的必需件。
const H3_QWEN3VL_32B_NVFP4 = hf('minimax_h3_te', 'Qwen3-VL 32B NVFP4', -10000358, 'standard')
const H3_VIDEO_VAE = hf('minimax_h3_video_vae', 'H3 Video VAE', -10000349, 'standard')
const H3_AUDIO_VAE = hf('minimax_h3_audio_vae', 'H3 Audio VAE', -10000359, 'standard')

// ── COMPONENT_REGISTRY ─────────────────────────────────────────────────────────
// 约定: 每个 slot 的数组按 tier 排序, standard 档必须排第一 (派生函数默认取它)。

const COMPONENT_REGISTRY: ArchComponents[] = [
  {
    arch: 'anima',
    slots: {
      clip: [hf('anima_te', 'Qwen3 0.6B', -10000335, 'standard')],
      vae: [QWEN_IMAGE_VAE],
    },
  },
  {
    arch: 'krea2',
    slots: {
      clip: [
        hf('krea2_te', 'Qwen3-VL-4B FP8', -10000350, 'standard'),
        hf('krea2_te_full', 'Qwen3-VL-4B BF16', -10000351, 'full'),
      ],
      vae: [QWEN_IMAGE_VAE],
    },
  },
  {
    arch: 'zimage',
    slots: {
      clip: [
        ZIMAGE_QWEN3_4B,
        hf('zimage_te_lite', 'Qwen3-4B FP8', -10000361, 'lite'),
      ],
      vae: [AE_VAE],
    },
  },
  {
    arch: 'flux1',
    slots: {
      clip: [hf('clip_l', 'CLIP-L', -10000115, 'standard')],
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
      clip: [hf('klein4b_te', 'Qwen3-4B', -10000336, 'standard')],
      vae: [FLUX2_VAE],
    },
  },
  {
    arch: 'flux2klein9b',
    slots: {
      clip: [
        hf('klein9b_te', 'Qwen3-8B FP8', -10000338, 'standard'),
        hf('klein9b_te_full', 'Qwen3-8B', -10000337, 'full'),
      ],
      vae: [FLUX2_VAE],
    },
  },
  {
    arch: 'flux2dev',
    slots: {
      clip: [
        hf('flux2dev_te', 'Mistral-3-Small FP8', -10000326, 'standard'),
        hf('flux2dev_te_lite', 'Mistral-3-Small FP4', -10000360, 'lite'),
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
  {
    arch: 'minimax_h3',
    slots: {
      clip: [H3_QWEN3VL_32B_NVFP4],
      vae: [H3_VIDEO_VAE],
      audio_vae: [H3_AUDIO_VAE],
    },
  },
  // minimax_h3_ref (Ref2VA 参考生成): 运行组件与 minimax_h3 完全相同,
  // 复用同一批 hf() 常量对象 (不重复创建, 保持 _ARCH_INDEX 单实例语义)。
  {
    arch: 'minimax_h3_ref',
    slots: {
      clip: [H3_QWEN3VL_32B_NVFP4],
      vae: [H3_VIDEO_VAE],
      audio_vae: [H3_AUDIO_VAE],
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
const ALL_SLOTS: ComponentSlot[] = ['clip', 'clip2', 'vae', 'audio_vae', 'lightning']

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
 * (fp32|fp16|bf16|fp8|fp4|e4m3fn|e5m2|scaled|mixed|base|q\d+|int8|gguf) 片段及其前面的分隔符 [_-]
 */
export function stemOf(filename: string): string {
  let s = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  s = s.includes('.') ? s.slice(0, s.lastIndexOf('.')) : s
  s = s.toLowerCase()
  const suffixRe = /(?:fp32|fp16|bf16|fp8|fp4|e4m3fn|e5m2|scaled|mixed|base|q\d+|int8|gguf)$/
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
