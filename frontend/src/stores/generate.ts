import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import type { ModelTypeConfig } from '@/config/model-types'
import { MODEL_TYPES } from '@/config/model-types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LoraEntry {
  name: string
  strength: number
  enabled: boolean
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
}

export interface ModelState {
  positive: string
  negative: string
  checkpoint: string
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
  runMode: 'normal' | 'live'
  controlNets: Record<string, ControlNetState>
  upscale: UpscaleState
  hires: HiResState
  i2i: I2IState
  activeModule: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'comfycarry_generate_params'
const SCHEMA_VERSION = 2
const SAVE_DEBOUNCE_MS = 300

function randomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

// ── Factory ──────────────────────────────────────────────────────────────────

function createDefaultState(config: ModelTypeConfig): ModelState {
  const cnTypes = ['pose', 'canny', 'depth']
  const controlNets: Record<string, ControlNetState> = {}
  cnTypes.forEach(t => {
    controlNets[t] = { enabled: false, model: '', strength: 1, start: 0, end: 1, image: null }
  })

  return {
    positive: '',
    negative: '',
    checkpoint: '',
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
    controlNets,
    upscale: { enabled: false, factor: 2, mode: '4x_overlapped_checkboard', tile: 8, downscale: 'lanczos' },
    hires: { enabled: false, denoise: 0.4, steps: 20, cfg: 7, sampler: 'euler', scheduler: 'normal', seedMode: 'random', seedValue: randomSeed() },
    i2i: { enabled: false, image: null, denoise: 0.7 },
    activeModule: config.modules[0] || 'lora',
  }
}

/**
 * Migrate v1 (old format) data to v2.
 * v1: loras was Record<string, number>, no runMode, wrong defaults
 */
function migrateV1(state: Record<string, unknown>): ModelState | null {
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

// ── Store ────────────────────────────────────────────────────────────────────

export const useGenerateStore = defineStore('generate', () => {
  const activeModelType = ref('sdxl')
  const modelStates = reactive<Record<string, ModelState>>({})

  const currentConfig = computed<ModelTypeConfig>(() => MODEL_TYPES[activeModelType.value] || MODEL_TYPES.sdxl)
  const currentState = computed<ModelState>(() => {
    if (!modelStates[activeModelType.value]) {
      modelStates[activeModelType.value] = createDefaultState(currentConfig.value)
    }
    return modelStates[activeModelType.value]
  })

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
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function switchModelType(type: string) {
    if (!MODEL_TYPES[type]) return
    activeModelType.value = type
    if (!modelStates[type]) {
      modelStates[type] = createDefaultState(MODEL_TYPES[type])
    }
  }

  function save() {
    try {
      const data = {
        _version: SCHEMA_VERSION,
        activeModelType: activeModelType.value,
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

      if (data.activeModelType && MODEL_TYPES[data.activeModelType]) {
        activeModelType.value = data.activeModelType
      }

      if (data.modelStates) {
        for (const [key, rawState] of Object.entries(data.modelStates)) {
          let state = rawState as ModelState

          // Migrate from v1
          if (version < 2) {
            const migrated = migrateV1(rawState as Record<string, unknown>)
            if (!migrated) continue
            state = migrated
          }

          // Validate against current options
          if (validators) {
            if (state.checkpoint && validators.checkpointExists && !validators.checkpointExists(state.checkpoint)) {
              state.checkpoint = ''
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

          // Merge with defaults to fill any missing fields
          const config = MODEL_TYPES[key]
          if (config) {
            const defaults = createDefaultState(config)
            modelStates[key] = { ...defaults, ...state }
          } else {
            modelStates[key] = state
          }
        }
      }
    } catch { /* ignore corrupt data */ }
  }

  return {
    activeModelType, modelStates,
    currentConfig, currentState,
    switchModelType, save, restore, enableAutoSave,
  }
})
