import sdxlLogo from '@/assets/model-logos/sdxl.png'
import krea2Logo from '@/assets/model-logos/krea2.png'
import zimageLogo from '@/assets/model-logos/zimage.png'
import flux1Logo from '@/assets/model-logos/flux1.png'

export interface ModelTypeConfig {
  key: string
  label: string
  icon: string
  archFilter: string[]
  /** 该架构支持的打包形态 (§2/§5.3): 'checkpoint' 整合包 + 'split' 三件套。
   *  两形态并存时 picker 合并列表 + 形态过滤 chip + 徽章; 单形态时退化为旧行为。 */
  supportedPackaging: ('checkpoint' | 'split')[]
  /** [向后兼容] = supportedPackaging 含 'checkpoint' ? 'checkpoint' : 'split' */
  readonly loader?: 'checkpoint' | 'split'
  /** DualCLIPLoader (flux1): true 时 AdvancedSettings 显示第二个 CLIP select, submit 带 clip2 */
  dualClip?: boolean
  /** ControlNet 生态是否可用 (false 时 pose/canny/depth 模块 disabled) */
  controlNetEnabled: boolean
  /** ControlNet 分支: 'sdxl' (sdxl/pony) | 'ilnoob' (illustrious/noobai) | 'flux' (flux1); 未设 = CN 面板走通用过滤 */
  cnBranch?: 'sdxl' | 'ilnoob' | 'flux'
  /** 按模式的 ControlNet 默认参数 (start 恒 0 不需字段); 有该 key 的 mode 新建态取此值 */
  cnDefaults?: Record<string, { strength: number; end: number }>
  resolutions: { label: string; value: string }[]
  defaults: {
    steps: number
    cfg: number
    sampler: string
    scheduler: string
    /** Clip Skip 默认值 (Pony/Illustrious/NoobAI = 2; 其余缺省 1) */
    clip_skip?: number
  }
  hasNegativePrompt: boolean
  /** 提示词风格: tags = A1111 tag 格式; natural = 自然语言 */
  promptStyle: 'tags' | 'natural'
  /** 官方推荐默认 CLIP / VAE 文件名 (split 形态, 用于自动填充) */
  defaultModels?: { clip?: string; clip2?: string; vae?: string }
  modules: string[]
  extraParams?: Record<string, string | number | boolean>
  /** Logo 资产 URL (静态 import); 缺省走字母徽章 */
  logo?: string
  /** 暗色主题下 logo 反色 (纯黑单色 logo 如 flux1/BFL): true → filter: invert(1)
   *  且底板改用透明/深色 (规格 C5) */
  logoInvertDark?: boolean
  /** 软架构: 所属家族 key (如 'sdxl'); 有此字段 = 二级条目 (衍生) */
  familyOf?: string
  /** 提交 payload 的 model_type 覆盖; 软架构条目 = 'sdxl' */
  workflowType?: string
  /** Picker 传给 ModelPickerModal 的 current-arch (显式声明) */
  pickerArch: string
}

/** 架构 key → 展示标签。新增架构在此加一行 (检测输出的 arch 值为 key)。 */
export const ARCH_LABELS: Record<string, string> = {
  sdxl: 'SDXL', sd15: 'SD 1.5', sd3: 'SD 3',
  anima: 'Anima', krea2: 'Krea 2', zimage: 'Z-Image',
  flux: 'Flux 1', flux2: 'Flux 2', chroma: 'Chroma',
  pony: 'Pony', illustrious: 'Illustrious', noobai: 'NoobAI',
  unknown: '?',
}

