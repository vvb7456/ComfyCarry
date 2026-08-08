import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'
import type { ExecState } from '@/composables/useExecTracker'

export interface PreviewImage {
  filename: string
  subfolder: string
  type: string
  url: string
  /** 后端已归一为标量布尔: true=视频产物, false=图像。
   *  来自节点输出层 animated 字段下放 + 扩展名兜底 (实测契约表)。
   *  缺失时前端再用扩展名兜底 (isVideoFile)。 */
  animated?: boolean
}

/** 预览区五态状态机。
 *  - empty: 无产物、无执行态、无实时预览帧
 *  - queued: 执行态存在但尚未进入采样 (execution_start 后、首个 progress/executing 前)；
 *           也覆盖 fetchOutputImages 轮询期 (loading=true 且无 execState)
 *  - sampling: 执行态存在且有 progress 事件或实时预览帧 (采样节点运行中)
 *  - composing: 执行态的当前节点 class_type 属于 VAE 解码/视频封装类 (无步进事件, 数十秒) */
export type PreviewPhase = 'empty' | 'queued' | 'sampling' | 'composing'

/** 视频元信息 (完成态元信息行, "能拿到多少显示多少")。
 *  duration/width/height 来自 <video> loadedmetadata 事件;
 *  format 来自文件扩展名; fps 浏览器拿不到, 留 undefined。 */
export interface VideoMeta {
  duration?: number
  width?: number
  height?: number
  fps?: number
  format?: string
}

/** 视频扩展名集合 (与后端 is_video_filename / ImagePreview 判定对齐)。 */
const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i

/** 判定文件名是否为视频 (扩展名兜底)。 */
export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTS.test(filename)
}

/** 合成阶段节点 class_type 集合:
 *  executing 事件进入这些节点时切入「合成中」态。
 *  - VAEDecode / VAEDecodeTiled / VAEDecodeAudio: 视频/音频 VAE 解码 (耗时主体)
 *  - CreateVideo / SaveVideo / PreviewVideo: 视频封装落盘
 *  注意: PreviewImage 亦纳入 (部分工作流用它展示中间帧), 但仅 video 架构生效。 */
const COMPOSING_NODE_TYPES = new Set([
  'VAEDecode',
  'VAEDecodeTiled',
  'VAEDecodeAudio',
  'CreateVideo',
  'SaveVideo',
  'SaveAnimatedWEBP',
  'SaveAnimatedPNG',
  'PreviewVideo',
  'PreviewImage',
])

/** 采样节点 class_type 集合 (双段采样):
 *  KSamplerAdvanced (Wan 14B 双段) / KSampler (5B 单段) / SamplerCustomAdvanced (Hunyuan/LTX)。
 *  统计 nodeNames 里这些 class_type 的节点数 → 总段数。 */
const SAMPLER_NODE_TYPES = new Set([
  'KSampler',
  'KSamplerAdvanced',
  'SamplerCustomAdvanced',
])

/**
 * 纯函数: 从执行态派生预览 phase (五态状态机)。
 *
 * 优先级 (从高到低):
 * 1. hasOutput (有产物 且 无执行态) → 完成态 (返回 'empty', 因 phase 仅描述执行中子态;
 *    PreviewArea 用同一口径判完成)。调用方须自行带上 !execState —— 执行中时上一轮
 *    产物可能仍挂着 (后台模式逐轮不清), 若按 images.length>0 直接判完成, 采样/合成
 *    子态会整轮失效。
 * 2. execState 为空:
 *    - loading=true (fetchOutputImages 轮询) → 'queued'
 *    - 否则 → 'empty'
 * 3. execState 存在:
 *    - 当前节点 class_type ∈ COMPOSING_NODE_TYPES → 'composing'
 *    - 有 progress 或有 livePreview → 'sampling'
 *    - 否则 → 'queued'
 *
 * 回归保护: mediaType==='image' 时 composing 态不触发 (图像 VAE 解码极快,
 * 图像 path 的 VAEDecode 也会命中 COMPOSING_NODE_TYPES — 仅 video 架构生效,
 * 避免图像 path 在 VAEDecode 瞬间误显「合成中」)。
 */
export function derivePreviewPhase(params: {
  hasOutput: boolean
  loading: boolean
  execState: ExecState | null
  livePreview: string | null
  mediaType: 'image' | 'video'
}): PreviewPhase {
  const { hasOutput, loading, execState: es, livePreview, mediaType } = params
  if (hasOutput) return 'empty'
  if (!es) return loading ? 'queued' : 'empty'
  const currentNode = es.currentNode
  const currentType = currentNode ? (es.nodeNames[currentNode] || '') : ''
  if (mediaType === 'video' && currentType && COMPOSING_NODE_TYPES.has(currentType)) {
    return 'composing'
  }
  if (es.progress || livePreview) return 'sampling'
  return 'queued'
}

