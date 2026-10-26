// Stability AI mark (official icon, no wordmark): https://stability.ai/
import sdxlLogo from '@/assets/model-logos/sdxl.png'
import krea2Logo from '@/assets/model-logos/krea2.png'
import tongyiLogo from '@/assets/model-logos/tongyi.png'
import minimaxLogo from '@/assets/model-logos/minimax.png'
import flux1Logo from '@/assets/model-logos/flux1.svg'
import illustriousLogo from '@/assets/model-logos/illustrious.svg'
// Wan official symbol cropped from the official Wan2.1/Wan2.2 logo asset
// (the wordmark is intentionally omitted):
// https://github.com/Wan-Video/Wan2.1/blob/main/assets/logo.png .
// Z-Image and Wan are both Tongyi/Alibaba projects, so sharing this
// organization mark is intentional.

export interface ModelTypeConfig {
  key: string
  label: string
  archFilter: string[]
  /** 该架构支持的打包形态: 'checkpoint' 整合包 + 'split' 三件套。
   *  两形态并存时 picker 合并列表 + 形态过滤 chip + 徽章; 单形态时退化为旧行为。 */
  supportedPackaging: ('checkpoint' | 'split')[]
  /** 默认加载方式，由 supportedPackaging 生成。 */
  readonly loader?: 'checkpoint' | 'split'
  /** DualCLIPLoader (flux1): true 时 AdvancedSettings 显示第二个 CLIP select, submit 带 clip2 */
  dualClip?: boolean
  /** Clip Skip + VAE 覆盖行支持: true 时 AdvancedSettings 显示该行。
   *  判据是文本编码器属 CLIP 家族 — 仅 sd15/sdxl/pony/illustrious/noobai; 与打包形态无关
   *  (DiT 架构选中 checkpoints/ 整合包时不再显示, 避免调了无效)。 */
  clipSkipSupport?: boolean
  /** ControlNet 生态是否可用 (false 时 pose/canny/depth 模块 disabled) */
  controlNetEnabled: boolean
  /** ControlNet 分支: 'sdxl' (sdxl/pony) | 'ilnoob' (illustrious/noobai) | 'flux' (flux1) | 'sd15'; 未设 = CN 面板走通用过滤 */
  cnBranch?: 'sdxl' | 'ilnoob' | 'flux' | 'sd15' | 'zimage' | 'zimage_turbo' | 'qwen_image21' | 'anima' | 'minimax_h3'
  controlTypes?: string[]
  modes?: string[]
  referenceLimit?: number
  fastDefault?: boolean
  /** 使用另一套主权重的快速架构；切换时直接选择对应 ModelState。 */
  fastModel?: string
  menuKey?: string
  modeModels?: Record<string, string[]>
  defaultMode?: string
  fastLocked?: boolean
  runtimeKey?: string
  /** 按模式的 ControlNet 默认参数 (start 恒 0 不需字段); 有该 key 的 mode 新建态取此值 */
  cnDefaults?: Record<string, { strength: number; end: number }>
  resolutions: { label: string; value: string }[]
  resolutionStep?: number
  extraSchedulers?: string[]
  defaults: {
    steps: number
    cfg: number
    sampler: string
    scheduler: string
    /** Clip Skip 默认值 (Pony/Illustrious/NoobAI = 2; 其余缺省 1) */
    clip_skip?: number
  }
  hasNegativePrompt: boolean
  guidance?: 'cfg' | 'guidance' | 'none'
  /** 提示词风格: tags = A1111 tag 格式; natural = 自然语言 */
  promptStyle: 'tags' | 'natural'
  /** 官方推荐默认 CLIP / VAE 文件名 (split 形态, 用于自动填充) */
  defaultModels?: { clip?: string; clip2?: string; vae?: string; audioVae?: string }
  modules: string[]
  extraParams?: Record<string, string | number | boolean>
  /** Logo 资产 URL (静态 import); 缺省走字母徽章 */
  logo?: string
  /** 暗色主题下 logo 反色 (仅纯黑/单色 logo): true → filter: invert(1)
   *  且底板改用透明/深色; 彩色 logo 不应启用 */
  logoInvertDark?: boolean
  /** 软架构: 所属家族 key (如 'sdxl'); 有此字段 = 二级条目 (衍生)。
   *  家族 key 可以不对应 MODEL_TYPES 中的条目 (如 'flux2' 是纯分组, 无同名可选架构)。 */
  familyOf?: string
  /** 提交 payload 的 model_type 覆盖; 软架构条目 = 'sdxl' */
  workflowType?: string
  /** Picker 传给 ModelPickerModal 的 current-arch (显式声明) */
  pickerArch: string
  /** 发布时间 YYYY-MM (取 HuggingFace 官方仓库创建时间); 架构菜单按此排序 */
  releasedAt: string
  /** 媒体类型: 'image' = 图像 (存量 12 条目); 'video' = 视频 (Wan 2.2 等)。
   *  菜单按 activeTask 过滤, 两个任务各自记忆选中架构。 */
  mediaType: 'image' | 'video'
  /** 双 UNet (Wan 2.2 14B): true 时 AdvancedSettings 显示 high/low 两个 UNet 下拉, submit 带 unetHigh/unetLow。
   *  与 dualClip (两种 slot) 不同: 双 UNet 是同类型两件, 走配对折叠, 不沿用双 CLIP 模式。 */
  dualUnet?: boolean
  /** 视频默认参数 (仅 mediaType:'video'): 帧率/时长上限/整除约束/shift/档位预设/速度开关。
   *  档位 = 推荐值 (训练分布内画质最稳); 合法性 = 整除约束 (W/H 须能被 divisor 整除)。
   *  presets 表达 480p/720p 两档 × 横/竖/方 三向; 图生视频默认跟随起始画面比例推导。 */
  videoDefaults?: {
    fps: number
    /** 时长上限 (秒); 帧长公式 frames = fps × duration + 1, 步进 0.5s */
    maxDurationS: number
    /** 宽高整除约束 (14B=16 / 5B=32) */
    divisor: number
    /** ModelSamplingSD3 shift (14B=5.0 / 5B=8.0); H3 (FL2V) 无 shift 不设 */
    shift?: number
    presets: {
      [tier: string]: {
        landscape: { width: number; height: number }
        portrait: { width: number; height: number }
        square: { width: number; height: number }
      }
    }
    /** 速度开关 (仅 14B): true 时 UI 显示快速/标准 SegmentedControl; 5B 不设 = 无开关 */
    speedToggle?: boolean
    /** 时长滑块下限 (秒); 缺省 1 (H3 = 4) */
    durationMin?: number
    /** 时长滑块步进 (秒); 缺省 0.5 (H3 = 1, 整数秒) */
    durationStep?: number
    /** 帧长对齐网格 (H3 = 17, 帧数须 ≡ frameGridOffset mod frameGrid); 缺省 = 不约束 */
    frameGrid?: number
    /** 帧长对齐网格偏移 (H3 = 5, 即 17k+5); 仅 frameGrid 存在时有意义 */
    frameGridOffset?: number
    /** 像素预算 (W×H); 缺省 921600 (Wan 720p) */
    maxPixels?: number
  }
  /** 条目内可切换的视频模式 (单条目双模式, 如 5B 的 t2v/i2v); 14B t2v/i2v 为独立条目不设此字段 */
  videoModes?: ('t2v' | 'i2v' | 'ref')[]
}

