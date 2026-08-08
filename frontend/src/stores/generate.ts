import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import type { ModelTypeConfig } from '@/config/model-types'
import { MODEL_TYPES } from '@/config/model-types'

// ── Types ────────────────────────────────────────────────────────────────────

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
  translate?: string  // cached translation
}

export interface ModelState {
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

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'comfycarry_generate_params'
const SCHEMA_VERSION = 5
const SAVE_DEBOUNCE_MS = 300

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

// ── Factory ──────────────────────────────────────────────────────────────────

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
    resolution: config.resolutions[0]?.value || '1024x1024',
    width: 1024,
    height: 1024,
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
    // Clip Skip / VAE 覆盖 (checkpoint 系专属); 默认取 config.defaults.clip_skip ?? 1
    clipSkip: config.defaults.clip_skip ?? 1,
    vaeOverride: '',
    // 后台运行模式: 轮次上限, 0 = 无限
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
    hires: { enabled: false, denoise: 0.4, steps: 20, cfg: 7, sampler: 'euler', scheduler: 'normal', seedMode: 'random', seedValue: randomSeed() },
    i2i: { enabled: false, image: null, denoise: 0.7, mode: 'i2i', mask: null, growMaskBy: 6 },
    faceDetailer: {
      enabled: false, detectionModel: 'face_yolov8m.pt', denoise: 0.35, steps: 20,
      prompt: '', cfg: 7, guideSize: 768, cropFactor: 1.8, bboxThreshold: 0.5,
      feather: 5, useSam: false,
    },
    activeModule: config.modules[0] || 'lora',
    // 视频: 仅 mediaType:'video' 架构设 video 态; 图像架构恒 undefined
    video: config.mediaType === 'video' ? createDefaultVideoState(config) : undefined,
    // 速度开关默认快速; 5B 无 speedToggle 但保留 true 不影响
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
    // Convert loras from Record<string, number> to LoraEntry[]
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

    // Add runMode if missing
    if (!s.runMode || s.runMode === 'onChange') {
      s.runMode = 'normal'
    }

    // Fix prefix if empty
    if (!s.prefix) {
      s.prefix = '[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]'
    }

    // Clamp i2i denoise
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
 * Migrate v2 → v3: 为视频架构补全新字段 (不丢弃既有数据)。
 * v2 ModelState 缺: unetHigh/unetLow/video{}/fast; loras[] 元素缺 apply。
 * 容错策略 (同 migrateV1 风格): 缺则补默认, 非法则兜底; video 子对象整体兜底。
 * 架构判别由调用方 (restore) 按 key 取 config, 此处只管字段补全与类型校正。
 */
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
  // ── 任务级架构记忆 (两个任务各自记忆选中架构) ──
  // activeModelTypeByTask 是真实存储; activeModelType 是当前任务的派生值
  // (现有读取方 store.activeModelType 语义不变, 见 GeneratePage.vue:99-100)。
  const activeModelTypeByTask = reactive<{ image: string; video: string }>({
    image: 'sdxl',
    video: 'wan22_i2v',
  })
  // 当前任务 (image/video); restore 时由迁移逻辑设定, 默认 'image'
  const activeTask = ref<'image' | 'video'>('image')
  // 当前任务选中架构的派生 getter/setter (保留旧 API, 不破坏现有读取方)
  const activeModelType = computed<string>({
    get: () => activeModelTypeByTask[activeTask.value],
    set: (v) => {
      if (MODEL_TYPES[v]) activeModelTypeByTask[activeTask.value] = v
    },
  })

  const modelStates = reactive<Record<string, ModelState>>({})

  // ── 各架构运行组件就绪状态 (不持久化, 不进 restore/persist 白名单) ──
  // ModelTab 在 dep check 完成处调用 setComponentsReady(type, ready)。
  // 菜单项 hint: componentsReady[key]===false → '未就绪'; true / undefined 不显示。
  /** 各架构的运行组件是否就绪; undefined = 尚未检查 */
  const componentsReady = reactive<Record<string, boolean | undefined>>({})
  function setComponentsReady(type: string, ready: boolean) {
    componentsReady[type] = ready
  }