/**
 * 纯函数: 从执行态派生采样段号 (双段采样「第 n/2 段」)。
 *
 * 判定方式:
 * - 从 execState.nodeNames 筛选 class_type ∈ SAMPLER_NODE_TYPES 的节点,
 *   按 nodeId 排序得采样节点序列 (total = 序列长度)。
 * - currentNode 在序列中的位置 +1 = 当前段号。
 * - currentNode 不在序列时, 用 executedNodes 已执行采样节点数 +1 推断。
 *
 * 保守策略: 仅 video 且 total>=2 时返回非 null; 图像架构恒 null。
 */
export function deriveStageSegment(execState: ExecState | null, mediaType: 'image' | 'video'): { current: number; total: number } | null {
  if (mediaType !== 'video' || !execState) return null

  const samplerNodes = Object.entries(execState.nodeNames)
    .filter(([, classType]) => SAMPLER_NODE_TYPES.has(classType))
    .map(([nodeId]) => nodeId)
    .sort()

  const total = samplerNodes.length
  if (total < 2) return null

  const currentIdx = execState.currentNode ? samplerNodes.indexOf(execState.currentNode) : -1
  if (currentIdx >= 0) return { current: currentIdx + 1, total }

  let executedSamplers = 0
  for (const nodeId of samplerNodes) {
    if (execState.executedNodes.has(nodeId)) executedSamplers++
  }
  if (executedSamplers >= total) return null
  return { current: executedSamplers + 1, total }
}

function buildImageUrl(img: { filename: string; subfolder: string; type: string }): string {
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
  })
  return `/api/comfyui/view?${params}`
}

/** 构建视频首帧缩略图 URL (GET /api/comfyui/video_thumb)。 */
export function buildVideoThumbUrl(img: { filename: string; subfolder: string; type: string }): string {
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
  })
  return `/api/comfyui/video_thumb?${params}`
}

/**
 * Generate output image preview composable.
 * Fetches output images from /api/comfyui/history after execution.
 * Retries up to 6 times with 1s interval.
 *
 * 五态状态机 + 视频产物支持。
 * - attachExecState() 注入执行态与媒体类型, 驱动 phase / stageSegment 派生。
 *   未注入时 phase 退化为 empty/queued 二态 (图像 path 回归保护)。
 */
export function useGeneratePreview() {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })
  const images = ref<PreviewImage[]>([])
  const loading = ref(false)
  const currentPreview = ref<string | null>(null)

  // ── 状态机注入点 ──────────────────
  let _execState: Ref<ExecState | null> | null = null
  let _mediaType: Ref<'image' | 'video'> | null = null


  /** 注入执行态 ref 与媒体类型 ref, 激活 phase / stageSegment 派生。
   *  GeneratePage 在创建 preview 后调用:
   *    preview.attachExecState(tracker.state, computed(() => MODEL_TYPES[store.activeModelType]?.mediaType ?? 'image'))
   *  未调用时 phase 退化为图像 path 行为 (回归保护)。 */
  function attachExecState(execState: Ref<ExecState | null>, mediaType: Ref<'image' | 'video'>) {
    _execState = execState
    _mediaType = mediaType
  }

  /** 当前媒体类型 (未注入时默认 image)。 */
  const mediaType = computed<'image' | 'video'>(() => _mediaType?.value ?? 'image')

  // ── phase / stageSegment 派生 (委托纯函数 derivePreviewPhase / deriveStageSegment) ──
  const phase: ComputedRef<PreviewPhase> = computed(() =>
    derivePreviewPhase({
      // 完成态 = 有产物且不在执行中 (与 PreviewArea 同口径; 见该处注释)
      hasOutput: images.value.length > 0 && !_execState?.value,
      loading: loading.value,
      execState: _execState?.value ?? null,
      livePreview: currentPreview.value,
      mediaType: mediaType.value,
    }),
  )

  const stageSegment: ComputedRef<{ current: number; total: number } | null> = computed(() =>
    deriveStageSegment(_execState?.value ?? null, mediaType.value),
  )

  async function fetchOutputImages(promptId: string): Promise<void> {
    loading.value = true
    currentPreview.value = null

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(`/api/comfyui/history?prompt_id=${encodeURIComponent(promptId)}`)
        if (res.ok) {
          const data = await res.json()
          const entry = data?.history?.[0]
          if (entry?.images?.length) {
            images.value = entry.images.map((img: {
              filename: string
              subfolder: string
              type: string
              animated?: boolean
            }) => ({
              ...img,
              url: buildImageUrl(img),
            }))
            loading.value = false
            return
          }
        }
      } catch { /* retry */ }

      if (attempt < 5) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    // All retries exhausted — toast warning
    toast(t('generate.toast.no_output'), 'warning')
    loading.value = false
  }

  function setLivePreview(dataUrl: string) {
    currentPreview.value = dataUrl
  }

  function clearPreview() {
    images.value = []
    currentPreview.value = null
  }

  /** PreviewArea 的 <video> loadedmetadata 回调调用, 写入视频元信息。 */

  return {
    images,
    loading,
    currentPreview,
    phase,
    stageSegment,
    mediaType,
    fetchOutputImages,
    setLivePreview,
    clearPreview,
    attachExecState,
  }
}
