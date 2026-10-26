import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import type { ModelTypeConfig } from '@/config/model-types'
import { MODEL_TYPES, modelConfig, modelsForMode } from '@/config/model-types'
import { redirectToLogin } from '@/composables/useApiFetch'
import { workspaceFiles, type WorkspaceFile } from '@/composables/generate/workspaceFiles'
import { useDownloadsStore } from '@/stores/downloads'

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
  mode?: 't2v' | 'i2v' | 'ref'
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
  sampler: string
  scheduler: string
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
  mode: string
  refs: RefItem[]
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

const SCHEMA_VERSION = 6
const SAVE_DEBOUNCE_MS = 300
const SAVE_RETRY_MAX = 5
const DEFAULT_MODEL_SELECTIONS = {
  krea2: 'krea2_turbo', flux2klein4b: 'flux2klein4b_distilled', flux2klein9b: 'flux2klein9b_distilled',
}

/** 状态装载结果。failed 时**不得**开启自动保存, 否则会用默认值覆盖服务端。 */
export type RestoreOutcome = 'applied' | 'empty' | 'failed'

export interface RestoreResult {
  outcome: RestoreOutcome
}

/** 视频架构的默认视频态: 从 config.videoDefaults 推导。
 *  durationS 默认 5; width/height 取默认档 landscape (优先 720p, 缺失时回退到第一个档位, 如 H3 的 768p);
 *  refImage 空。resolution 默认指向那一档预设本身 (自洽: 下拉选中项与 width/height 一致);
 *  用户选择起始画面后切到 'ref' (贴合项)。 */
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
      ? { mode: (config.defaultMode ?? (config.videoModes.includes('i2v') ? 'i2v' : config.videoModes[0])) as VideoState['mode'] }
      : {}),
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