export const MODEL_TYPES: Record<string, ModelTypeConfig> = {
  sdxl: {
    key: 'sdxl',
    label: 'SDXL',
    icon: 'image',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'sdxl',
    logo: sdxlLogo,
    pickerArch: 'sdxl',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    defaults: { steps: 20, cfg: 7.0, sampler: 'euler', scheduler: 'normal' },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  anima: {
    key: 'anima',
    label: 'Anima',
    icon: 'palette',
    archFilter: ['anima'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    pickerArch: 'anima',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // Anima 官方推荐: steps=30, cfg 4-6, sampler=er_sde, scheduler=simple
    defaults: { steps: 30, cfg: 4.0, sampler: 'er_sde', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    defaultModels: { clip: 'qwen_3_06b_base.safetensors', vae: 'qwen_image_vae.safetensors' },
    // ControlNet 模块开关 disabled (Anima 暂无 ControlNet 生态)
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  krea2: {
    key: 'krea2',
    label: 'Krea 2',
    icon: 'auto_awesome',
    archFilter: ['krea2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    logo: krea2Logo,
    pickerArch: 'krea2',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×1536 (1:1)', value: '1536x1536' },
      { label: '2048×1152 (16:9)', value: '2048x1152' },
      { label: '1152×2048 (9:16)', value: '1152x2048' },
      { label: '2048×2048 (1:1)', value: '2048x2048' },
    ],
    // 官方 Turbo 模板实测值 (Comfy-Org/workflow_templates image_krea2_turbo_t2i.json)
    defaults: { steps: 8, cfg: 1.0, sampler: 'euler', scheduler: 'simple' },
    // Turbo cfg=1.0 时负面提示词无效, 隐藏负面框 (正面框单框加倍)
    hasNegativePrompt: false,
    promptStyle: 'natural',
    defaultModels: { clip: 'qwen3vl_4b_fp8_scaled.safetensors', vae: 'qwen_image_vae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  zimage: {
    key: 'zimage',
    label: 'Z-Image',
    icon: 'bolt',
    archFilter: ['zimage'],
    supportedPackaging: ['split'],
    controlNetEnabled: false,  // 官方 CN 模板已出现, 二期评估
    logo: zimageLogo,
    pickerArch: 'zimage',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // 官方 Turbo 模板 image_z_image_turbo.json 实测值; Base 用户手动调 25/4.0
    defaults: { steps: 8, cfg: 1.0, sampler: 'res_multistep', scheduler: 'simple' },
    hasNegativePrompt: false,
    promptStyle: 'natural',  // 中英双语原生
    defaultModels: { clip: 'qwen_3_4b.safetensors', vae: 'ae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  flux1: {
    key: 'flux1',
    label: 'Flux 1',
    icon: 'flare',
    archFilter: ['flux'],
    supportedPackaging: ['checkpoint', 'split'],
    dualClip: true,
    controlNetEnabled: true,  // FLUX1_CN_SPEC: Union Pro 2.0 FP8 (InstantX/Shakker)
    cnBranch: 'flux',
    cnDefaults: {
      pose:  { strength: 0.9, end: 0.65 },
      canny: { strength: 0.7, end: 0.8 },
      depth: { strength: 0.8, end: 0.8 },
    },
    logo: flux1Logo,
    // BFL 纯黑单色 logo: 暗色主题下需反色 (规格 C5)
    logoInvertDark: true,
    pickerArch: 'flux',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // 官方模板 flux_dev_full_text_to_image.json 实测值
    defaults: { steps: 20, cfg: 1.0, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: false,
    promptStyle: 'natural',
    defaultModels: { clip: 'clip_l.safetensors', clip2: 't5xxl_fp8_e4m3fn_scaled.safetensors', vae: 'ae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  chroma: {
    key: 'chroma',
    label: 'Chroma',
    icon: 'blur_on',
    archFilter: ['chroma'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    pickerArch: 'chroma',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    defaults: { steps: 26, cfg: 4, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 't5xxl_fp8_e4m3fn_scaled.safetensors', vae: 'ae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  // ── Flux2 (Klein 优先, Dev 靠后) ──
  // 采样拓扑与 flux1 不同: SamplerCustomAdvanced + Flux2Scheduler + FluxGuidance/CFGGuider。
  // guider_mode 由 extraParams 注入 payload, 后端 build_flux2_workflow 据此分支。
  flux2klein: {
    key: 'flux2klein',
    label: 'Flux 2 Klein',
    icon: 'child_care',
    archFilter: ['flux2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    pickerArch: 'flux2',
    // key 为 flux2klein, 但后端 builder / _SPLIT_ARCHS / guider_mode 归一化均以 'flux2' 为键 → 必须提交 flux2
    workflowType: 'flux2',
    extraParams: { guider_mode: 'cfg' },
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // distilled 默认 (4 步 / cfg 1.0, CFGGuider); base 模型用户手动调 20 步 / cfg 5.0
    defaults: { steps: 4, cfg: 1.0, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 'qwen_3_4b.safetensors', vae: 'flux2-vae.safetensors' },
    // flux2 采样走 SamplerCustomAdvanced, i2i/hires 需 SplitSigmas 分段去噪 (未实装) → 仅 t2i + 放大
    modules: ['lora', 'upscale'],
  },
  flux2dev: {
    key: 'flux2dev',
    label: 'Flux 2 Dev',
    icon: 'memory',
    archFilter: ['flux2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    pickerArch: 'flux2',
    workflowType: 'flux2',
    extraParams: { guider_mode: 'basic' },
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // dev: guidance 4.0, 20 步, 无负面 (BasicGuider)
    defaults: { steps: 20, cfg: 4.0, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: false,
    promptStyle: 'natural',
    defaultModels: { clip: 'mistral_3_small_flux2_fp8.safetensors', vae: 'flux2-vae.safetensors' },
    // flux2 采样走 SamplerCustomAdvanced, i2i/hires 需 SplitSigmas 分段去噪 (未实装) → 仅 t2i + 放大
    modules: ['lora', 'upscale'],
  },
  // ── SDXL 软架构 (衍生条目: Pony / Illustrious / NoobAI) ──
  // arch 层面仍是 sdxl, workflow 编排零改动 — 通过 workflowType 提交 sdxl,
  // 由 effectiveArch() 按 sidecar baseModel 判别, picker/拦截分级处理。
  pony: {
    key: 'pony',
    label: 'Pony',
    icon: 'favorite',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'sdxl',
    familyOf: 'sdxl',
    workflowType: 'sdxl',
    pickerArch: 'pony',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // Pony V6 官方推荐: 25 步 / cfg 7 / euler_ancestral / clip_skip 2
    defaults: { steps: 25, cfg: 7.0, sampler: 'euler_ancestral', scheduler: 'normal', clip_skip: 2 },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  illustrious: {
    key: 'illustrious',
    label: 'Illustrious',
    icon: 'brush',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'ilnoob',
    familyOf: 'sdxl',
    workflowType: 'sdxl',
    pickerArch: 'illustrious',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // Illustrious 官方指南: 28 步 / cfg 5 / euler_ancestral / clip_skip 2
    defaults: { steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', clip_skip: 2 },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  noobai: {
    key: 'noobai',
    label: 'NoobAI',
    icon: 'auto_fix_high',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'ilnoob',
    familyOf: 'sdxl',
    workflowType: 'sdxl',
    pickerArch: 'noobai',
    resolutions: [
      { label: '1024×1024 (1:1)', value: '1024x1024' },
      { label: '1152×896 (4:3)', value: '1152x896' },
      { label: '896×1152 (3:4)', value: '896x1152' },
      { label: '1216×832 (3:2)', value: '1216x832' },
      { label: '832×1216 (2:3)', value: '832x1216' },
      { label: '1344×768 (16:9)', value: '1344x768' },
      { label: '768×1344 (9:16)', value: '768x1344' },
      { label: '1536×640 (21:9)', value: '1536x640' },
      { label: '640×1536 (9:21)', value: '640x1536' },
    ],
    // NoobAI (同 IL): 28 步 / cfg 4.5 / euler_ancestral / clip_skip 2
    defaults: { steps: 28, cfg: 4.5, sampler: 'euler_ancestral', scheduler: 'normal', clip_skip: 2 },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
}

// [向后兼容] 给每个条目加 .loader 派生属性 (supportedPackaging 含 'checkpoint' → 'checkpoint' 否则 'split')
// 旧代码读 config.loader 仍可工作; 新代码应直接用 supportedPackaging。
;(() => {
  for (const key of Object.keys(MODEL_TYPES)) {
    const cfg = MODEL_TYPES[key] as ModelTypeConfig & { loader?: 'checkpoint' | 'split' }
    Object.defineProperty(cfg, 'loader', {
      get() { return this.supportedPackaging.includes('checkpoint') ? 'checkpoint' : 'split' },
      enumerable: false,
      configurable: true,
    })
  }
})()

// ── 软架构判别 ──────────────────────────────────────────────────────────────

export interface ArchAwareItem {
  arch: string
  info?: Record<string, unknown> | null
}

/** 有序规则表: 同后端 _BASE_MODEL_RULES 风格, 先匹配先赢。 */
const _SUB_ARCH_RULES: Array<{ key: string, matches: string[] }> = [
  { key: 'pony', matches: ['pony'] },
  { key: 'illustrious', matches: ['illustrious', 'ilxl'] },
  { key: 'noobai', matches: ['noob'] },
]

/**
 * effectiveArch — 软架构判别 (纯前端)。
 * item.arch !== 'sdxl' → 原样返回 (非 sdxl 家族不判别);
 * item.arch === 'sdxl' 时按 sidecar baseModel (item.info.baseModel) 小写匹配:
 * 含 "pony" → 'pony'; 含 "illustrious"/"ilxl" → 'illustrious'; 含 "noob" → 'noobai';
 * 其余/无 sidecar → 'sdxl'。
 */
export function effectiveArch(item: ArchAwareItem): string {
  if (item.arch !== 'sdxl') return item.arch
  const baseModel = (item.info as Record<string, unknown> | null | undefined)?.baseModel
  if (typeof baseModel !== 'string') return 'sdxl'
  const bm = baseModel.toLowerCase()
  for (const rule of _SUB_ARCH_RULES) {
    if (rule.matches.some(m => bm.includes(m))) return rule.key
  }
  return 'sdxl'
}

/**
 * familyRoot — 软架构家族根。
 * pony/illustrious/noobai/sdxl → 'sdxl'; 其余 → 自身。
 * 用于拦截分级: 判断 currentArch 与 item 的 effectiveArch 是否同属一个硬架构家族。
 */
export function familyRoot(arch: string): string {
  if (arch === 'pony' || arch === 'illustrious' || arch === 'noobai' || arch === 'sdxl') return 'sdxl'
  return arch
}
