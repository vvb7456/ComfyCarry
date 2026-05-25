export interface ModelTypeConfig {
  key: string
  label: string
  icon: string
  archFilter: string[]
  resolutions: { label: string; value: string }[]
  defaults: {
    steps: number
    cfg: number
    sampler: string
    scheduler: string
  }
  hasNegativePrompt: boolean
  modules: string[]
  extraParams?: Record<string, string | number | boolean>
}

export const MODEL_TYPES: Record<string, ModelTypeConfig> = {
  sdxl: {
    key: 'sdxl',
    label: 'SDXL',
    icon: 'image',
    archFilter: ['sdxl'],
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
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
  anima: {
    key: 'anima',
    label: 'Anima',
    icon: 'palette',
    archFilter: ['anima'],
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
    // ControlNet 模块开关 disabled (Anima 暂无 ControlNet 生态)
    modules: ['lora', 'i2i', 'controlnet', 'upscale', 'hires'],
  },
}
