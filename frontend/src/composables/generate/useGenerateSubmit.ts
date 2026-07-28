import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useGenerateStore } from '@/stores/generate'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { normalizePrompt } from '@/utils/prompt'
import { MODEL_TYPES } from '@/config/model-types'
import { packagingOf } from '@/composables/generate/useGenerateOptions'
import type { GenerateOptionsReturn } from '@/composables/generate/useGenerateOptions'
import type { ExecState } from '@/composables/useExecTracker'

interface SubmitResponse {
  prompt_id: string
  status: string
}

/**
 * Generate submission composable.
 * 6-step validation → POST /api/generate/submit → returns prompt_id.
 *
 * Validation steps:
 * 1. State check: not already generating
 * 2. Preprocess check: no active preprocess tasks (future)
 * 3. Basic: checkpoint + positive prompt required
 * 4. Inactive module warning: CN/I2I configured but not enabled
 * 5. CN validation: enabled CN must have model + image
 * 6. I2I validation: enabled I2I must have image
 */
export function useGenerateSubmit(
  execState: Ref<ExecState | null>,
  options: GenerateOptionsReturn,
) {
  const { post: apiPost } = useApiFetch()
  const { t } = useI18n({ useScope: 'global' })
  const { confirm } = useConfirm()
  const { toast } = useToast()
  const store = useGenerateStore()

  const submitting = ref(false)

  /**
   * 视频架构 variant 推导 — 与后端 generate_service.py `_VIDEO_ARCHS` 分支的
   * `{"wan22_i2v": "i2v", "wan22_t2v": "t2v", "wan22_5b": "5b"}` 映射逐字一致。
   * 非 _VIDEO_ARCHS 条目返回 null。
   */
  function videoVariant(modelType: string): 'i2v' | 't2v' | '5b' | null {
    if (modelType === 'wan22_i2v') return 'i2v'
    if (modelType === 'wan22_t2v') return 't2v'
    if (modelType === 'wan22_5b') return '5b'
    return null
  }

  /**
   * 当前选中模型的包装形态: 调 packagingOf helper, 与 ModelTab.vue
   * 的 selectedPackaging 共用同一判据 (旧实现此处 checkpoint 优先, selectedPackaging
   * unet 优先, 脏数据下会分叉)。validate() 与 buildPayload() 各自独立调用, 二者
   * 必须得出同一结论, 故抽此处单点推导。
   */
  function resolvePackaging() {
    const state = store.currentState
    const modelType = store.activeModelType
    const activeConfig = MODEL_TYPES[modelType]
    const selectedPackaging = packagingOf(
      state.checkpoint || state.unet,
      activeConfig,
      options.checkpoints.value.map(m => m.name),
    )
    return { modelType, activeConfig, selectedPackaging }
  }

  async function validate(): Promise<boolean> {
    const state = store.currentState

    // 1. Check: not already generating
    if (execState.value) {
      toast(t('generate.toast.wait_workflow'), 'warning')
      return false
    }

    // 2. Preprocess check — placeholder for future phases

    // 3. Basic validation
    const { modelType, activeConfig, selectedPackaging } = resolvePackaging()

    // 视频架构走独立校验分支 (对齐后端 _VIDEO_ARCHS, 不走图像的 split/checkpoint 逻辑)
    if (activeConfig?.mediaType === 'video') {
      const variant = videoVariant(modelType)
      // 14B 双 UNet (unet_high/unet_low 必填且互异); 5B 单 unet 必填
      if (variant && variant !== '5b') {
        if (!state.unetHigh || !state.unetLow) {
          toast(t('generate.error.no_unet_pair'), 'error')
          return false
        }
        // 互异: v6 起两个槽由用户各自独立选择, 完全可能选中同一个文件 (这条校验因此是
        // 载荷性的, 不再只是防脏数据)。后端也会拦 (400), 这里前置以少一次往返。
        if (state.unetHigh === state.unetLow) {
          toast(t('generate.error.video_same_unet'), 'error')
          return false
        }
      } else {
        if (!state.unet) {
          toast(t('generate.error.no_split_models'), 'error')
          return false
        }
      }
      // TE / VAE 必填
      if (!state.clip || !state.vae) {
        toast(t('generate.error.no_split_models'), 'error')
        return false
      }
      if (!state.positive.trim()) {
        toast(t('generate.error.no_prompt'), 'error')
        return false
      }
      // 起始画面: i2v 必填; 5b 仅 mode=='i2v' 时必填
      const v = state.video
      let needStart = variant === 'i2v'
      if (variant === '5b' && v?.mode) {
        needStart = v.mode === 'i2v'
      }
      if (needStart && !v?.refImage) {
        // 与 ModelTab.runBlockedReason 用同一条文案 (阻断只有一种表达)
        toast(t('generate.error.no_start_frame'), 'error')
        return false
      }
      // 视频架构无 CN/i2i/face/hires/upscale 模块 (config.modules 仅 ['lora']), 跳过后续图像校验
      return true
    }

    if (selectedPackaging === 'split') {
      if (!state.unet || !state.clip || !state.vae) {
        toast(t('generate.error.no_split_models'), 'error')
        return false
      }
      // DualCLIPLoader 架构 (flux1): 第二个文本编码器必填
      if (activeConfig?.dualClip && !state.clip2) {
        toast(t('generate.error.no_split_models'), 'error')
        return false
      }
    } else {
      if (!state.checkpoint) {
        toast(t('generate.error.no_checkpoint'), 'error')
        return false
      }
    }
    if (!state.positive.trim()) {
      toast(t('generate.error.no_prompt'), 'error')
      return false
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
      if (!proceed) return false
    }

    // 5. CN validation: enabled CN must have model + image
    for (const [type, cn] of Object.entries(state.controlNets)) {
      if (cn.enabled) {
        if (!cn.model) {
          toast(t('generate.error.cn_no_model', { type }), 'error')
          return false
        }
        if (!cn.image) {
          toast(t('generate.error.cn_no_ref', { type }), 'error')
          return false
        }
      }
    }

    // 6. I2I validation: enabled I2I must have image
    if (state.i2i.enabled && !state.i2i.image) {
      toast(t('generate.error.i2i_no_ref'), 'error')
      return false
    }

    // 6b. Inpaint mode: image exists but no mask → ConfirmDialog
    if (state.i2i.enabled && state.i2i.image && state.i2i.mode === 'inpaint' && !state.i2i.mask) {
      const proceed = await confirm({
        title: t('generate.error.inpaint_no_mask'),
        message: t('generate.error.inpaint_no_mask_desc'),
        confirmText: t('generate.error.skip_submit'),
        dontAskKey: 'gen_inpaint_no_mask_warn',
      })
      if (!proceed) return false
      // User confirmed → fall through to standard I2I payload (mask is null)
    }

    return true
  }

  function buildPayload(opts?: { randomSeedWriteback?: boolean }): Record<string, unknown> {
    const randomSeedWriteback = opts?.randomSeedWriteback ?? true
    const state = store.currentState

    // ── Build payload ──────────────────────────────────────────────────────
    // Seed: random mode generates client-side value and writes back to store
    // so user can see/copy the actual seed used
    let seed: number
    if (state.seedMode === 'random') {
      seed = Math.floor(Math.random() * 4294967295) // 0 ~ 2^32-1
      if (randomSeedWriteback) {
        state.seedValue = seed
      }
    } else {
      seed = state.seedValue
    }

    // resolvePackaging 提前到 loras/controlnets 组装之前 — video 分支需读 mediaType
    // 决定是否给 loras 附加 apply 字段。
    const { modelType, activeConfig, selectedPackaging } = resolvePackaging()

    // 视频双段 LoRA 的 apply (high/low/both) 透传给后端 build_wan22_workflow;
    // 图像架构无此字段, l.apply 为 undefined 不会进 payload (builder 不读)。
    // 图像侧 payload 一字不变 (回归保护): 仅当当前架构为 video 时才附加 apply。
    const isVideoArch = activeConfig?.mediaType === 'video'
    const loras = state.loras
      .filter(l => l.enabled && l.name)
      .map(l => {
        const entry: { name: string; strength: number; apply?: 'high' | 'low' | 'both' } = {
          name: l.name,
          strength: l.strength,
        }
        if (isVideoArch && l.apply) entry.apply = l.apply
        return entry
      })

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

    // ── 视频架构: 独立 payload 组装 (对齐后端 _VIDEO_ARCHS 分支) ──
    // 字段名与 generate_service.py:183-329 逐字对齐:
    //   model_type = 细粒度 key (wan22_i2v/wan22_t2v/wan22_5b), 不能用 workflowType 'wan22'
    //   14B: unet_high / unet_low / clip / vae
    //   5B: unet / clip / vae
    //   start_image (i2v 必填) / mode (仅 5b) / width / height / duration_s / speed (仅 14b) / batch_size 恒 1
    // 图像侧 payload 组装一字不变 (回归保护): 视频早返回, 不走下面的图像分支。
    if (activeConfig?.mediaType === 'video') {
      const variant = videoVariant(modelType)
      const is14b = variant === 'i2v' || variant === 't2v'
      const v = state.video
      // start_image: i2v 必填; 5b 仅 mode=='i2v' 时
      let needStart = variant === 'i2v'
      if (variant === '5b' && v?.mode) needStart = v.mode === 'i2v'
      const startImage = needStart ? (v?.refImage ?? '') : ''

      const vpayload: Record<string, unknown> = {
        model_type: modelType, // 细粒度 key, 后端 _VIDEO_ARCHS 与 _BUILDERS 均以该 key 路由
        positive_prompt: normalizePrompt(state.positive, nOpts),
        negative_prompt: normalizePrompt(state.negative, nOpts),
        width: v?.width ?? state.width,
        height: v?.height ?? state.height,
        batch_size: 1, // 视频不支持批量 (后端恒纠正为 1)
        seed,
        save_prefix: state.prefix,
        // output_format 仅对图像 WASImageSave 有效; 视频走 SaveVideo(mp4/h264), 该字段被忽略。
        // 传 'png' (图像默认) 以通过后端 output_format 枚举校验; mp4 锁定在 builder 端实现。
        output_format: 'png',
        loras,
      }
      // 14B 双权重 (unet_high/unet_low); 5B 单权重 (unet)
      if (is14b) {
        vpayload.unet_high = state.unetHigh
        vpayload.unet_low = state.unetLow
      } else {
        vpayload.unet = state.unet
      }
      vpayload.clip = state.clip
      vpayload.vae = state.vae
      // 起始画面 (i2v 必填; t2v 传空串由后端清脏值)
      vpayload.start_image = startImage
      // 5B 条目内模式开关
      if (variant === '5b' && v?.mode) {
        vpayload.mode = v.mode
      }
      // 时长 (秒) — 后端按 frames = fps×duration+1 换算帧数
      vpayload.duration_s = v?.durationS ?? 5
      // 速度档 (仅 14B): fast / standard
      if (is14b) {
        vpayload.speed = state.fast ? 'fast' : 'standard'
        // 标准档才传 steps/cfg; 快速档后端丢弃 (builder 常量决定)
        if (!state.fast) {
          vpayload.steps = state.steps
          vpayload.cfg = state.cfg
        }
      }
      return vpayload
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

    // 架构专属字段 (按 selectedPackaging 分流)
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
      // checkpoint 系专属 — clip_skip (仅 >1 时传) + vae 覆盖 (仅非空时传)
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
      // HiRes seed: same client-side generation as main seed
      let hiresSeed: number
      if (state.hires.seedMode === 'random') {
        hiresSeed = Math.floor(Math.random() * 4294967295)
        if (randomSeedWriteback) {
          state.hires.seedValue = hiresSeed
        }
      } else {
        hiresSeed = state.hires.seedValue
      }
      payload.hires_seed = hiresSeed
    }

    // 面部重绘 (FaceDetailer)
    if (state.faceDetailer.enabled) {
      payload.face_detailer_enabled = true
      payload.face_detailer_model = state.faceDetailer.detectionModel
      payload.face_detailer_denoise = state.faceDetailer.denoise
      payload.face_detailer_steps = state.faceDetailer.steps
      payload.face_detailer_cfg = state.faceDetailer.cfg
      payload.face_detailer_guide_size = state.faceDetailer.guideSize
      payload.face_detailer_crop_factor = state.faceDetailer.cropFactor
      payload.face_detailer_bbox_threshold = state.faceDetailer.bboxThreshold
      payload.face_detailer_feather = state.faceDetailer.feather
      payload.face_detailer_use_sam = state.faceDetailer.useSam
      const facePrompt = state.faceDetailer.prompt.trim()
      if (facePrompt) payload.face_detailer_prompt = facePrompt
    }

    return payload
  }

  async function post(payload: Record<string, unknown>): Promise<string | null> {
    // ── Submit ─────────────────────────────────────────────────────────────
    submitting.value = true
    try {
      const result = await apiPost<SubmitResponse>('/api/generate/submit', payload)
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

  async function submit(): Promise<string | null> {
    if (submitting.value) return null
    if (!(await validate())) return null
    return post(buildPayload())
  }

  return { submitting, submit, validate, buildPayload, post }
}
