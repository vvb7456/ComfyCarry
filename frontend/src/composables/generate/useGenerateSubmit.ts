import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useGenerateStore } from '@/stores/generate'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { normalizePrompt } from '@/utils/prompt'
import type { ExecState } from '@/composables/useExecTracker'

interface SubmitResponse {
  prompt_id: string
  status: string
}

/**
 * Generate submission composable.
 * 6-step validation → POST /api/generate/submit → returns prompt_id.
 *
 * Validation steps (inherited from legacy):
 * 1. State check: not already generating
 * 2. Preprocess check: no active preprocess tasks (future)
 * 3. Basic: checkpoint + positive prompt required
 * 4. Inactive module warning: CN/I2I configured but not enabled
 * 5. CN validation: enabled CN must have model + image
 * 6. I2I validation: enabled I2I must have image
 */
export function useGenerateSubmit(execState: Ref<ExecState | null>) {
  const { post } = useApiFetch()
  const { t } = useI18n({ useScope: 'global' })
  const { confirm } = useConfirm()
  const { toast } = useToast()
  const store = useGenerateStore()

  const submitting = ref(false)

  async function submit(): Promise<string | null> {
    if (submitting.value) return null

    const state = store.currentState

    // 1. Check: not already generating
    if (execState.value) {
      toast(t('generate.toast.wait_workflow'), 'warning')
      return null
    }

    // 2. Preprocess check — placeholder for future phases

    // 3. Basic validation
    if (!state.checkpoint) {
      toast(t('generate.error.no_checkpoint'), 'error')
      return null
    }
    if (!state.positive.trim()) {
      toast(t('generate.error.no_prompt'), 'error')
      return null
    }

    // 4. Inactive module warning (configured but not enabled)
    const inactiveModules: string[] = []
    for (const [type, cn] of Object.entries(state.controlNets)) {
      if (!cn.enabled && cn.image) {
        inactiveModules.push(t(`generate.modules.${type}`))
      }
    }
    if (!state.i2i.enabled && state.i2i.image) {
      inactiveModules.push(t('generate.modules.i2i'))
    }

    if (inactiveModules.length > 0) {
      const proceed = await confirm({
        title: t('generate.error.modules_not_enabled'),
        message: `${t('generate.error.modules_not_enabled_desc')}\n\n${inactiveModules.join(', ')}`,
        confirmText: t('generate.error.skip_submit'),
        dontAskKey: 'gen_skip_inactive_warn',
      })
      if (!proceed) return null
    }

    // 5. CN validation: enabled CN must have model + image
    for (const [type, cn] of Object.entries(state.controlNets)) {
      if (cn.enabled) {
        if (!cn.model) {
          toast(t('generate.error.cn_no_model', { type }), 'error')
          return null
        }
        if (!cn.image) {
          toast(t('generate.error.cn_no_ref', { type }), 'error')
          return null
        }
      }
    }

    // 6. I2I validation: enabled I2I must have image
    if (state.i2i.enabled && !state.i2i.image) {
      toast(t('generate.error.i2i_no_ref'), 'error')
      return null
    }

    // ── Build payload ──────────────────────────────────────────────────────
    // Seed: random mode generates client-side value and writes back to store
    // so user can see/copy the actual seed used (legacy behavior §8.2)
    let seed: number
    if (state.seedMode === 'random') {
      seed = Math.floor(Math.random() * 4294967295) // 0 ~ 2^32-1
      state.seedValue = seed
    } else {
      seed = state.seedValue
    }

    const loras = state.loras
      .filter(l => l.enabled && l.name)
      .map(l => ({ name: l.name, strength: l.strength }))

    const controlnets = Object.entries(state.controlNets)
      .filter(([, cn]) => cn.enabled && cn.model && cn.image)
      .map(([type, cn]) => ({
        type,
        model: cn.model,
        image: cn.image,
        strength: cn.strength,
        start_percent: cn.start,
        end_percent: cn.end,
      }))

    // Normalize prompts before submission
    const { settings: ps } = usePromptSettings()
    const nOpts = {
      comma: ps.normalize_comma,
      period: ps.normalize_period,
      bracket: ps.normalize_bracket,
      underscore: ps.normalize_underscore,
      escapeBracket: ps.escape_bracket,
    }

    const payload: Record<string, unknown> = {
      model_type: store.activeModelType,
      checkpoint: state.checkpoint,
      positive_prompt: normalizePrompt(state.positive, nOpts),
      negative_prompt: normalizePrompt(state.negative, nOpts),
      width: state.width,
      height: state.height,
      batch_size: state.batch,
      seed,
      steps: state.steps,
      cfg: state.cfg,
      sampler: state.sampler,
      scheduler: state.scheduler,
      save_prefix: state.prefix,
      output_format: state.format,
      loras,
      controlnets,
    }

    // I2I
    if (state.i2i.enabled && state.i2i.image) {
      payload.i2i_image = state.i2i.image
      payload.i2i_denoise = state.i2i.denoise
    }

    // Upscale
    if (state.upscale.enabled) {
      payload.upscale_enabled = true
      payload.upscale_factor = state.upscale.factor
      payload.upscale_mode = state.upscale.mode
      payload.upscale_tile = state.upscale.tile
      payload.upscale_downscale = state.upscale.downscale
    }

    // HiRes
    if (state.hires.enabled) {
      payload.hires_enabled = true
      payload.hires_denoise = state.hires.denoise
      payload.hires_steps = state.hires.steps
      payload.hires_cfg = state.hires.cfg
      payload.hires_sampler = state.hires.sampler
      payload.hires_scheduler = state.hires.scheduler
      // HiRes seed: same client-side generation as main seed (legacy §8.3)
      let hiresSeed: number
      if (state.hires.seedMode === 'random') {
        hiresSeed = Math.floor(Math.random() * 4294967295)
        state.hires.seedValue = hiresSeed
      } else {
        hiresSeed = state.hires.seedValue
      }
      payload.hires_seed = hiresSeed
    }

    // ── Submit ─────────────────────────────────────────────────────────────
    submitting.value = true
    try {
      const result = await post<SubmitResponse>('/api/generate/submit', payload)
      if (!result?.prompt_id) {
        toast(t('generate.error.prompt_id_missing'), 'error')
        return null
      }
      toast(t('generate.toast.queued'), 'success')
      return result.prompt_id
    } finally {
      submitting.value = false
    }
  }

  return { submitting, submit }
}
