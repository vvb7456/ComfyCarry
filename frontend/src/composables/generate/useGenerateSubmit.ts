import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useGenerateStore } from '@/stores/generate'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { normalizePrompt } from '@/utils/prompt'
import { MODEL_TYPES } from '@/config/model-types'
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
    const modelType = store.activeModelType
    const activeConfig = MODEL_TYPES[modelType]
    // §5.3 当前选中模型的包装形态: 两形态并存 tab 下按 state.checkpoint/unet 哪个非空判断
    // (picker 互斥: 选整合包写 state.checkpoint,选拆分件写 state.unet)
    const hasDualPackaging = (activeConfig?.supportedPackaging.length ?? 0) > 1
    const selectedPackaging: 'checkpoint' | 'split' = hasDualPackaging
      ? (state.checkpoint ? 'checkpoint' : 'split')
      : (activeConfig?.loader === 'split' ? 'split' : 'checkpoint')

    if (selectedPackaging === 'split') {
      if (!state.unet || !state.clip || !state.vae) {
        toast(t('generate.error.no_split_models'), 'error')
        return null
      }
      // DualCLIPLoader 架构 (flux1): 第二个文本编码器必填
      if (activeConfig?.dualClip && !state.clip2) {
        toast(t('generate.error.no_split_models'), 'error')
        return null
      }
    } else {
      if (!state.checkpoint) {
        toast(t('generate.error.no_checkpoint'), 'error')
        return null
      }
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

    // 6b. Inpaint mode: image exists but no mask → ConfirmDialog
    if (state.i2i.enabled && state.i2i.image && state.i2i.mode === 'inpaint' && !state.i2i.mask) {
      const proceed = await confirm({
        title: t('generate.error.inpaint_no_mask'),
        message: t('generate.error.inpaint_no_mask_desc'),
        confirmText: t('generate.error.skip_submit'),
        dontAskKey: 'gen_inpaint_no_mask_warn',
      })
      if (!proceed) return null
      // User confirmed → fall through to standard I2I payload (mask is null)
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
    }

    // 软架构条目 (pony/illustrious/noobai) 通过 workflowType 提交 'sdxl',
    // 后端按 sdxl 工作流编排 (arch 层面相同)。其余 entry 用自身 key。
    const submitModelType = activeConfig?.workflowType ?? modelType

    const payload: Record<string, unknown> = {
      model_type: submitModelType,
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

    // 架构专属参数 (extraParams): 注入到 payload 顶层
    // flux2klein/flux2dev 的 guider_mode 即此机制驱动; 后端按此字段分支
    if (activeConfig?.extraParams) {
      Object.assign(payload, activeConfig.extraParams)
    }

    // 架构专属字段 (按 selectedPackaging 分流, §5.3)
    payload.packaging = selectedPackaging
    if (selectedPackaging === 'split') {
      payload.unet = state.unet
      payload.clip = state.clip
      payload.vae = state.vae
      // DualCLIPLoader 架构 (flux1): 第二个文本编码器
      if (activeConfig?.dualClip) {
        payload.clip2 = state.clip2
      }
    } else {
      payload.checkpoint = state.checkpoint
      // B3: checkpoint 系专属 — clip_skip (仅 >1 时传) + vae 覆盖 (仅非空时传)
      if (state.clipSkip > 1) payload.clip_skip = state.clipSkip
      if (state.vaeOverride) payload.vae = state.vaeOverride
    }

    // I2I / Inpaint
    if (state.i2i.enabled && state.i2i.image) {
      if (state.i2i.mode === 'inpaint' && state.i2i.mask) {
        // Inpaint mode: VAEEncodeForInpaint
        payload.inpaint_image = state.i2i.image
        payload.inpaint_mask = state.i2i.mask
        payload.inpaint_denoise = state.i2i.denoise
        payload.inpaint_grow_mask_by = state.i2i.growMaskBy
      } else {
        // Standard I2I mode (or inpaint without mask after user confirmed)
        payload.i2i_image = state.i2i.image
        payload.i2i_denoise = state.i2i.denoise
      }
    }

    // Upscale
    if (state.upscale.enabled) {
      payload.upscale_enabled = true
      payload.upscale_factor = state.upscale.factor
      payload.upscale_engine = state.upscale.engine
      payload.upscale_mode = state.upscale.mode
      payload.upscale_tile = state.upscale.tile
      payload.upscale_downscale = state.upscale.downscale
      if (state.upscale.engine === 'seedvr2') {
        payload.upscale_svr_model = state.upscale.svrModel
        payload.upscale_svr_color_correction = state.upscale.svrColorCorrection
        payload.upscale_svr_input_noise = state.upscale.svrInputNoise
        payload.upscale_svr_latent_noise = state.upscale.svrLatentNoise
        payload.upscale_svr_tiled_vae = state.upscale.svrTiledVae
      }
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