  const currentConfig = computed<ModelTypeConfig>(() => MODEL_TYPES[activeModelType.value] || MODEL_TYPES.sdxl)
  const currentState = computed<ModelState>(() => {
    if (!modelStates[activeModelType.value]) {
      modelStates[activeModelType.value] = createDefaultState(currentConfig.value)
    }
    return modelStates[activeModelType.value]
  })

  /**
   * 取指定架构的 state (不存在则按该架构默认值建)。
   * 供"一架构一实例"的组合式使用 —— ModelTab 是全量 v-show 挂载的,
   * 非激活实例若写 currentState 会串到别的架构上 (CN 模型自动选中曾因此串写)。
   */
  function stateFor(type: string): ModelState {
    const cfg = MODEL_TYPES[type] || MODEL_TYPES.sdxl
    if (!modelStates[type]) {
      modelStates[type] = createDefaultState(cfg)
    }
    return modelStates[type]
  }

  // ── Auto-save with debounce ──────────────────────────────────────────────

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let autoSaveEnabled = false

  function scheduleSave() {
    if (!autoSaveEnabled) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  function enableAutoSave() {
    autoSaveEnabled = true
    // Watch modelStates deeply for any change
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

  function save() {
    try {
      const data = {
        _version: SCHEMA_VERSION,
        activeTask: activeTask.value,
        activeModelTypeByTask: { ...activeModelTypeByTask },
        // [向后兼容] 旧读取方读 activeModelType (现在已不存在为字段, 这里写当前任务派生值)
        activeModelType: activeModelTypeByTask[activeTask.value],
        modelStates: JSON.parse(JSON.stringify(modelStates)),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* ignore quota errors */ }
  }

  /**
   * Restore from localStorage. Must be called AFTER options are loaded
   * so that checkpoint/lora/sampler/scheduler can be validated.
   *
   * @param validators Optional validation callbacks to check if a value still exists
   */
  function restore(validators?: {
    checkpointExists?: (name: string) => boolean
    loraExists?: (name: string) => boolean
    samplerExists?: (name: string) => boolean
    schedulerExists?: (name: string) => boolean
    unetExists?: (name: string) => boolean
    clipExists?: (name: string) => boolean
    vaeExists?: (name: string) => boolean
  }) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const data = JSON.parse(raw)

      // Schema version check — migrate or discard
      const version = data._version || 1
      if (version > SCHEMA_VERSION) {
        // Future version, discard
        localStorage.removeItem(STORAGE_KEY)
        return
      }

      // ── 任务级架构记忆迁移 ──
      // v2 只有单一 activeModelType; v3 拆 activeModelTypeByTask {image, video}。
      // 迁移: 旧 activeModelType (必为图像架构, v2 时视频条目尚不存在) → image 槽;
      //        video 槽默认 'wan22_i2v' (默认条目)。
      if (version < 3) {
        const oldActive = data.activeModelType
        const imageKey = (typeof oldActive === 'string' && MODEL_TYPES[oldActive] && MODEL_TYPES[oldActive].mediaType === 'image')
          ? oldActive : 'sdxl'
        activeModelTypeByTask.image = imageKey
        activeModelTypeByTask.video = 'wan22_i2v'
        activeTask.value = 'image'
      } else {
        // v3 数据: 优先读 activeModelTypeByTask; 兜底读旧 activeModelType
        const saved = data.activeModelTypeByTask
        if (saved && typeof saved === 'object') {
          const img = typeof saved.image === 'string' && MODEL_TYPES[saved.image] ? saved.image : 'sdxl'
          const vid = typeof saved.video === 'string' && MODEL_TYPES[saved.video] ? saved.video : 'wan22_i2v'
          activeModelTypeByTask.image = img
          activeModelTypeByTask.video = vid
        } else if (typeof data.activeModelType === 'string' && MODEL_TYPES[data.activeModelType]) {
          // 兜底: v3 但只存了旧字段 (不应发生, 防御)
          const cfg = MODEL_TYPES[data.activeModelType]
          if (cfg.mediaType === 'video') {
            activeModelTypeByTask.video = data.activeModelType
          } else {
            activeModelTypeByTask.image = data.activeModelType
          }
        }
        // activeTask
        const t = data.activeTask
        activeTask.value = (t === 'video') ? 'video' : 'image'
      }

      if (data.modelStates) {
        for (const [key, rawState] of Object.entries(data.modelStates)) {
          let state = rawState as ModelState

          // Migrate from v1 → v2
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

          // Validate against current options
          if (validators) {
            if (state.checkpoint && validators.checkpointExists && !validators.checkpointExists(state.checkpoint)) {
              state.checkpoint = ''
            }
            if (state.unet && validators.unetExists && !validators.unetExists(state.unet)) {
              state.unet = ''
            }
            if (state.unetHigh && validators.unetExists && !validators.unetExists(state.unetHigh)) {
              state.unetHigh = ''
            }
            if (state.unetLow && validators.unetExists && !validators.unetExists(state.unetLow)) {
              state.unetLow = ''
            }
            if (state.clip && validators.clipExists && !validators.clipExists(state.clip)) {
              state.clip = ''
            }
            if (state.clip2 && validators.clipExists && !validators.clipExists(state.clip2)) {
              state.clip2 = ''
            }
            if (state.vae && validators.vaeExists && !validators.vaeExists(state.vae)) {
              state.vae = ''
            }
            // clipSkip 校验 (1..4) + vaeOverride 校验 (校验通过 vaeExists)
            if (typeof state.clipSkip !== 'number' || state.clipSkip < 1 || state.clipSkip > 4) {
              const config = MODEL_TYPES[key] || MODEL_TYPES.sdxl
              state.clipSkip = config.defaults.clip_skip ?? 1
            }
            if (state.vaeOverride && validators.vaeExists && !validators.vaeExists(state.vaeOverride)) {
              state.vaeOverride = ''
            }
            if (validators.loraExists) {
              state.loras = state.loras.filter(l => validators.loraExists!(l.name))
            }
            if (state.sampler && validators.samplerExists && !validators.samplerExists(state.sampler)) {
              const config = MODEL_TYPES[key] || MODEL_TYPES.sdxl
              state.sampler = config.defaults.sampler
            }
            if (state.scheduler && validators.schedulerExists && !validators.schedulerExists(state.scheduler)) {
              const config = MODEL_TYPES[key] || MODEL_TYPES.sdxl
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
            const merged = { ...defaults, ...state }
            // Deep-merge nested objects so new fields are not lost
            for (const k of Object.keys(defaults) as (keyof ModelState)[]) {
              const dv = defaults[k]
              if (dv && typeof dv === 'object' && !Array.isArray(dv) && state[k] && typeof state[k] === 'object' && !Array.isArray(state[k])) {
                ;(merged as any)[k] = { ...dv, ...(state[k] as any) }
              }
            }
            // video 子对象对图像架构应为 undefined; 迁移/合并后强制对齐 config
            if (config.mediaType !== 'video') {
              ;(merged as any).video = undefined
            } else {
              // 视频架构: 若仍缺 video 态 (极端脏数据), 用默认补
              if (!(merged as any).video) {
                ;(merged as any).video = createDefaultVideoState(config)
              }
            }
            modelStates[key] = merged
          } else {
            modelStates[key] = state
          }
        }
      }
    } catch { /* ignore corrupt data */ }
  }

  return {
    activeModelType, activeModelTypeByTask, activeTask,
    modelStates,
    componentsReady, setComponentsReady,
    currentConfig, currentState, stateFor,
    switchModelType, switchTask, save, restore, enableAutoSave,
  }
})
