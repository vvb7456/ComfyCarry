import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import type { ModelTypeConfig } from '@/config/model-types'
import { MODEL_TYPES } from '@/config/model-types'
import { redirectToLogin } from '@/composables/useApiFetch'
import { workspaceFiles, type WorkspaceFile } from '@/composables/generate/workspaceFiles'

export interface LoraEntry {
  name: string
  strength: number
  enabled: boolean
  /** 视频双段 LoRA 的挂载段 (仅 mediaType:'video' 架构有意义): 'high' 仅高噪 / 'low' 仅低噪 / 'both' 双段 (默认)。
   *  5B 单权重架构恒 'both'; 14B 高/low 配对折叠时由配对结果隐式定 both。 */
  apply?: 'high' | 'low' | 'both'
}

/** 单条参考素材 (MiniMax H3 Ref2VA): type 为素材类别, name 为 input/ 内文件名。
 *  同 type 内的顺序即引用编号 (<Picture 1> / <Video 1> / <Audio 1>)。 */
export interface RefItem {
  type: 'image' | 'video' | 'audio'
  name: string
}

/** 视频生成态 (仅 mediaType:'video' 架构的 ModelState 使用)。
 *  durationS 滑块 0.5s 步进; width/height 取自档位 presets 并按整除吸附;
 *  refImage = 起始画面文件名 (i2v 必填)。
 *  mode 仅 wan22_5b 等单条目双模式条目使用 (条目内 t2v/i2v 开关), 14B t2v/i2v 为独立条目不设。
 *
 *  resolution (v5, 取代 v4 的 followRef): 分辨率下拉的选中值, 与图像页 state.resolution
 *  的哨兵体系同构 —— `'ref'` = 贴合起始画面 (尺寸动态推导), `'<W>x<H>'` = 档位预设,
 *  `'custom'` = 用户自定义。刻意**不复用** state.resolution: BasicSettings 对它有一个
 *  「拆 WxH 写回 state.width/height」的图像侧 watch, 视频写进去会产生无用的交叉写入。 */
export interface VideoState {
  mode?: 't2v' | 'i2v'
  refImage: string
  lastImage: string
  resolution: string
  durationS: number
  width: number
  height: number
  /** 多路参考素材 (MiniMax H3 Ref2VA, 单条目 'minimax_h3_ref'); 其余架构恒 [] */
  refs: RefItem[]
}

export interface ControlNetState {
  enabled: boolean
  model: string
  strength: number
  start: number
  end: number
  image: string | null
}

export interface UpscaleState {
  enabled: boolean
  factor: number
  mode: string
  tile: number
  downscale: string
  engine: 'aurasr' | 'seedvr2'
  svrModel: string
  svrColorCorrection: string
  svrInputNoise: number
  svrLatentNoise: number
  svrTiledVae: boolean
}

export interface HiResState {
  enabled: boolean
  /** 潜空间放大倍率 (1.0 = 不放大, 仅原生分辨率精修); 最终尺寸 = 底图 × 本倍率 × 放大模块倍率 */
  scale: number
  /** LatentUpscaleBy 插值方式 */
  upscaleMethod: string
  denoise: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  seedMode: 'random' | 'fixed'
  seedValue: number
}

export interface I2IState {
  enabled: boolean
  image: string | null
  denoise: number
  mode: 'i2i' | 'inpaint'
  mask: string | null
  growMaskBy: number
}

export interface FaceDetailerState {
  enabled: boolean
  /** 检测模型文件名 (不含 bbox/ 前缀, builder 端拼接) */
  detectionModel: string
  denoise: number
  steps: number
  /** '' = 继承主提示词; 非空 = 独立编码 */
  prompt: string
  cfg: number
  guideSize: number
  cropFactor: number
  bboxThreshold: number
  feather: number
  useSam: boolean
}

export interface DisabledToken {
  raw: string
  tag: string
  type: string
  weight: number
  bracketType: string
  bracketDepth: number
  explicitWeight: boolean
  index: number       // position in token list when disabled
  translate?: string
}

export interface ModelState {
  files?: WorkspaceFile[]
  positive: string
  negative: string
  positiveDisabled: DisabledToken[]
  negativeDisabled: DisabledToken[]
  checkpoint: string
  // Anima 三件套 (仅 model_type='anima' 使用)
  unet: string
  // Wan 2.2 14B 双 UNet (high/low 两件 fp8, 配对折叠); 5B 单权重沿用 unet
  unetHigh: string
  unetLow: string
  clip: string
  // Flux1 双 CLIP (DualCLIPLoader type='flux'); 其余架构留空
  clip2: string
  vae: string
  // 音频 VAE (MiniMax H3 音视频一体); 其余架构留空
  audioVae: string
  loras: LoraEntry[]
  resolution: string
  width: number
  height: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  seedMode: 'random' | 'fixed'
  seedValue: number
  batch: number
  prefix: string
  format: string
  runMode: 'normal' | 'live' | 'background'
  /** Clip Skip (checkpoint 系专属): 1~4, 默认取 config.defaults.clip_skip ?? 1 */
  clipSkip: number
  /** 后台运行模式: 轮次上限, 0 = 无限 */
  maxIterations: number
  /** VAE 覆盖 (checkpoint 系专属): 空串 = 跟随 Checkpoint; 非空 = 用独立 VAELoader */
  vaeOverride: string
  controlNets: Record<string, ControlNetState>
  upscale: UpscaleState
  hires: HiResState
  i2i: I2IState
  faceDetailer: FaceDetailerState
  activeModule: string
  /** 视频生成态 (仅 mediaType:'video' 架构使用); 图像架构恒为 undefined */
  video?: VideoState
  /** 速度开关 (仅 14B 视频条目): true=快速(默认 4步/cfg1.0, 挂 lightning 对) / false=标准(20步/cfg3.5)。
   *  5B 不设 speedToggle, 此字段无意义但保留默认 true 不影响。 */
  fast: boolean
}

