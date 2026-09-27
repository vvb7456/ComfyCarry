import { MODEL_TYPE_DIRS, HF_VERSION_INDEX, fileDirectory } from '@/config/huggingface-models'
import { componentsForSlot } from '@/config/component-registry'
import { getCnDepGroup, type CnBranch } from './modelDepConfigs'
import { MODEL_TYPES } from '@/config/model-types'
import type { ModelState } from '@/stores/generate'
import { joinFilePath } from '@/utils/filePath'

export interface WorkspaceFile {
  field: string
  path: string
  category: string
}

export function workspaceFiles(arch: string, state: ModelState): WorkspaceFile[] {
  const files: WorkspaceFile[] = []
  function selected(field: string, name: string, category: keyof typeof MODEL_TYPE_DIRS) {
    if (!name) return
    const original = state.files?.find(file => file.field === field && file.path.endsWith('/' + name))
    files.push({ field, path: original?.path ?? joinFilePath(MODEL_TYPE_DIRS[category], name), category })
  }
  function dependency(field: string, versionId: number) {
    const entry = HF_VERSION_INDEX.get(versionId)
    if (!entry) throw new Error(`Missing whitelist file: ${versionId}`)
    const file = entry.version.file
    const original = state.files?.find(f => f.field === field)
    files.push({ field, path: original?.path ?? joinFilePath(fileDirectory(file), file.filename), category: file.modelType })
  }

  selected('checkpoint', state.checkpoint, 'checkpoints')
  for (const field of ['unet', 'unetHigh', 'unetLow'] as const) selected(field, state[field], 'diffusion_models')
  for (const field of ['clip', 'clip2'] as const) selected(field, state[field], 'text_encoders')
  for (const field of ['vae', 'vaeOverride', 'audioVae'] as const) selected(field, state[field], 'vae')
  for (const lora of state.loras) if (lora.enabled) selected('loras', lora.name, 'loras')

  for (const [type, cn] of Object.entries(state.controlNets)) {
    if (!cn.enabled) continue
    selected(`controlNets.${type}.model`, cn.model, 'controlnet')
    const group = getCnDepGroup(type, MODEL_TYPES[arch]?.cnBranch as CnBranch | undefined)
    for (const row of group.rows) {
      for (const file of row.files) {
        if (file.hf?.version.file.isModel === false) {
          dependency(`controlNets.${type}.dependency.${file.hf.version.id}`, file.hf.version.id)
        }
      }
    }
  }
  if (state.upscale.enabled) {
    if (state.upscale.engine === 'seedvr2') {
      selected('upscale.svrModel', state.upscale.svrModel, 'seedvr2')
      dependency('upscale.seedvr2Vae', -10000369)
    } else {
      dependency('upscale.aurasr', -10000371)
      dependency('upscale.aurasrConfig', -10000384)
    }
  }
  if (state.faceDetailer.enabled) {
    selected('faceDetailer.detectionModel', state.faceDetailer.detectionModel, 'ultralytics_bbox')
    if (state.faceDetailer.useSam) dependency('faceDetailer.sam', -10000385)
  }
  if (state.fast && (state.unetHigh || state.unetLow)) {
    for (const file of componentsForSlot(arch, 'lightning')) {
      dependency(`fast.${file.id}`, file.hfVersionId)
    }
  }
  return files
}
