import type { ModelTypeConfig } from '@/config/model-types'
import type { ModelState, RefItem } from '@/stores/generate'

type TranslateFn = (key: string, params?: Record<string, unknown>) => string

export function needsVideoStartFrame(config: ModelTypeConfig, state: ModelState): boolean {
  if (config.mediaType !== 'video') return false
  const mode = state.video?.mode ?? state.mode
  if (mode === 'ref') return false
  if (config.videoModes?.length) return mode === 'i2v'
  return !(config.runtimeKey ?? config.key).includes('t2v')
}

export function validateRefMedia(
  refs: readonly RefItem[],
  opts: { isVideo: boolean; referenceLimit?: number },
  t: TranslateFn,
): string {
  if (!refs.length) return t('generate.error.minimax_h3_refs_required')
  if (opts.isVideo) {
    if (refs.every(r => r.type === 'audio')) {
      return t('generate.error.minimax_h3_refs_audio_requires_visual')
    }
    const img = refs.filter(r => r.type === 'image').length
    const vid = refs.filter(r => r.type === 'video').length
    const aud = refs.filter(r => r.type === 'audio').length
    if (img > 9) return t('generate.error.minimax_h3_refs_images_too_many', { limit: 9, current: img })
    if (vid > 3) return t('generate.error.minimax_h3_refs_videos_too_many', { limit: 3, current: vid })
    if (aud > 3) return t('generate.error.minimax_h3_refs_audios_too_many', { limit: 3, current: aud })
    if (refs.length > 12) return t('generate.error.minimax_h3_refs_total_too_many', { limit: 12, current: refs.length })
    return ''
  }
  const limit = opts.referenceLimit ?? 12
  if (refs.length > limit) {
    return t('generate.error.minimax_h3_refs_images_too_many', { limit, current: refs.length })
  }
  return ''
}

export function validateBaseReadiness(
  state: ModelState,
  config: ModelTypeConfig,
  selectedPackaging: 'checkpoint' | 'split',
  t: TranslateFn,
  checkModuleDeps?: () => string,
): string {
  const isVideo = config.mediaType === 'video'
  const runtimeKey = config.runtimeKey ?? config.key
  const isH3 = runtimeKey === 'minimax_h3' || runtimeKey === 'minimax_h3_ref'

  if (config.dualUnet) {
    if (!state.unetHigh || !state.unetLow) return t('generate.error.no_unet_pair')
    if (state.unetHigh === state.unetLow) return t('generate.error.video_same_unet')
  } else {
    const modelPicked = selectedPackaging === 'split' ? !!state.unet : !!state.checkpoint
    if (!modelPicked) {
      return t(isH3 ? 'generate.error.minimax_h3_unet_required' : 'generate.error.no_checkpoint')
    }
  }

  if (
    needsVideoStartFrame(config, state)
    && !state.video?.refImage
    && !(config.controlNetEnabled && Object.values(state.controlNets).some(cn => cn.enabled))
  ) {
    return t('generate.error.no_start_frame')
  }

  const activeMode = state.video?.mode ?? state.mode
  if (activeMode === 'ref') {
    const refs = (isVideo ? state.video?.refs : state.refs) ?? []
    const refErr = validateRefMedia(refs, { isVideo, referenceLimit: config.referenceLimit }, t)
    if (refErr) return refErr
  }

  if (checkModuleDeps) {
    const depErr = checkModuleDeps()
    if (depErr) return depErr
  }

  if (selectedPackaging === 'split') {
    if (!state.clip || !state.vae || (config.dualClip && !state.clip2) || (isH3 && !state.audioVae)) {
      return t(isH3 ? 'generate.error.minimax_h3_te_vae_required' : 'generate.error.no_split_models')
    }
  }

  return ''
}