const SCHEMA_VERSION = 5
const SAVE_DEBOUNCE_MS = 300
const SAVE_RETRY_MAX = 5

/** 状态装载结果。failed 时**不得**开启自动保存, 否则会用默认值覆盖服务端。 */
export type RestoreOutcome = 'applied' | 'empty' | 'failed' | 'incompatible'

export interface RestoreResult {
  outcome: RestoreOutcome
}

/** 视频架构的默认视频态: 从 config.videoDefaults 推导。
 *  durationS 默认 5; width/height 取默认档 landscape (优先 720p, 缺失时回退到第一个档位, 如 H3 的 768p);
 *  refImage 空。resolution 默认指向那一档预设本身 (自洽: 下拉选中项与 width/height 一致);
 *  用户上传起始画面后由 VideoSettings 自动切到 'ref' (贴合项)。 */
export function createDefaultVideoState(config: ModelTypeConfig): VideoState {
  const vd = config.videoDefaults
  const presets = vd?.presets
  const p720 = presets?.['720p'] ?? Object.values(presets ?? {})[0]
  const w = p720?.landscape?.width ?? 1280
  const h = p720?.landscape?.height ?? 720
  return {
    refImage: '',
    lastImage: '',
    refs: [],
    resolution: `${w}x${h}`,
    durationS: 5,
    width: w,
    height: h,
    // 条目内双模式 (5B) 必须有初值, 否则消费侧要各自兜底且提交链可能读到 undefined。
    // 默认取 i2v (产品重心是「把自己的图动起来」); videoModes 的数组顺序只决定
    // SegmentedControl 的显示顺序, 不代表默认值。单模式条目 (14B) 不设此字段。
    ...(config.videoModes?.length
      ? { mode: config.videoModes.includes('i2v') ? 'i2v' as const : config.videoModes[0] }
      : {}),
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

export function createDefaultState(config: ModelTypeConfig): ModelState {
  const cnTypes = ['pose', 'canny', 'depth']
  const controlNets: Record<string, ControlNetState> = {}
  cnTypes.forEach(t => {
    const d = config.cnDefaults?.[t]
    controlNets[t] = {
      enabled: false, model: '',
      strength: d?.strength ?? 1,
      start: 0,
      end: d?.end ?? 1,
      image: null,
    }
  })

  const resolution = config.resolutions[0]?.value || '1024x1024'
  const [width, height] = resolution.split('x').map(Number)

  return {
    positive: '',
    negative: '',
    positiveDisabled: [],
    negativeDisabled: [],
    checkpoint: '',
    unet: '',
    unetHigh: '',
    unetLow: '',
    clip: '',
    clip2: '',
    vae: '',
    audioVae: '',
    loras: [],
    resolution,
    width: width || 1024,
    height: height || 1024,
    steps: config.defaults.steps,
    cfg: config.defaults.cfg,
    sampler: config.defaults.sampler,
    scheduler: config.defaults.scheduler,
    seedMode: 'random',
    seedValue: randomSeed(),
    batch: 1,
    prefix: '[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]',
    format: 'png',
    runMode: 'normal',
    clipSkip: config.defaults.clip_skip ?? 1,
    vaeOverride: '',
    maxIterations: 0,
    controlNets,
    upscale: {
      enabled: false, factor: 2, mode: '4x_overlapped_checkboard', tile: 8, downscale: 'lanczos',
      engine: 'aurasr',
      svrModel: 'seedvr2_ema_3b_fp8_e4m3fn.safetensors',
      svrColorCorrection: 'lab',
      svrInputNoise: 0,
      svrLatentNoise: 0,
      svrTiledVae: false,
    },
    hires: { enabled: false, scale: 1.5, upscaleMethod: 'bislerp', denoise: 0.4, steps: 20, cfg: 7, sampler: 'euler', scheduler: 'normal', seedMode: 'random', seedValue: randomSeed() },
    i2i: { enabled: false, image: null, denoise: 0.7, mode: 'i2i', mask: null, growMaskBy: 6 },
    faceDetailer: {
      enabled: false, detectionModel: 'face_yolov8m.pt', denoise: 0.35, steps: 20,
      prompt: '', cfg: 7, guideSize: 768, cropFactor: 1.8, bboxThreshold: 0.5,
      feather: 5, useSam: false,
    },
    activeModule: config.modules[0] || 'lora',
    video: config.mediaType === 'video' ? createDefaultVideoState(config) : undefined,
    fast: true,
  }
}

/**
 * Migrate v1 (old format) data to v2.
 * v1: loras was Record<string, number>, no runMode, wrong defaults
 */
export function migrateV1(state: Record<string, unknown>): ModelState | null {
  try {
    const s = state as Record<string, unknown>
    const oldLoras = s.loras as Record<string, number> | LoraEntry[] | undefined
    let loras: LoraEntry[] = []
    if (oldLoras && !Array.isArray(oldLoras)) {
      loras = Object.entries(oldLoras).map(([name, strength]) => ({
        name,
        strength: Number(strength) || 1,
        enabled: true,
      }))
    } else if (Array.isArray(oldLoras)) {
      loras = oldLoras
    }
    s.loras = loras

    if (!s.runMode || s.runMode === 'onChange') {
      s.runMode = 'normal'
    }

    if (!s.prefix) {
      s.prefix = '[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]'
    }

    const i2i = s.i2i as I2IState | undefined
    if (i2i) {
      i2i.denoise = Math.max(0.10, Math.min(0.90, i2i.denoise))
    }

    return s as unknown as ModelState
  } catch {
    return null
  }
}

/**
 * 把任意来源 (v2 缺字段 / v3 带 followRef / v4 已就位) 的 video 子对象归一到当前 VideoState。
 * 被 migrateV2 与 migrateV3 共用 —— 两处曾各写一份, 字段一变就会分叉。
 *
 * followRef → resolution 的换算 (v3→v4):
 *   true  → 'ref'    (原「跟随起始画面比例」)
 *   false → 'custom' (原「手选方向/自定义」, 保留其 width/height 即为用户当时所见)
 */
function normalizeVideoState(raw: unknown, config: ModelTypeConfig | undefined): VideoState {
  const def: VideoState = config
    ? createDefaultVideoState(config)
    : { refImage: '', lastImage: '', refs: [], resolution: '1280x720', durationS: 5, width: 1280, height: 720 }

  const existing = raw as Record<string, unknown> | undefined
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return def

  let resolution: string
  if (typeof existing.resolution === 'string' && existing.resolution) {
    resolution = existing.resolution
  } else if (typeof existing.followRef === 'boolean') {
    resolution = existing.followRef ? 'ref' : 'custom'
  } else {
    resolution = def.resolution
  }

  const merged: VideoState = {
    refImage: typeof existing.refImage === 'string' ? existing.refImage : '',
    lastImage: typeof existing.lastImage === 'string' ? existing.lastImage : '',
    refs: Array.isArray(existing.refs)
      ? (existing.refs as unknown[]).filter((r): r is RefItem => {
          const it = r as Partial<RefItem> | null | undefined
          return !!it && typeof it === 'object'
            && typeof it.name === 'string'
            && (it.type === 'image' || it.type === 'video' || it.type === 'audio')
        })
      : [],
    resolution,
    durationS: Number(existing.durationS) > 0 ? Number(existing.durationS) : 5,
    width: Number(existing.width) > 0 ? Number(existing.width) : def.width,
    height: Number(existing.height) > 0 ? Number(existing.height) : def.height,
  }
  // mode 仅条目有 videoModes 才设; 否则丢弃脏数据。
  // 非法值兜底与 createDefaultVideoState 同口径 (优先 i2v), 不用 videoModes[0]。
  if (config?.videoModes && config.videoModes.length) {
    const m = existing.mode
    merged.mode = (m === 't2v' || m === 'i2v') ? m : def.mode
  }
  return merged
}

/**
 * Migrate v3 → v4: 视频态的 followRef(boolean) → resolution(string)。
 * v3 是 v5 改造前的形态 (「跟随比例」还是独立开关); v4 把它折进分辨率下拉的哨兵值。
 * 图像架构的 v3 数据无任何变化。
 */
export function migrateV3(state: Record<string, unknown>, key: string): ModelState | null {
  try {
    const s = state as Record<string, unknown>
    const config = MODEL_TYPES[key]
    if (config?.mediaType === 'video') {
      s.video = normalizeVideoState(s.video, config)
    } else if ('video' in s) {
      delete s.video
    }
    return s as unknown as ModelState
  } catch {
    return null
  }
}

/**
 * Migrate v4 → v5: 为 MiniMax H3 补全新字段 (不丢弃既有数据)。
 * v4 ModelState 缺 audioVae; 视频态缺 lastImage (首尾帧的末帧)。
 * 图像架构与 wan 三条目的既有数据无任何变化 (仅补空串)。
 */
export function migrateV4(state: Record<string, unknown>, key: string): ModelState | null {
  try {
    const s = state as Record<string, unknown>
    if (typeof s.audioVae !== 'string') s.audioVae = ''
    const config = MODEL_TYPES[key]
    if (config?.mediaType === 'video') {
      s.video = normalizeVideoState(s.video, config)
    }
    return s as unknown as ModelState
  } catch {
    return null
  }
}

export function migrateV2(state: Record<string, unknown>, key: string): ModelState | null {
  try {
    const s = state as Record<string, unknown>
    const config = MODEL_TYPES[key]
    const isVideo = config?.mediaType === 'video'

    // unetHigh / unetLow: 缺则补空串 (用户既有 unet 由后续 deep-merge 决定是否搬到 high/low)
    if (typeof s.unetHigh !== 'string') s.unetHigh = ''
    if (typeof s.unetLow !== 'string') s.unetLow = ''

    // fast 速度开关: 缺则 true (默认快速); 非布尔兜底 true
    if (typeof s.fast !== 'boolean') s.fast = true

    // loras[].apply: 缺则 'both' (默认双段); 非法值兜底 'both'
    if (Array.isArray(s.loras)) {
      s.loras = (s.loras as LoraEntry[]).map(l => {
        if (l && typeof l === 'object') {
          const apply = (l as LoraEntry).apply
          if (apply !== 'high' && apply !== 'low' && apply !== 'both') {
            return { ...l, apply: 'both' as const }
          }
          return l
        }
        return l
      })
    }

    // video 子对象: 仅视频架构设; 图像架构清掉 (避免脏数据)
    if (isVideo) {
      s.video = normalizeVideoState(s.video, config)
    } else if ('video' in s) {
      // 图像架构不应有 video 态, 删除脏字段 (deep-merge 会再补 undefined)
      delete s.video
    }

    return s as unknown as ModelState
  } catch {
    return null
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useGenerateStore = defineStore('generate', () => {
  // activeModelTypeByTask 是真实存储; activeModelType 是当前任务的派生值
  // (现有读取方 store.activeModelType 语义不变, 见 GeneratePage.vue:99-100)。
  const activeModelTypeByTask = reactive<{ image: string; video: string }>({
    image: 'sd15',
    video: 'wan22_i2v',
  })
  const activeTask = ref<'image' | 'video'>('image')
  const activeModelType = computed<string>({
    get: () => activeModelTypeByTask[activeTask.value],
    set: (v) => {
      if (MODEL_TYPES[v]) activeModelTypeByTask[activeTask.value] = v
    },
  })

  const modelStates = reactive<Record<string, ModelState>>({})

  /**
   * 各架构下「引用了但本机不存在」的模型名 (架构 → 名字集合)。装载时由 restore
   * 的校验链记录 —— 引用**保留**, 只在此标记, 由 UI 标明缺失。
   * 刻意不删除引用: 文件临时不在时用户的配置不该被销毁 (见 restore 内注释)。
   * 删除是用户的显式选择 (见 pruneMissing)。
   */
  const missingModels = reactive<Record<string, Set<string>>>({})

  /** 缺失引用的完整清单 (供缺失 modal 展示): 架构 + 字段 + 名字 */
  const missingRefs = ref<{ arch: string; field: string; name: string }[]>([])
  const restoredFiles = ref<Array<WorkspaceFile & { arch: string }>>([])

  function markMissing(arch: string, field: string, name: string) {
    if (!name) return
    ;(missingModels[arch] ??= new Set()).add(name)
    missingRefs.value.push({ arch, field, name })
  }

  /** 该项目是否缺失 (供面板标警示) */
  function isMissing(arch: string, name: string): boolean {
    return missingModels[arch]?.has(name) ?? false
  }

  /** 用户已换选/删除该项目 → 移除标记 */
  function clearMissing(arch: string, name: string) {
    missingModels[arch]?.delete(name)
    missingRefs.value = missingRefs.value.filter(r => !(r.arch === arch && r.name === name))
  }

  function resetMissing() {
    for (const key of Object.keys(missingModels)) delete missingModels[key]
    missingRefs.value = []
  }

  /**
   * 下载完成后按**本机最新清单**复核缺失标记, 清掉已补齐的项。
   *
   * missingRefs 是 restore 时的快照; 文件由下载补回后它不会自愈 —— 卡片/
   * 弹窗会永远停在缺失态。validators 与 restore 装载同一套判据 (磁盘真相)。
   */
  function reconcileMissing(validators: {
    loraExists?: (name: string) => boolean
    checkpointExists?: (name: string) => boolean
    unetExists?: (name: string) => boolean
    clipExists?: (name: string) => boolean
    vaeExists?: (name: string) => boolean
    controlNetExists?: (type: string, name: string) => boolean
    seedvr2Exists?: (name: string) => boolean
    faceDetectionExists?: (name: string) => boolean
  }) {
    for (const { arch, field, name } of [...missingRefs.value]) {
      const exists = field === 'loras' ? validators.loraExists?.(name)
        : field === 'checkpoint' ? validators.checkpointExists?.(name)
        : field === 'unet' || field === 'unetHigh' || field === 'unetLow' ? validators.unetExists?.(name)
        : field === 'clip' || field === 'clip2' ? validators.clipExists?.(name)
        : field === 'vae' || field === 'vaeOverride' || field === 'audioVae' ? validators.vaeExists?.(name)
        : field.startsWith('controlNets.') ? validators.controlNetExists?.(field.slice('controlNets.'.length, -'.model'.length), name)
        : field === 'upscale.svrModel' ? validators.seedvr2Exists?.(name)
        : field === 'faceDetailer.detectionModel' ? validators.faceDetectionExists?.(name)
        : undefined
      if (exists) clearMissing(arch, name)
    }
  }

  /**
   * 把缺失引用从状态里剔除, 回到「未选择」语义 (缺失 modal 的「忽略并回退」动作)。
   *
   * 这是**用户显式发起**的清理 —— 与 restore 装载时静默删除的区别就在于此:
   * 系统不替用户销毁配置, 但用户可以选择清理掉跑不了的项。
   */
  function pruneMissing(paths?: Set<string>) {
    for (const { arch, field, name } of missingRefs.value) {
      if (paths && !restoredFiles.value.some(file => file.arch === arch && file.field === field
        && file.path.endsWith('/' + name) && paths.has(file.path))) continue
      const state = modelStates[arch]
      if (!state) continue
      if (field === 'loras') {
        state.loras = state.loras.filter(l => l.name !== name)
      } else if (field.startsWith('controlNets.') && field.endsWith('.model')) {
        // 回退 = 清引用: 模块 enabled 状态不动 (与 LoRA 保留条目只标缺失不同,
        // CN 的模型是必填, 清掉后用户重新选择即可)。
        const cnType = field.slice('controlNets.'.length, -'.model'.length)
        const cn = state.controlNets?.[cnType]
        if (cn && cn.model === name) cn.model = ''
      } else if (field === 'upscale.svrModel') {
        if (state.upscale?.svrModel === name) state.upscale.svrModel = ''
      } else if (field === 'faceDetailer.detectionModel') {
        if (state.faceDetailer?.detectionModel === name) state.faceDetailer.detectionModel = ''
      } else if ((state as unknown as Record<string, unknown>)[field] === name) {
        ;(state as unknown as Record<string, unknown>)[field] = ''
      }
    }
    for (const file of restoredFiles.value) {
      if (!paths?.has(file.path)) continue
      const state = modelStates[file.arch]
      if (!state) continue
      if (file.field.startsWith('fast.')) state.fast = false
      else if (file.field === 'faceDetailer.sam') state.faceDetailer.useSam = false
      else if (file.field.startsWith('upscale.') && file.field !== 'upscale.svrModel') state.upscale.enabled = false
      else if (file.field.includes('.dependency.')) {
        const type = file.field.split('.')[1]!
        if (state.controlNets[type]) state.controlNets[type].enabled = false
      }
    }
    resetMissing()
    restoredFiles.value = []
  }

  /** 各架构的运行组件是否就绪; undefined = 尚未检查 */
  const componentsReady = reactive<Record<string, boolean | undefined>>({})
  function setComponentsReady(type: string, ready: boolean) {
    componentsReady[type] = ready
  }

  const currentConfig = computed<ModelTypeConfig>(() => MODEL_TYPES[activeModelType.value] ?? MODEL_TYPES.sd15!)
  const currentState = computed<ModelState>(() => {
    const key = activeModelType.value
    if (!modelStates[key]) {
      modelStates[key] = createDefaultState(currentConfig.value)
    }
    return modelStates[key] as ModelState
  })

  /**
   * 取指定架构的 state (不存在则按该架构默认值建)。
   * 供"一架构一实例"的组合式使用 —— ModelTab 是全量 v-show 挂载的,
   * 非激活实例若写 currentState 会串到别的架构上 (CN 模型自动选中曾因此串写)。
   */
  function stateFor(type: string): ModelState {
    const cfg = MODEL_TYPES[type] ?? MODEL_TYPES.sd15!
    if (!modelStates[type]) {
      modelStates[type] = createDefaultState(cfg)
    }
    return modelStates[type] as ModelState
  }

  // ── 状态持久化 (服务端唯一真相源) ────────────────────────────────────────
  //
  // 本地不再保留副本: 页面有 gate 门禁, 后端不可达时本就无法编辑, 因此
  // 「离线编辑丢失」这一 localStorage 唯一的价值场景不存在。

  const STATE_ENDPOINT = '/api/generate/state'
  /** 最近一次保存失败原因; null = 无未保存错误 */
  const saveError = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let saveFailures = 0
  let autoSaveEnabled = false
  // 串行化写入: 并发 PUT 可能乱序到达, 后者覆盖前者就与「后写入覆盖」语义相悖
  let saving = false
  let pending = false
  // 各架构上次成功落盘的快照 (JSON 字符串) —— 用于增量提交, 只发变更的架构。
  // 服务端按架构合并, 因此「只发改动的架构」才能让多设备分别编辑不同架构时不互相覆盖。
  let savedStatesJson: Record<string, string> = {}

  function clearTimers() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  }

  function currentStatesJson(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(modelStates)) {
      const previous = savedStatesJson[key] ? JSON.parse(savedStatesJson[key]) as ModelState : undefined
      out[key] = JSON.stringify({ ...value, files: workspaceFiles(key, value, previous) })
    }
    return out
  }

  /**
   * 构造增量 envelope: 顶层字段照常带 (指针类字段后写入覆盖即可),
   * modelStates 只含相对上次落盘有变化的架构。同时返回本次基线快照,
   * 供成功后更新 savedStatesJson (必须在**请求前**取, 否则请求期间的新改动
   * 会被误标为已保存)。
   */
  function buildEnvelope() {
    const baseline = currentStatesJson()
    const changedStates: Record<string, unknown> = {}
    for (const [key, json] of Object.entries(baseline)) {
      if (savedStatesJson[key] !== json) changedStates[key] = JSON.parse(json)
    }
    return {
      baseline,
      top: {
        _version: SCHEMA_VERSION,
        activeTask: activeTask.value,
        activeModelTypeByTask: { ...activeModelTypeByTask },
        // [向后兼容] 旧读取方读 activeModelType (现在已不存在为字段, 这里写当前任务派生值)
        activeModelType: activeModelTypeByTask[activeTask.value],
      },
      changedStates,
    }
  }

  function scheduleSave() {
    if (!autoSaveEnabled) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void save() }, SAVE_DEBOUNCE_MS)
  }

  function enableAutoSave() {
    autoSaveEnabled = true
    watch(
      () => JSON.stringify(modelStates),
      () => scheduleSave(),
    )
    watch(activeModelType, () => scheduleSave())
    watch(activeModelTypeByTask, () => scheduleSave(), { deep: true })
    watch(activeTask, () => scheduleSave())
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function switchModelType(type: string) {
    if (!MODEL_TYPES[type]) return
    activeModelTypeByTask[activeTask.value] = type
    if (!modelStates[type]) {
      modelStates[type] = createDefaultState(MODEL_TYPES[type])
    }
  }

  /** 切换任务 (image/video); 同时把当前架构指针切到该任务的记忆值 */
  function switchTask(task: 'image' | 'video') {
    activeTask.value = task
    const type = activeModelTypeByTask[task]
    if (MODEL_TYPES[type] && !modelStates[type]) {
      modelStates[type] = createDefaultState(MODEL_TYPES[type])
    }
  }

  /**
   * 落盘 (PUT 整份覆盖)。失败不静默: 保留失败标记并退避重试,
   * 期间新变更会重置防抖计时器, 最终仍以最新状态重发。
   */
  async function save(): Promise<void> {
    if (!autoSaveEnabled) return
    if (saving) { pending = true; return }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const { baseline, top, changedStates } = buildEnvelope()
    saving = true
    try {
      const res = await fetch(STATE_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...top, modelStates: changedStates }),
      })
      if (res.status === 401) { redirectToLogin(); return }
      // 409 = 服务端已置「需重新装载」守卫 (配置在别处被导入/修改)。停止重试:
      // 重试只会一直失败, 且此刻内存里的状态已过时, 必须重新装载。
      if (res.status === 409) {
        saveError.value = 'reload_required'
        clearTimers()
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      saveFailures = 0
      saveError.value = null
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      // 只把**本次提交基线**标记为已落盘: 请求期间发生的新改动不在 baseline 里,
      // 会被下一次 scheduleSave/save 正常再提交。
      savedStatesJson = baseline
    } catch (e) {
      saveFailures++
      saveError.value = e instanceof Error ? e.message : String(e)
      if (saveFailures <= SAVE_RETRY_MAX) {
        const delay = Math.min(1000 * 2 ** (saveFailures - 1), 10000)
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(() => { void save() }, delay)
      }
    } finally {
      saving = false
      // 保存期间又有变更 → 立即补一次, 保证最终落盘的是最新状态
      if (pending) { pending = false; void save() }
    }
  }

  /**
   * 从服务端装载工作区状态。Must be called AFTER options are loaded
   * so that checkpoint/lora/sampler/scheduler can be validated.
   *
   * 返回装载结果 —— 失败/版本过新时调用方**不得**开启自动保存, 否则会用
   * 默认值覆盖服务端既有配置。
   *
   * @param validators Optional validation callbacks to check if a value still exists
   */
  async function restore(validators?: {
    checkpointExists?: (name: string) => boolean
    loraExists?: (name: string) => boolean
    samplerExists?: (name: string) => boolean
    schedulerExists?: (name: string) => boolean
    unetExists?: (name: string) => boolean
    clipExists?: (name: string) => boolean
    vaeExists?: (name: string) => boolean
    controlNetExists?: (type: string, name: string) => boolean
    seedvr2Exists?: (name: string) => boolean
    faceDetectionExists?: (name: string) => boolean
  }): Promise<RestoreResult> {
    // 每次装载重新计算缺失清单 (旧标记已随上次选择失效)
    resetMissing()
    restoredFiles.value = []
    const GET_RETRIES = 3
    let data: Record<string, unknown> | null = null
    let ok = false
    for (let attempt = 0; attempt <= GET_RETRIES; attempt++) {
      try {
        const res = await fetch(STATE_ENDPOINT, {
          headers: { Accept: 'application/json' },
        })
        if (res.status === 401) { redirectToLogin(); return { outcome: 'failed' } }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json() as { state?: Record<string, unknown> | null }
        data = body?.state ?? null
        ok = true
        break
      } catch {
        // 网络抖动/后端瞬时不可用: 指数退避重试 (对齐 ComfyUI settingStore 的做法),
        // 用尽后返回 failed, 由调用方提示并保留手动重试入口。
        if (attempt < GET_RETRIES) {
          await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)))
        }
      }
    }
    if (!ok) return { outcome: 'failed' }

    // 无数据: 首次使用, 保留默认值; 允许后续变更落盘。
    if (!data) return { outcome: 'empty' }

    try {
      const version = (data._version as number) || 1
      // 服务端配置由更新版本保存 → 不套用、不覆盖, 交由调用方提示更新面板。
      if (version > SCHEMA_VERSION) return { outcome: 'incompatible' }

      // ── 任务级架构记忆迁移 ──
      // v2 只有单一 activeModelType; v3 拆 activeModelTypeByTask {image, video}。
      // 迁移: 旧 activeModelType (必为图像架构, v2 时视频条目尚不存在) → image 槽;
      //        video 槽默认 'wan22_i2v' (默认条目)。
      if (version < 3) {
        const oldActive = data.activeModelType
        const imageKey = (typeof oldActive === 'string' && MODEL_TYPES[oldActive]?.mediaType === 'image')
          ? oldActive : 'sdxl'
        activeModelTypeByTask.image = imageKey
        activeModelTypeByTask.video = 'wan22_i2v'
        activeTask.value = 'image'
      } else {
        const saved = data.activeModelTypeByTask as Record<string, unknown> | undefined
        if (saved && typeof saved === 'object') {
          const img = typeof saved.image === 'string' && MODEL_TYPES[saved.image] ? saved.image : 'sdxl'
          const vid = typeof saved.video === 'string' && MODEL_TYPES[saved.video] ? saved.video : 'wan22_i2v'
          activeModelTypeByTask.image = img
          activeModelTypeByTask.video = vid
        } else if (typeof data.activeModelType === 'string' && MODEL_TYPES[data.activeModelType]) {
          const cfg = MODEL_TYPES[data.activeModelType]!
          if (cfg.mediaType === 'video') {
            activeModelTypeByTask.video = data.activeModelType
          } else {
            activeModelTypeByTask.image = data.activeModelType
          }
        }
        const t = data.activeTask
        activeTask.value = (t === 'video') ? 'video' : 'image'
      }

      if (data.modelStates) {
        for (const [key, rawState] of Object.entries(data.modelStates)) {
          let state = rawState as ModelState

          if (version < 2) {
            const migrated = migrateV1(rawState as Record<string, unknown>)
            if (!migrated) continue
            state = migrated
          }

          // Migrate from v2 → v3 (补 unetHigh/unetLow/video/fast/loras[].apply)
          if (version < 3) {
            const migrated = migrateV2(rawState as Record<string, unknown>, key)
            if (!migrated) continue
            state = migrated
          }

          // Migrate from v3 → v4 (video.followRef → video.resolution)
          // v2 路径已由 migrateV2 内的 normalizeVideoState 直接产出 v4 形态, 此处只补 v3 数据。
          if (version === 3) {
            const migrated = migrateV3(rawState as Record<string, unknown>, key)
            if (!migrated) continue
            state = migrated
          }

          // Migrate from v4 → v5 (补 audioVae / video.lastImage 缺省)
          // v2/v3 路径已由各自 migrate 内的 normalizeVideoState 产出当前形态, 此处只补 v4 数据。
          if (version === 4) {
            const migrated = migrateV4(rawState as Record<string, unknown>, key)
            if (!migrated) continue
            state = migrated
          }

          restoredFiles.value.push(...(state.files ?? []).map(file => ({ ...file, arch: key })))

          if (validators) {
            // ── 缺失引用: 「记录」而非「删除」 ──
            // 模型文件只是临时不在 (同步未完成 / 用户移走) 时, 用户的配置**不该
            // 被自动销毁** —— 那会让导入的配置当场失效, 且清了就写回服务端,
            // 不可恢复。故保留引用并记入 missing，仅供展示和补齐文件。
            //
            // sampler/scheduler 是枚举值，ComfyUI 升级后可能消失，仍回落默认值。
            if (state.checkpoint && validators.checkpointExists && !validators.checkpointExists(state.checkpoint)) {
              markMissing(key, 'checkpoint', state.checkpoint)
            }
            if (state.unet && validators.unetExists && !validators.unetExists(state.unet)) {
              markMissing(key, 'unet', state.unet)
            }
            if (state.unetHigh && validators.unetExists && !validators.unetExists(state.unetHigh)) {
              markMissing(key, 'unetHigh', state.unetHigh)
            }
            if (state.unetLow && validators.unetExists && !validators.unetExists(state.unetLow)) {
              markMissing(key, 'unetLow', state.unetLow)
            }
            if (state.clip && validators.clipExists && !validators.clipExists(state.clip)) {
              markMissing(key, 'clip', state.clip)
            }
            if (state.clip2 && validators.clipExists && !validators.clipExists(state.clip2)) {
              markMissing(key, 'clip2', state.clip2)
            }
            if (state.vae && validators.vaeExists && !validators.vaeExists(state.vae)) {
              markMissing(key, 'vae', state.vae)
            }
            if (state.audioVae && validators.vaeExists && !validators.vaeExists(state.audioVae)) {
              markMissing(key, 'audioVae', state.audioVae)
            }
            if (typeof state.clipSkip !== 'number' || state.clipSkip < 1 || state.clipSkip > 4) {
              const config = MODEL_TYPES[key] ?? MODEL_TYPES.sdxl!
              state.clipSkip = config.defaults.clip_skip ?? 1
            }
            if (state.vaeOverride && validators.vaeExists && !validators.vaeExists(state.vaeOverride)) {
              markMissing(key, 'vaeOverride', state.vaeOverride)
            }
            // 仅 enabled 的 LoRA 计入缺失: buildPayload 只发 enabled 项, 关闭的
            // 不阻塞运行, 标出来只会让用户以为配置坏了。
            if (validators.loraExists) {
              for (const l of state.loras) {
                if (l.enabled && !validators.loraExists(l.name)) markMissing(key, 'loras', l.name)
              }
            }
            // ControlNet / SeedVR2 / 面部检测: 只在对应模块 enabled 时校验 ——
            // 关闭态引用的模型不影响运行, 与 LoRA 同口径。
            if (state.controlNets && validators.controlNetExists) {
              for (const cnType of ['pose', 'canny', 'depth']) {
                const cn = state.controlNets[cnType]
                if (cn?.enabled && cn.model && !validators.controlNetExists(cnType, cn.model)) {
                  markMissing(key, `controlNets.${cnType}.model`, cn.model)
                }
              }
            }
            if (state.upscale?.enabled && state.upscale.engine === 'seedvr2'
              && state.upscale.svrModel && validators.seedvr2Exists
              && !validators.seedvr2Exists(state.upscale.svrModel)) {
              markMissing(key, 'upscale.svrModel', state.upscale.svrModel)
            }
            if (state.faceDetailer?.enabled && state.faceDetailer.detectionModel
              && validators.faceDetectionExists
              && !validators.faceDetectionExists(state.faceDetailer.detectionModel)) {
              markMissing(key, 'faceDetailer.detectionModel', state.faceDetailer.detectionModel)
            }
            if (state.sampler && validators.samplerExists && !validators.samplerExists(state.sampler)) {
              const config = MODEL_TYPES[key] ?? MODEL_TYPES.sdxl!
              state.sampler = config.defaults.sampler
            }
            if (state.scheduler && validators.schedulerExists && !validators.schedulerExists(state.scheduler)) {
              const config = MODEL_TYPES[key] ?? MODEL_TYPES.sdxl!
              state.scheduler = config.defaults.scheduler
            }
          }

          // Refresh stale -1 seeds from old data
          if (state.seedMode === 'random' && state.seedValue < 0) {
            state.seedValue = randomSeed()
          }
          if (state.hires?.seedMode === 'random' && state.hires.seedValue < 0) {
            state.hires.seedValue = randomSeed()
          }

          // Background run maxIterations: 兜底 (旧数据无此字段 → 默认 0 = 无限)
          if (typeof state.maxIterations !== 'number' || isNaN(state.maxIterations)) {
            state.maxIterations = 0
          }
          // runMode 合法性兜底: 旧值 'onChange' 已被 migrateV1 改为 'normal';
          // 防御非预期值流进 UI
          if (state.runMode !== 'normal' && state.runMode !== 'live' && state.runMode !== 'background') {
            state.runMode = 'normal'
          }

          // Merge with defaults to fill any missing fields (deep for nested objects)
          const config = MODEL_TYPES[key]
          if (config) {
            const defaults = createDefaultState(config)
            const merged: ModelState = { ...defaults, ...state }
            for (const k of Object.keys(defaults) as (keyof ModelState)[]) {
              const dv = defaults[k]
              if (dv && typeof dv === 'object' && !Array.isArray(dv) && state[k] && typeof state[k] === 'object' && !Array.isArray(state[k])) {
                ;(merged[k] as object) = { ...dv, ...(state[k] as object) }
              }
            }
            if (config.mediaType !== 'video') {
              merged.video = undefined
            } else {
              if (!merged.video) {
                merged.video = createDefaultVideoState(config)
              }
            }
            modelStates[key] = merged
          } else {
            modelStates[key] = state
          }
        }
      }
      // 新增的文件引用清单也需要随首次保存落库。
      savedStatesJson = Object.fromEntries(
        Object.entries((data.modelStates as Record<string, unknown>) ?? {})
          .map(([key, state]) => [key, JSON.stringify(state)]),
      )
      return { outcome: 'applied' }
    } catch {
      // 服务端已守结构不变量, 走到这里基本不可达; 按「空」处理以免页面卡死在装载失败态。
      return { outcome: 'empty' }
    }
  }

  return {
    activeModelType, activeModelTypeByTask, activeTask,
    modelStates,
    missingModels, missingRefs, isMissing, clearMissing, pruneMissing, reconcileMissing,
    restoredFiles,
    componentsReady, setComponentsReady,
    currentConfig, currentState, stateFor,
    switchModelType, switchTask, save, restore, enableAutoSave,
    saveError,
  }
})