export function createDefaultState(config: ModelTypeConfig): ModelState {
  const sampling = modelConfig(config.key, config.fastDefault ?? false).defaults
  const cnTypes = ['pose', 'canny', 'depth', 'lineart', 'tile']
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
    mode: config.defaultMode ?? config.modes?.[0] ?? 't2i',
    refs: [],
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
    steps: sampling.steps,
    cfg: sampling.cfg,
    sampler: sampling.sampler,
    scheduler: sampling.scheduler,
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
    hires: {
      enabled: false, scale: 1.5, upscaleMethod: 'bislerp', denoise: 0.4,
      steps: config.defaults.steps, cfg: config.defaults.cfg,
      sampler: config.defaults.sampler, scheduler: config.defaults.scheduler,
      seedMode: 'random', seedValue: randomSeed(),
    },
    i2i: { enabled: false, image: null, denoise: 0.7, mode: 'i2i', mask: null, growMaskBy: 6 },
    faceDetailer: {
      enabled: false, detectionModel: 'face_yolov8m.pt', denoise: 0.35,
      steps: config.defaults.steps, prompt: '', cfg: config.defaults.cfg,
      sampler: config.defaults.sampler, scheduler: config.defaults.scheduler,
      guideSize: 768, cropFactor: 1.8, bboxThreshold: 0.5,
      feather: 5, useSam: false,
    },
    activeModule: config.modules[0] || 'lora',
    video: config.mediaType === 'video' ? createDefaultVideoState(config) : undefined,
    fast: config.fastDefault ?? false,
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
  const modelSelections = reactive<Record<string, string>>({ ...DEFAULT_MODEL_SELECTIONS })

  const downloads = useDownloadsStore()
  const restoredFiles = computed<Array<WorkspaceFile & { arch: string }>>(() =>
    Object.entries(modelStates).flatMap(([arch, state]) =>
      workspaceFiles(arch, state, savedStates.value[arch] ?? state).map(file => ({ ...file, arch }))),
  )
  // 配置可能引用自定义目录和辅助文件，不能仅凭 ComfyUI 的模型下拉判断存在性。
  const missingPaths = computed(() => new Set(restoredFiles.value
    .filter(file => downloads.fileChecks.has(file.path) && downloads.getFileDownloadInfo(file.path).state !== 'installed')
    .map(file => file.path)))
  const missingRefs = computed(() => restoredFiles.value.filter(file => missingPaths.value.has(file.path)).map(file => {
    const state = modelStates[file.arch]!
    const value = file.field === 'loras'
      ? state.loras.find(lora => file.path.endsWith('/' + lora.name))?.name
      : file.field.split('.').reduce<unknown>((value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, state)
    return { ...file, name: typeof value === 'string' ? value : file.path.split('/').pop()! }
  }))

  function isMissing(arch: string, name: string): boolean {
    return missingRefs.value.some(file => file.arch === arch && file.name === name)
  }

  async function checkMissingFiles() {
    await downloads.checkFiles([...new Set(restoredFiles.value.map(file => file.path))])
  }

  /**
   * 把缺失引用从状态里剔除, 回到「未选择」语义 (缺失 modal 的「忽略并回退」动作)。
   *
   * 这是**用户显式发起**的清理 —— 与 restore 装载时静默删除的区别就在于此:
   * 系统不替用户销毁配置, 但用户可以选择清理掉跑不了的项。
   */
  function pruneMissing(paths?: Set<string>) {
    const files = restoredFiles.value
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
    for (const file of files) {
      if (!paths?.has(file.path)) continue
      const state = modelStates[file.arch]
      if (!state) continue
      if (file.field.startsWith('fast.')) state.fast = false
      else if (file.field.startsWith('reference.')) state.mode = 't2i'
      else if (file.field === 'faceDetailer.sam') state.faceDetailer.useSam = false
      else if (file.field.startsWith('upscale.') && file.field !== 'upscale.svrModel') state.upscale.enabled = false
      else if (file.field.includes('.dependency.')) {
        const type = file.field.split('.')[1]!
        if (state.controlNets[type]) state.controlNets[type].enabled = false
      }
    }
  }

  /** 各架构的运行组件是否就绪; undefined = 尚未检查 */
  const componentsReady = reactive<Record<string, boolean | undefined>>({})
  function setComponentsReady(type: string, ready: boolean) {
    componentsReady[type] = ready
  }

  const currentConfig = computed<ModelTypeConfig>(() => configFor(activeModelType.value))
  const currentState = computed<ModelState>(() => {
    const key = activeModelType.value
    if (!modelStates[key]) {
      modelStates[key] = createDefaultState(MODEL_TYPES[key]!)
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

  function configFor(type: string): ModelTypeConfig {
    const state = stateFor(type)
    return modelConfig(type, state.fast, state.video?.mode ?? state.mode)
  }

  function setFast(fast: boolean) {
    if (currentState.value.fast === fast || currentConfig.value.fastLocked) return
    const config = currentConfig.value
    if (config.fastModel) {
      const mode = currentState.value.video?.mode ?? currentState.value.mode
      const target = modelsForMode(config.key, mode).find(key => !!MODEL_TYPES[key]!.fastDefault === fast)!
      switchModelType(target, mode)
    } else {
      currentState.value.fast = fast
      Object.assign(currentState.value, currentConfig.value.defaults)
    }
  }

  function setMode(mode: string) {
    const previousMode = currentState.value.video?.mode ?? currentState.value.mode
    if (previousMode === mode) return
    const config = currentConfig.value
    const group = config.menuKey ?? config.key
    modelSelections[`${group}.${previousMode}`] = config.key
    const choices = modelsForMode(config.key, mode)
    const target = modelSelections[`${group}.${mode}`]
      ?? (choices.includes(config.key) ? config.key : choices[0]!)
    switchModelType(target, mode)
  }

  function setScheduler(scheduler: string, type = activeModelType.value) {
    const state = stateFor(type)
    state.scheduler = scheduler
    if (['qwen_image21_turbo', 'flux2_turbo'].includes(scheduler)) state.steps = 8
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
  const savedStates = ref<Record<string, ModelState>>({})
  const dirty = new Set<string>()

  function clearTimers() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  }

  function buildEnvelope() {
    const changedStates: Record<string, ModelState> = {}
    for (const key of dirty) {
      const value = modelStates[key]!
      changedStates[key] = { ...value, files: workspaceFiles(key, value, savedStates.value[key]) }
    }
    return JSON.stringify({
      _version: SCHEMA_VERSION,
      activeTask: activeTask.value,
      activeModelTypeByTask,
      modelSelections,
      modelStates: changedStates,
    })
  }

  function scheduleSave() {
    if (!autoSaveEnabled) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void save() }, SAVE_DEBOUNCE_MS)
  }

  function enableAutoSave() {
    autoSaveEnabled = true
  }

  const watched = new Set<string>()
  watch(() => Object.keys(modelStates), keys => {
    for (const key of keys) {
      if (watched.has(key)) continue
      watched.add(key)
      const changed = () => {
        if (!autoSaveEnabled) return
        dirty.add(key)
        scheduleSave()
      }
      watch(() => modelStates[key], changed, { deep: true, flush: 'sync' })
    }
  }, { flush: 'sync' })
  watch(activeModelTypeByTask, scheduleSave, { deep: true, flush: 'sync' })
  watch(activeTask, scheduleSave, { flush: 'sync' })
  watch(modelSelections, scheduleSave, { deep: true, flush: 'sync' })
  watch(() => restoredFiles.value.map(file => file.path).join('\n'), () => {
    if (autoSaveEnabled) void checkMissingFiles().catch(() => {})
  })

  // ── Actions ──────────────────────────────────────────────────────────────

  function switchModelType(type: string, mode?: string) {
    if (!MODEL_TYPES[type]) return
    const state = stateFor(type)
    if (mode !== undefined) {
      if (state.video) state.video.mode = mode as VideoState['mode']
      else state.mode = mode
    }
    activeModelTypeByTask[activeTask.value] = type
    const group = MODEL_TYPES[type].menuKey ?? type
    modelSelections[group] = type
    modelSelections[`${group}.${state.video?.mode ?? state.mode}`] = type
  }

  function selectModelGroup(key: string) {
    switchModelType(modelSelections[key] ?? key)
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
   * 按架构增量保存。失败不静默: 保留失败标记并退避重试,
   * 期间新变更会重置防抖计时器, 最终仍以最新状态重发。
   */
  async function save(): Promise<void> {
    if (!autoSaveEnabled) return
    if (saving) { pending = true; return }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const body = buildEnvelope()
    const sent = new Set(dirty)
    dirty.clear()
    saving = true
    try {
      const res = await fetch(STATE_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (res.status === 401) { redirectToLogin(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      saveFailures = 0
      saveError.value = null
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      Object.assign(savedStates.value, JSON.parse(body).modelStates)
    } catch (e) {
      for (const key of sent) dirty.add(key)
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
   * 装载失败时调用方不得开启自动保存，否则会用
   * 默认值覆盖服务端既有配置。
   *
   * @param validators Optional validation callbacks to check if a value still exists
   */
  async function restore(validators?: {
    samplerExists?: (name: string) => boolean
    schedulerExists?: (name: string) => boolean
  }): Promise<RestoreResult> {
    autoSaveEnabled = false
    clearTimers()
    dirty.clear()
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
        const body = await res.json() as { state: Record<string, unknown> | null }
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

    for (const key of Object.keys(modelStates)) delete modelStates[key]
    for (const key of Object.keys(modelSelections)) delete modelSelections[key]
    Object.assign(modelSelections, DEFAULT_MODEL_SELECTIONS)
    savedStates.value = {}
    saveError.value = null

    // 无数据: 首次使用, 保留默认值; 允许后续变更落盘。
    if (!data) return { outcome: 'empty' }

    try {
      const saved = data.activeModelTypeByTask as Record<string, string> | undefined
      for (const task of ['image', 'video'] as const) {
        const type = saved?.[task]
        if (type && MODEL_TYPES[type]?.mediaType === task) activeModelTypeByTask[task] = type
      }
      activeTask.value = data.activeTask === 'video' ? 'video' : 'image'
      Object.assign(modelSelections, data.modelSelections)

      if (data.modelStates) {
        for (const [key, rawState] of Object.entries(data.modelStates)) {
          const config = MODEL_TYPES[key]
          if (!config) continue
          const defaults = createDefaultState(config)
          const state = { ...defaults, ...rawState as Partial<ModelState> }
          for (const k of Object.keys(defaults) as (keyof ModelState)[]) {
            const value = defaults[k]
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              ;(state[k] as object) = { ...value, ...state[k] as object }
            }
          }
          for (const type of Object.keys(defaults.controlNets)) {
            state.controlNets[type] = { ...defaults.controlNets[type]!, ...state.controlNets[type] }
          }

          if (validators) {
            if (typeof state.clipSkip !== 'number' || state.clipSkip < 1 || state.clipSkip > 4) {
              const config = MODEL_TYPES[key] ?? MODEL_TYPES.sdxl!
              state.clipSkip = config.defaults.clip_skip ?? 1
            }
            if (state.sampler && validators.samplerExists && !validators.samplerExists(state.sampler)) {
              const config = MODEL_TYPES[key] ?? MODEL_TYPES.sdxl!
              state.sampler = config.defaults.sampler
            }
            if (state.scheduler && validators.schedulerExists && !validators.schedulerExists(state.scheduler)
              && !MODEL_TYPES[key]?.extraSchedulers?.includes(state.scheduler)) {
              const config = MODEL_TYPES[key] ?? MODEL_TYPES.sdxl!
              state.scheduler = config.defaults.scheduler
            }
          }

          modelStates[key] = state
        }
      }
      savedStates.value = JSON.parse(JSON.stringify(data.modelStates)) as Record<string, ModelState>
      return { outcome: 'applied' }
    } catch {
      return { outcome: 'failed' }
    }
  }

  return {
    activeModelType, activeModelTypeByTask, activeTask,
    modelStates, modelSelections,
    missingPaths, missingRefs, isMissing, pruneMissing, checkMissingFiles,
    restoredFiles,
    componentsReady, setComponentsReady,
    currentConfig, currentState, stateFor, configFor, setFast, setMode, setScheduler,
    switchModelType, selectModelGroup, switchTask, save, restore, enableAutoSave,
    saveError,
  }
})