/** 架构 key → 展示标签。新增架构在此加一行 (检测输出的 arch 值为 key)。 */
export const ARCH_LABELS: Record<string, string> = {
  sdxl: 'SDXL', sd15: 'SD 1.5', sd3: 'SD 3',
  anima: 'Anima', krea2: 'Krea 2', zimage: 'Z-Image',
  flux: 'Flux 1', flux2: 'Flux 2', chroma: 'Chroma',
  pony: 'Pony', illustrious: 'Illustrious', noobai: 'NoobAI',
  // 视频架构 — 与后端 arch_detect 输出值同名 (细粒度: i2v/t2v 权重不可互换)
  wan22: 'Wan 2.2', wan: 'Wan', wan21: 'Wan 2.1',
  wan22_i2v: 'Wan 2.2 图生视频', wan22_t2v: 'Wan 2.2 文生视频', wan22_5b: 'Wan 2.2 5B',
  hunyuan: 'HunyuanVideo', ltxv: 'LTX-V',
  // ComfyUI detect_unet_config 全架构覆盖 (arch_detect.py 合入)
  // CivitAI baseModel 枚举有的严格用原文; CivitAI 无的用 ComfyUI image_model 官方名
  stablecascade: 'Stable Cascade',  // CivitAI
  auraflow: 'AuraFlow',             // CivitAI
  mochi: 'Mochi',                   // CivitAI
  minimax_h3: 'MiniMax H3',         // CivitAI
  pixart: 'PixArt',                 // CivitAI (PixArt a / PixArt E 合并)
  hunyuan3d: 'Hunyuan3D',           // CivitAI
  boogu: 'Boogu',                   // CivitAI
  mage_flow: 'MageFlow',            // CivitAI
  ideogram4: 'Ideogram 4.0',        // CivitAI
  lumina2: 'Lumina',                // CivitAI
  // ComfyUI 独有 (CivitAI 无枚举, 用 ComfyUI image_model 官方名)
  stableaudio: 'Stable Audio', hydit: 'Hunyuan DiT',
  cosmos: 'Cosmos', cosmos_predict2: 'Cosmos Predict 2',
  pid: 'PiD', seedvr2: 'SeedVR2',
  depthanything3: 'Depth Anything 3', sam3: 'SAM 3', joyimage: 'JoyImage',
  chroma_radiance: 'Chroma Radiance', ovis: 'Ovis',
  longcat: 'LongCat',
  'ace1.5': 'ACE 1.5',
  // 补全 arch_detect 全架构 (审计 Q6)
  hidream: 'HiDream', cogvideox: 'CogVideoX', ernie: 'Ernie Image',
  lens: 'Lens', qwen: 'Qwen Image', qwen_image21: 'Qwen Image 2.1', acestep: 'ACE-Step',
  svd: 'SVD', kandinsky5: 'Kandinsky 5', pixeldit: 'PixelDiT',
  newbie: 'NewBie', omnigen2: 'OmniGen2', triposplat: 'TripoSplat',
  lotus: 'Lotus', rtdetr: 'RT-DETR', t5: 'T5', qwen35: 'Qwen 3.5',
  sdpose: 'SDPose', hunyuanimage: 'Hunyuan Image',
  // 放大模型 (非扩散, arch_detect 张量结构判别)
  realesrgan: 'Real-ESRGAN', esrgan: 'ESRGAN',
  unknown: '?',
}

