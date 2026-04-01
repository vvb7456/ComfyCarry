import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import type { ModelTypeConfig } from '@/config/model-types'
import { MODEL_TYPES } from '@/config/model-types'

interface ControlNetState {
  enabled: boolean
  model: string
  strength: number
  start: number
  end: number
  image: string | null
}

interface ModelState {
  positive: string
  negative: string
  checkpoint: string
  loras: Record<string, number>
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
  controlNets: Record<string, ControlNetState>
  upscale: { enabled: boolean; factor: number; mode: string; tile: number; downscale: string }
  hires: { enabled: boolean; denoise: number; steps: number; cfg: number; sampler: string; scheduler: string; seedMode: string; seedValue: number }
  i2i: { enabled: boolean; image: string | null; denoise: number }
  activeModule: string
}

const STORAGE_KEY = 'comfycarry_generate_params'

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
    loras: {},
    resolution: config.resolutions[0]?.value || '1024x1024',
    width: 1024,
    height: 1024,
    steps: config.defaults.steps,
    cfg: config.defaults.cfg,
    sampler: config.defaults.sampler,
    scheduler: config.defaults.scheduler,
    seedMode: 'random',
    seedValue: -1,
    batch: 1,
    prefix: '',
    format: 'png',
    controlNets,
    upscale: { enabled: false, factor: 2, mode: '', tile: 512, downscale: '' },
    hires: { enabled: false, denoise: 0.5, steps: 10, cfg: 7, sampler: '', scheduler: '', seedMode: 'random', seedValue: -1 },
    i2i: { enabled: false, image: null, denoise: 0.75 },
    activeModule: config.modules[0] || 'lora',
  }
}

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
        activeModelType: activeModelType.value,
        modelStates: JSON.parse(JSON.stringify(modelStates)),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* ignore quota errors */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (data.activeModelType && MODEL_TYPES[data.activeModelType]) {
        activeModelType.value = data.activeModelType
      }
      if (data.modelStates) {
        Object.entries(data.modelStates).forEach(([key, state]) => {
          modelStates[key] = state as ModelState
        })
      }
    } catch { /* ignore corrupt data */ }
  }

  return {
    activeModelType, modelStates,
    currentConfig, currentState,
    switchModelType, save, restore,
  }
})