const MODEL_CONFIGS: Record<string, ModelTypeConfig> = {
  sdxl: {
    key: 'sdxl',
    label: 'SDXL',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'sdxl',
    clipSkipSupport: true,
    logo: sdxlLogo,
    pickerArch: 'sdxl',
    releasedAt: '2023-07',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    defaults: { steps: 20, cfg: 7.0, sampler: 'euler', scheduler: 'normal' },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  sd15: {
    key: 'sd15',
    label: 'SD 1.5',
    archFilter: ['sd15'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'sd15',
    clipSkipSupport: true,
    // Stable Diffusion 系列统一沿用现有 Stability AI 官方标记，保持模型入口视觉一致。
    logo: sdxlLogo,
    pickerArch: 'sd15',
    releasedAt: '2022-10',
    mediaType: 'image',
    resolutions: [
      { label: '512×512', value: '512x512' },
      { label: '768×512', value: '768x512' },
      { label: '512×768', value: '512x768' },
      { label: '896×512', value: '896x512' },
      { label: '512×896', value: '512x896' },
      { label: '640×512', value: '640x512' },
      { label: '512×640', value: '512x640' },
    ],
    defaults: { steps: 20, cfg: 7.0, sampler: 'euler_ancestral', scheduler: 'normal' },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  anima: {
    key: 'anima',
    label: 'Anima',
    archFilter: ['anima'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: true,
    cnBranch: 'anima',
    controlTypes: ['canny', 'depth', 'lineart'],
    pickerArch: 'anima',
    releasedAt: '2026-01',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    // Anima 官方推荐: steps=30, cfg 4-6, sampler=er_sde, scheduler=simple
    defaults: { steps: 30, cfg: 4.0, sampler: 'er_sde', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    defaultModels: { clip: 'qwen_3_06b_base.safetensors', vae: 'qwen_image_vae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  qwen_image21: {
    key: 'qwen_image21',
    label: 'Qwen Image 2.1',
    archFilter: ['qwen_image21'],
    supportedPackaging: ['split'],
    controlNetEnabled: true,
    cnBranch: 'qwen_image21',
    controlTypes: ['pose', 'canny', 'depth', 'lineart'],
    modes: ['t2i', 'ref'],
    referenceLimit: 16,
    logo: tongyiLogo,
    pickerArch: 'qwen_image21',
    releasedAt: '2026-09',
    mediaType: 'image',
    resolutionStep: 16,
    extraSchedulers: ['qwen_image21_turbo'],
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '2048×2048', value: '2048x2048' },
      { label: '2400×1792', value: '2400x1792' },
      { label: '1792×2400', value: '1792x2400' },
      { label: '2528×1696', value: '2528x1696' },
      { label: '1696×2528', value: '1696x2528' },
      { label: '2752×1536', value: '2752x1536' },
      { label: '1536×2752', value: '1536x2752' },
    ],
    defaults: { steps: 25, cfg: 1.0, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 'qwen3vl_8b_int8_convrot.safetensors', vae: 'qwen_image_2.1_vae_bf16.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  krea2: {
    key: 'krea2',
    label: 'Krea 2',
    fastModel: 'krea2_turbo',
    modes: ['t2i', 'ref'],
    modeModels: { t2i: ['krea2', 'krea2_turbo'], ref: ['krea2_turbo'] },
    referenceLimit: 2,
    archFilter: ['krea2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    logo: krea2Logo,
    pickerArch: 'krea2',
    releasedAt: '2026-06',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×1536', value: '1536x1536' },
      { label: '2048×1152', value: '2048x1152' },
      { label: '1152×2048', value: '1152x2048' },
      { label: '2048×2048', value: '2048x2048' },
    ],
    defaults: { steps: 28, cfg: 4, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 'qwen3vl_4b_fp8_scaled.safetensors', vae: 'qwen_image_vae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  zimage: {
    key: 'zimage',
    label: 'Z-Image',
    fastModel: 'zimage_turbo',
    archFilter: ['zimage'],
    supportedPackaging: ['split'],
    controlNetEnabled: true,
    cnBranch: 'zimage',
    controlTypes: ['pose', 'canny', 'depth', 'tile'],
    logo: tongyiLogo,
    pickerArch: 'zimage',
    releasedAt: '2025-11',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    defaults: { steps: 25, cfg: 4.0, sampler: 'res_multistep', scheduler: 'simple' },
    hasNegativePrompt: true,
    promptStyle: 'natural',  // 中英双语原生
    defaultModels: { clip: 'qwen_3_4b.safetensors', vae: 'ae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  flux1: {
    key: 'flux1',
    label: 'Flux 1',
    fastModel: 'flux1_schnell',
    modes: ['t2i', 'ref'],
    modeModels: { t2i: ['flux1', 'flux1_schnell'], ref: ['flux1_kontext'] },
    referenceLimit: 1,
    archFilter: ['flux'],
    supportedPackaging: ['checkpoint', 'split'],
    dualClip: true,
    controlNetEnabled: true,  // Union Pro 2.0 FP8 (InstantX/Shakker)
    cnBranch: 'flux',
    controlTypes: ['pose', 'canny', 'depth', 'lineart', 'tile'],
    cnDefaults: {
      pose:  { strength: 0.9, end: 0.65 },
      canny: { strength: 0.7, end: 0.8 },
      depth: { strength: 0.8, end: 0.8 },
      lineart: { strength: 0.65, end: 1 },
      tile: { strength: 0.6, end: 1 },
    },
    logo: flux1Logo,
    // Black Forest Labs official standalone symbol, transparent/no wordmark:
    // https://bfl.ai/brand
    pickerArch: 'flux',
    releasedAt: '2024-07',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    // 官方模板 flux_dev_full_text_to_image.json 实测值
    defaults: { steps: 20, cfg: 1.0, sampler: 'euler', scheduler: 'simple' },
    hasNegativePrompt: false,
    promptStyle: 'natural',
    defaultModels: { clip: 'clip_l.safetensors', clip2: 't5xxl_fp8_e4m3fn_scaled.safetensors', vae: 'ae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  chroma: {
    key: 'chroma',
    label: 'Chroma',
    archFilter: ['chroma'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    familyOf: 'flux1',
    pickerArch: 'chroma',
    releasedAt: '2025-08',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    defaults: { steps: 26, cfg: 3.5, sampler: 'euler', scheduler: 'beta' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 't5xxl_fp8_e4m3fn_scaled.safetensors', vae: 'ae.safetensors' },
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  // ── Flux2 系列 (Klein 4B / Klein 9B / Dev) ──
  // 采样拓扑与 flux1 不同: SamplerCustomAdvanced + Flux2Scheduler + FluxGuidance/CFGGuider。
  // guider_mode 由 extraParams 注入 payload, 后端 build_flux2_workflow 据此分支。
  // Klein 有 4B / 9B 两尺寸, 文本编码器互不兼容 (4B→qwen_3_4b, 9B→qwen_3_8b_fp8mixed),
  // 且无法从 UNet 可靠判别 → 拆为两个条目由用户显式选择。
  flux2klein4b: {
    key: 'flux2klein4b',
    label: 'Flux 2 Klein 4B',
    fastModel: 'flux2klein4b_distilled',
    modes: ['t2i', 'ref'],
    referenceLimit: 4,
    archFilter: ['flux2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    // Flux 2 is also published by Black Forest Labs; reuse its official symbol.
    logo: flux1Logo,
    pickerArch: 'flux2',
    releasedAt: '2026-01',
    familyOf: 'flux2',
    mediaType: 'image',
    // key 为 flux2klein4b, 但后端 builder / _SPLIT_ARCHS / guider_mode 归一化均以 'flux2' 为键 → 必须提交 flux2
    workflowType: 'flux2',
    extraParams: { guider_mode: 'cfg' },
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    extraSchedulers: ['flux2'],
    defaults: { steps: 20, cfg: 5, sampler: 'euler', scheduler: 'flux2' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 'qwen_3_4b.safetensors', vae: 'flux2-vae.safetensors' },
    // flux2 采样走 SamplerCustomAdvanced, i2i/hires 需 SplitSigmas 分段去噪 (未实装) → 仅 t2i + 放大
    modules: ['lora', 'upscale'],
  },
  flux2klein9b: {
    key: 'flux2klein9b',
    label: 'Flux 2 Klein 9B',
    fastModel: 'flux2klein9b_distilled',
    modes: ['t2i', 'ref'],
    referenceLimit: 4,
    archFilter: ['flux2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    // Flux 2 is also published by Black Forest Labs; reuse its official symbol.
    logo: flux1Logo,
    pickerArch: 'flux2',
    releasedAt: '2026-01',
    familyOf: 'flux2',
    mediaType: 'image',
    // key 为 flux2klein9b, 但后端 builder / _SPLIT_ARCHS / guider_mode 归一化均以 'flux2' 为键 → 必须提交 flux2
    workflowType: 'flux2',
    extraParams: { guider_mode: 'cfg' },
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    extraSchedulers: ['flux2'],
    defaults: { steps: 20, cfg: 5, sampler: 'euler', scheduler: 'flux2' },
    hasNegativePrompt: true,
    promptStyle: 'natural',
    defaultModels: { clip: 'qwen_3_8b_fp8mixed.safetensors', vae: 'flux2-vae.safetensors' },
    // flux2 采样走 SamplerCustomAdvanced, i2i/hires 需 SplitSigmas 分段去噪 (未实装) → 仅 t2i + 放大
    modules: ['lora', 'upscale'],
  },
  flux2dev: {
    key: 'flux2dev',
    label: 'Flux 2 Dev',
    modes: ['t2i', 'ref'],
    referenceLimit: 4,
    guidance: 'guidance',
    archFilter: ['flux2'],
    supportedPackaging: ['checkpoint', 'split'],
    controlNetEnabled: false,
    // Flux 2 is also published by Black Forest Labs; reuse its official symbol.
    logo: flux1Logo,
    pickerArch: 'flux2',
    releasedAt: '2026-01',
    familyOf: 'flux2',
    mediaType: 'image',
    workflowType: 'flux2',
    extraParams: { guider_mode: 'basic' },
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    extraSchedulers: ['flux2', 'flux2_turbo'],
    defaults: { steps: 20, cfg: 4.0, sampler: 'euler', scheduler: 'flux2' },
    hasNegativePrompt: false,
    promptStyle: 'natural',
    defaultModels: { clip: 'mistral_3_small_flux2_fp8.safetensors', vae: 'flux2-vae.safetensors' },
    // flux2 采样走 SamplerCustomAdvanced, i2i/hires 需 SplitSigmas 分段去噪 (未实装) → 仅 t2i + 放大
    modules: ['lora', 'upscale'],
  },
  // ── SDXL 软架构 (衍生条目: Pony / Illustrious / NoobAI) ──
  // arch 层面仍是 sdxl, workflow 编排零改动 — 通过 workflowType 提交 sdxl,
  // 由 effectiveArch() 按模型索引中的 baseModel 判别, picker/拦截分级处理。
  pony: {
    key: 'pony',
    label: 'Pony',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'sdxl',
    clipSkipSupport: true,
    familyOf: 'sdxl',
    workflowType: 'sdxl',
    pickerArch: 'pony',
    releasedAt: '2023-08',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    // Pony V6 官方推荐: 25 步 / cfg 7 / euler_ancestral / clip_skip 2
    defaults: { steps: 25, cfg: 7.0, sampler: 'euler_ancestral', scheduler: 'normal', clip_skip: 2 },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  illustrious: {
    key: 'illustrious',
    label: 'Illustrious',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    logo: illustriousLogo,
    cnBranch: 'ilnoob',
    clipSkipSupport: true,
    familyOf: 'sdxl',
    workflowType: 'sdxl',
    pickerArch: 'illustrious',
    releasedAt: '2024-09',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    // Illustrious 官方指南: 28 步 / cfg 5 / euler_ancestral / clip_skip 2
    defaults: { steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', clip_skip: 2 },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  noobai: {
    key: 'noobai',
    label: 'NoobAI',
    archFilter: ['sdxl'],
    supportedPackaging: ['checkpoint'],
    controlNetEnabled: true,
    cnBranch: 'ilnoob',
    clipSkipSupport: true,
    familyOf: 'sdxl',
    workflowType: 'sdxl',
    pickerArch: 'noobai',
    releasedAt: '2024-11',
    mediaType: 'image',
    resolutions: [
      { label: '1024×1024', value: '1024x1024' },
      { label: '1152×896', value: '1152x896' },
      { label: '896×1152', value: '896x1152' },
      { label: '1216×832', value: '1216x832' },
      { label: '832×1216', value: '832x1216' },
      { label: '1344×768', value: '1344x768' },
      { label: '768×1344', value: '768x1344' },
      { label: '1536×640', value: '1536x640' },
      { label: '640×1536', value: '640x1536' },
    ],
    defaults: { steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', clip_skip: 2 },
    hasNegativePrompt: true,
    promptStyle: 'tags',
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires', 'face'],
  },
  // ── Wan 2.2 系列 (Alibaba 2025-07, Apache 2.0) ── 视频
  // 三条目 familyOf:'wan22'; 双 UNet (14B) = high/low 同类型两件, 走配对折叠
  // 不沿用 dualClip 双 CLIP 模式; 校验走独立 _VIDEO_ARCHS 分支 (不并入 _SPLIT_ARCHS)。
  // 菜单标签走 i18n key generate.tabs.wan22_*, 不硬编码中文; label 仅作字母徽章/AdvancedSettings 兜底。
  wan22_i2v: {
    key: 'wan22_i2v',
    label: 'Wan 2.2 14B',
    videoModes: ['t2v', 'i2v'],
    modeModels: { t2v: ['wan22_t2v'], i2v: ['wan22_i2v'] },
    defaultMode: 'i2v',
    fastDefault: true,
    logo: tongyiLogo,
    archFilter: ['wan22_i2v', 'wan'],
    supportedPackaging: ['split'],
    // 14B 双 UNet (high/low 两件 fp8); 视频主权重用户自行获取, 落盘后 arch_detect 配对识别
    dualUnet: true,
    controlNetEnabled: false,
    mediaType: 'video',
    familyOf: 'wan22',
    workflowType: 'wan22',
    modules: ['lora'],
    promptStyle: 'natural',  // 视频提示词: 主体→动作→镜头→场景
    hasNegativePrompt: true,
    pickerArch: 'wan22_i2v',
    releasedAt: '2025-07',
    // 视频不沿用图像 resolutions; 档位走 videoDefaults.presets
    resolutions: [],
    // 官方模板 video_wan2_2_14B_i2v.json 实测值: 双段 KSamplerAdvanced euler/simple, shift=5.0, fps=16
    defaults: { steps: 20, cfg: 3.5, sampler: 'euler', scheduler: 'simple' },
    defaultModels: {
      clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
      vae: 'wan_2.1_vae.safetensors',
    },
    videoDefaults: {
      fps: 16,
      maxDurationS: 7,  // 帧长 frames = 16×7+1 = 113
      divisor: 16,  // W/H 整除约束 (14B)
      shift: 5.0,  // ModelSamplingSD3
      speedToggle: true,  // 速度开关: 快速(默认 4步/cfg1.0, 挂 lightning LoRA 对) / 标准(20步/cfg3.5)
      presets: {
        '480p': {
          landscape: { width: 832, height: 480 },
          portrait: { width: 480, height: 832 },
          square: { width: 640, height: 640 },
        },
        '720p': {
          landscape: { width: 1280, height: 720 },
          portrait: { width: 720, height: 1280 },
          square: { width: 960, height: 960 },
        },
      },
    },
  },
  wan22_5b: {
    key: 'wan22_5b',
    label: 'Wan 2.2 5B',
    logo: tongyiLogo,
    archFilter: ['wan22_5b', 'wan'],
    supportedPackaging: ['split'],
    // 5B 单权重双模式 (t2v/i2v), 不走双 UNet; LoadImage bypass 即模式切换
    dualUnet: false,
    controlNetEnabled: false,
    mediaType: 'video',
    familyOf: 'wan22',
    workflowType: 'wan22',
    modules: ['lora'],
    promptStyle: 'natural',
    hasNegativePrompt: true,  // 5B 无速度开关, 负面恒显示
    pickerArch: 'wan22_5b',
    releasedAt: '2025-07',
    resolutions: [],
    // 官方模板 video_wan2_2_5B_ti2v.json: 单 KSampler uni_pc/simple, shift=8.0, fps=24
    defaults: { steps: 20, cfg: 5.0, sampler: 'uni_pc', scheduler: 'simple' },
    defaultModels: {
      clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
      vae: 'wan2.2_vae.safetensors',  // 5B 专属 VAE (16×16×4 压缩)
    },
    videoModes: ['t2v', 'i2v'],
    videoDefaults: {
      fps: 24,
      maxDurationS: 5,  // frames = 24×5+1 = 121; 模板默认 length=121
      divisor: 32,  // W/H 整除约束 (5B)
      shift: 8.0,  // ModelSamplingSD3
      presets: {
        '480p': {
          landscape: { width: 832, height: 448 },
          portrait: { width: 448, height: 832 },
          square: { width: 640, height: 640 },
        },
        '720p': {
          landscape: { width: 1280, height: 704 },
          portrait: { width: 704, height: 1280 },
          square: { width: 960, height: 960 },
        },
      },
    },
  },
  minimax_h3: {
    key: 'minimax_h3',
    label: 'MiniMax H3',
    logo: minimaxLogo,
    archFilter: ['minimax_h3'],
    supportedPackaging: ['split'],
    dualUnet: false,
    controlNetEnabled: true,
    cnBranch: 'minimax_h3',
    controlTypes: ['pose', 'canny', 'depth', 'lineart'],
    mediaType: 'video',
    modules: ['lora', 'controlnet'],
    promptStyle: 'natural',
    hasNegativePrompt: false,  // CFG-distilled, 无负面提示词
    guidance: 'none',
    pickerArch: 'minimax_h3',
    releasedAt: '2026-08',
    resolutions: [],
    defaults: { steps: 20, cfg: 1.0, sampler: 'res_multistep', scheduler: 'simple' },
    defaultModels: {
      clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      vae: 'minimax_h3_video_vae_fp16.safetensors',
      audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
    },
    videoModes: ['t2v', 'i2v', 'ref'],
    modeModels: { t2v: ['minimax_h3'], i2v: ['minimax_h3'], ref: ['minimax_h3_ref'] },
    videoDefaults: {
      fps: 24,
      maxDurationS: 15,  // 整数秒 4-15
      durationMin: 4,  // 最短 4 秒
      durationStep: 1,  // 整数秒步进 (H3 无 0.5s)
      divisor: 32,
      // 帧长须落在 17k+5 网格 (FL2V latent 约束); 无 shift/speedToggle
      frameGrid: 17,
      frameGridOffset: 5,
      maxPixels: 1032192,  // 预算 ≈ 1344×768
      presets: {
        '768p': {
          landscape: { width: 1344, height: 768 },
          portrait: { width: 768, height: 1344 },
          square: { width: 768, height: 768 },
        },
      },
    },
  },
}

export const MODEL_VARIANTS: Record<string, { base: string } & Partial<ModelTypeConfig>> = {
  zimage_turbo: {
    base: 'zimage', menuKey: 'zimage', runtimeKey: 'zimage', workflowType: 'zimage',
    fastDefault: true, cnBranch: 'zimage_turbo',
    defaults: { steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple' },
    hasNegativePrompt: false,
  },
  krea2_turbo: {
    base: 'krea2', menuKey: 'krea2', runtimeKey: 'krea2', workflowType: 'krea2',
    fastDefault: true, hasNegativePrompt: false,
    defaults: { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' },
  },
  flux1_schnell: {
    base: 'flux1', menuKey: 'flux1', runtimeKey: 'flux1', workflowType: 'flux1',
    fastDefault: true, controlNetEnabled: false,
    defaults: { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple' },
  },
  flux1_kontext: {
    base: 'flux1', menuKey: 'flux1', runtimeKey: 'flux1', workflowType: 'flux1',
    defaultMode: 'ref', controlNetEnabled: false,
  },
  flux2klein4b_distilled: {
    base: 'flux2klein4b', menuKey: 'flux2klein4b', runtimeKey: 'flux2klein4b',
    fastDefault: true, hasNegativePrompt: false,
    defaults: { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'flux2' },
  },
  flux2klein9b_distilled: {
    base: 'flux2klein9b', menuKey: 'flux2klein9b', runtimeKey: 'flux2klein9b',
    fastDefault: true, hasNegativePrompt: false,
    defaults: { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'flux2' },
  },
  wan22_t2v: {
    base: 'wan22_i2v', menuKey: 'wan22_i2v', defaultMode: 't2v',
    archFilter: ['wan22_t2v', 'wan'], pickerArch: 'wan22_t2v',
  },
  minimax_h3_ref: {
    base: 'minimax_h3', menuKey: 'minimax_h3', defaultMode: 'ref',
  },
  noobai_vpred: {
    base: 'noobai', label: 'NoobAI V-Pred',
    defaults: { steps: 28, cfg: 4.5, sampler: 'euler', scheduler: 'normal', clip_skip: 2 },
  },
}

export const WAN22_FAST_SAMPLING = { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple' }

export const FAST_PRESETS: Record<string, ModelTypeConfig['defaults']> = {
  anima: { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' },
  qwen_image21: { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'qwen_image21_turbo' },
  flux2dev: { steps: 8, cfg: 2.5, sampler: 'euler', scheduler: 'flux2_turbo' },
  wan22_i2v: WAN22_FAST_SAMPLING,
  wan22_t2v: WAN22_FAST_SAMPLING,
  minimax_h3: { steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple' },
  minimax_h3_ref: { steps: 4, cfg: 1, sampler: 'res_multistep', scheduler: 'simple' },
}

export const MODEL_TYPES: Record<string, ModelTypeConfig> = Object.fromEntries(
  [...Object.entries(MODEL_CONFIGS), ...Object.entries(MODEL_VARIANTS).map(([key, { base, ...variant }]) =>
    [key, { ...MODEL_CONFIGS[base]!, ...variant, key }] as const,
  )].map(([key, config]) => [key, {
    ...config, loader: config.supportedPackaging.includes('checkpoint') ? 'checkpoint' : 'split',
  }]),
)

export const MODEL_MENU = Object.values(MODEL_TYPES).filter(config => !config.menuKey)

export function modelsForMode(type: string, mode: string): string[] {
  const config = MODEL_TYPES[MODEL_TYPES[type]!.menuKey ?? type]!
  return config.modeModels?.[mode] ?? [config.key, ...(config.fastModel ? [config.fastModel] : [])]
}

export function modelConfig(type: string, fast: boolean, mode?: string): ModelTypeConfig {
  const base = MODEL_TYPES[type]!
  return {
    ...base, runtimeKey: base.runtimeKey ?? type,
    resolutionStep: type === 'qwen_image21' && mode === 'ref' ? 32 : base.resolutionStep,
    fastLocked: !!base.fastModel && modelsForMode(type, mode ?? base.defaultMode ?? 't2i').length === 1,
    defaults: fast && FAST_PRESETS[type] ? FAST_PRESETS[type]! : base.defaults,
    hasNegativePrompt: type === 'anima' && fast ? false : base.hasNegativePrompt,
  }
}

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
