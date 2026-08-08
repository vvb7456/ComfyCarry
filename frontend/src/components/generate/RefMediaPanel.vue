<script setup lang="ts">
/**
 * RefMediaPanel — MiniMax H3 Ref2VA 参考素材面板 (挂 PromptEditor #media 槽,
 * 复用既有「左侧媒体」形态, 与 wan22 起始画面同一位置, 不新增布局变体)。
 *
 * 不撑高容器的原理 (与 FileUploadZone 相同): 媒体列高度由正/负文本框决定,
 * 面板根 flex:1 + min-height:0, 素材网格 flex:1 + overflow-y:auto ——
 * 素材超出时网格内部滚动, 面板的最小内容高度只有「标签行 + 添加行」。
 *
 * 结构: [参考素材 n/12] / [40px 方形素材块网格 (3列, 内部滚动)] / [图·视频·音频添加钮]。
 * 素材块: 图片显缩略图, 视频/音频显类型图标; 右下角编号角标 = 引用编号
 * (<Picture N> / <Video N> / <Audio N>, 类内顺序); 悬浮右上角出现删除 ×;
 * title tooltip 为 「文件名 · 引用标签」(语法教学, 零视觉成本)。
 *
 * 添加两路:
 *  - 图片: 开 RefImageModal「从输入目录选择」(useRefImagePicker('h3_ref'), 含上传)
 *  - 视频 / 音频: 仅本地上传 (隐藏 file input, accept 按类型)
 * 上传统一 POST /api/generate/upload_image (FormData file + type='h3_ref'),
 * 成功后把返回 filename 追加到对应 type 组; 失败走 toast(apiErrorText)。
 * 配额: 图片 ≤9 / 视频 ≤3 / 音频 ≤3 / 总数 ≤12, 组满或总数满时禁用对应添加按钮。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { apiErrorText, type ApiErrorBody } from '@/utils/apiError'
import { IMAGE_ACCEPT, useRefImagePicker } from '@/composables/generate/useRefImagePicker'
import type { RefItem } from '@/stores/generate'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'

defineOptions({ name: 'RefMediaPanel' })

const props = defineProps<{
  refs: RefItem[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:refs': [value: RefItem[]]
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

// ── 配额常量 (与后端校验一致) ──
const LIMIT_IMAGE = 9
const LIMIT_VIDEO = 3
const LIMIT_AUDIO = 3
const LIMIT_TOTAL = 12

/** 引用标签名 — 提示词语法 (<Picture 1>) 是固定英文, 不走 i18n */
const TAG_NAME: Record<RefItem['type'], string> = { image: 'Picture', video: 'Video', audio: 'Audio' }

// ── 帮助模态 (用法说明, 内容依据 MiniMax 官方文档) ──
const helpOpen = ref(false)

// ── 图片 picker (从输入目录选择) ──
const imagePicker = useRefImagePicker('h3_ref')

// ── 上传: 单个隐藏 file input, 用 pendingType 记录当前目标组 ──
const pendingType = ref<RefItem['type'] | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

/** 各组的 file input accept 白名单 */
const ACCEPT_MAP: Record<RefItem['type'], string> = {
  image: IMAGE_ACCEPT,
  video: 'video/mp4,video/webm,video/quicktime',
  audio: 'audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/mp4,audio/aac',
}

function countOf(type: RefItem['type']): number {
  return props.refs.filter(r => r.type === type).length
}

/** 当前组是否已满 (组满或总数满) — 驱动添加按钮禁用 */
const totalDisabled = computed(() => props.refs.length >= LIMIT_TOTAL)
const imgAddDisabled = computed(() => totalDisabled.value || countOf('image') >= LIMIT_IMAGE)
const vidAddDisabled = computed(() => totalDisabled.value || countOf('video') >= LIMIT_VIDEO)
const audAddDisabled = computed(() => totalDisabled.value || countOf('audio') >= LIMIT_AUDIO)

function addRef(type: RefItem['type'], name: string) {
  const refs = [...props.refs]
  const cur = countOf(type)
  // 组内超限 → toast (按钮已禁用时理论走不到, 防御提交链外的越界调用)
  if (type === 'image' && cur >= LIMIT_IMAGE) {
    toast(t('generate.error.minimax_h3_refs_images_too_many', { limit: LIMIT_IMAGE, current: cur }), 'warning')
    return
  }
  if (type === 'video' && cur >= LIMIT_VIDEO) {
    toast(t('generate.error.minimax_h3_refs_videos_too_many', { limit: LIMIT_VIDEO, current: cur }), 'warning')
    return
  }
  if (type === 'audio' && cur >= LIMIT_AUDIO) {
    toast(t('generate.error.minimax_h3_refs_audios_too_many', { limit: LIMIT_AUDIO, current: cur }), 'warning')
    return
  }
  if (refs.length >= LIMIT_TOTAL) {
    toast(t('generate.error.minimax_h3_refs_total_too_many', { limit: LIMIT_TOTAL, current: refs.length }), 'warning')
    return
  }
  refs.push({ type, name })
  emit('update:refs', refs)
}

function removeRef(index: number) {
  const refs = [...props.refs]
  refs.splice(index, 1)
  emit('update:refs', refs)
}

// ── 上传实现: POST /api/generate/upload_image (file + type='h3_ref') ──
async function uploadRef(type: RefItem['type'], file: File) {
  const form = new FormData()
  form.append('file', file)
  form.append('type', 'h3_ref')
  let body: (ApiErrorBody & { filename?: string }) | null = null
  try {
    const res = await fetch('/api/generate/upload_image', { method: 'POST', body: form })
    body = await res.json().catch(() => null)
    if (!res.ok || !body?.filename) {
      toast(apiErrorText(body, `Upload failed (${res.status})`), 'error')
      return
    }
  } catch (e: unknown) {
    toast((e as Error | undefined)?.message || 'Upload failed', 'error')
    return
  }
  addRef(type, body.filename)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file && pendingType.value) {
    void uploadRef(pendingType.value, file)
  }
  if (input) input.value = ''
}

/** 打开文件对话框。accept 直接命令式写入 DOM input (等 Vue 异步渲染 :accept
 *  绑定会与 click 竞态 —— 对话框可能带着上一次的 accept 打开, 出现过
 *  "点视频上传却弹 mp3 过滤器" 的偶发。文件类型后端仍有白名单兜底, 这里
 *  只是让浏览器过滤提示正确。 */
function triggerUpload(type: RefItem['type']) {
  if (props.disabled) return
  pendingType.value = type
  const input = fileInputRef.value
  if (input) {
    input.accept = ACCEPT_MAP[type]
    input.click()
  }
}

// ── 图片 picker 接线 (复用 useRefImagePicker + RefImageModal, 与 ModelTab 同款) ──
function onPickImage(name: string) {
  addRef('image', name)
  imagePicker.close()
}
async function onImageUpload(file: File) {
  const result = await imagePicker.uploadFile(file)
  if (!result) return
  addRef('image', result.filename)
}

// ── 展示辅助 ──
function basename(n: string): string {
  return n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
}

function imagePreviewUrl(name: string): string {
  return `/api/generate/input_image_preview?name=${encodeURIComponent(name)}`
}

/** 按组索引编号 (1-based) — 与后端引用编号同口径 */
function refIndex(type: RefItem['type'], i: number): number {
  return props.refs.slice(0, i).filter(r => r.type === type).length + 1
}
</script>

<template>
  <div class="ref-media-panel">
    <!-- 标签行: 与 .model-tab__frame-lbl 同款小标题; 右端帮助按钮 → 用法说明 -->
    <p class="ref-media-panel__lbl">
      <span class="ref-media-panel__title">
        {{ t('generate.video.refs_title') }}
        <em class="ref-media-panel__count">{{ refs.length }}/{{ LIMIT_TOTAL }}</em>
      </span>
      <button
        type="button"
        class="ref-help-btn"
        :title="t('generate.video.refs_help')"
        @click="helpOpen = true"
      >
        <MsIcon name="help_outline" size="sm" color="none" />
      </button>
    </p>

    <!-- 素材块网格: 内部滚动, 不撑高容器 (核心约束) -->
    <div class="ref-media-panel__grid">
      <span v-if="!refs.length" class="ref-media-panel__empty">{{ t('generate.video.refs_empty') }}</span>
      <div
        v-for="(r, i) in refs"
        :key="'ref-' + i"
        class="ref-tile"
        :title="`${basename(r.name)} · <${TAG_NAME[r.type]} ${refIndex(r.type, i)}>`"
      >
        <img
          v-if="r.type === 'image'"
          class="ref-tile__thumb"
          :src="imagePreviewUrl(r.name)"
          :alt="basename(r.name)"
          loading="lazy"
        >
        <MsIcon
          v-else
          :name="r.type === 'video' ? 'movie' : 'music_note'"
          size="sm"
          color="none"
          class="ref-tile__icon"
        />
        <span class="ref-tile__num">{{ refIndex(r.type, i) }}</span>
        <button
          type="button"
          class="ref-tile__del"
          :title="t('common.delete')"
          :disabled="disabled"
          @click="removeRef(i)"
        >
          <MsIcon name="close" size="xxs" color="none" />
        </button>
      </div>
    </div>

    <!-- 添加行: 三个图标钮等分 (图=从输入目录选 / 视频·音频=上传), title 即文案 -->
    <div class="ref-media-panel__adds">
      <button
        type="button"
        class="ref-add-btn"
        :title="t('generate.video.refs_add_image')"
        :disabled="disabled || imgAddDisabled"
        @click="imagePicker.open()"
      >
        <MsIcon name="image" size="xs" color="none" class="ref-add-btn__icon" />
      </button>
      <button
        type="button"
        class="ref-add-btn"
        :title="t('generate.video.refs_add_video')"
        :disabled="disabled || vidAddDisabled"
        @click="triggerUpload('video')"
      >
        <MsIcon name="movie" size="xs" color="none" class="ref-add-btn__icon" />
      </button>
      <button
        type="button"
        class="ref-add-btn"
        :title="t('generate.video.refs_add_audio')"
        :disabled="disabled || audAddDisabled"
        @click="triggerUpload('audio')"
      >
        <MsIcon name="music_note" size="xs" color="none" class="ref-add-btn__icon" />
      </button>
    </div>

    <!-- 隐藏 file input (视频/音频共用, accept 在 triggerUpload 里命令式写入) -->
    <input
      ref="fileInputRef"
      type="file"
      style="display: none"
      @change="onFileChange"
    >

    <!-- 图片「从输入目录选择」模态 (与 ModelTab videoPicker 同款接线) -->
    <RefImageModal
      v-model="imagePicker.visible.value"
      :title="t('generate.video.refs_title')"
      icon="image"
      :images="imagePicker.images.value"
      :loading="imagePicker.loading.value"
      :uploading="imagePicker.uploading.value"
      :preview-url-fn="imagePicker.previewUrl"
      @select="onPickImage"
      @upload="onImageUpload"
    />

    <!-- 使用说明模态 — 内容依据 MiniMax 官方文档
         (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md / MiniMax-H3 README) -->
    <BaseModal v-model="helpOpen" :title="t('generate.video.refs_help')" icon="help_outline" size="md">
      <div class="ref-help">
        <div class="ref-help__sec">
          <div class="ref-help__title">{{ t('generate.video.refs_help_syntax_title') }}</div>
          <p class="ref-help__row">{{ t('generate.video.refs_help_syntax_a') }}</p>
          <p class="ref-help__row ref-help__code">{{ t('generate.video.refs_help_syntax_b') }}</p>
        </div>
        <div class="ref-help__sec">
          <div class="ref-help__title">{{ t('generate.video.refs_help_usage_title') }}</div>
          <p class="ref-help__row">{{ t('generate.video.refs_help_usage_a') }}</p>
          <p class="ref-help__row">{{ t('generate.video.refs_help_usage_b') }}</p>
        </div>
        <div class="ref-help__sec">
          <div class="ref-help__title">{{ t('generate.video.refs_help_limits_title') }}</div>
          <p class="ref-help__row">{{ t('generate.video.refs_help_limits_a') }}</p>
          <p class="ref-help__row">{{ t('generate.video.refs_help_limits_b') }}</p>
        </div>
        <div class="ref-help__sec">
          <div class="ref-help__title">{{ t('generate.video.refs_help_formats_title') }}</div>
          <p class="ref-help__row">{{ t('generate.video.refs_help_formats_a') }}</p>
          <p class="ref-help__row">{{ t('generate.video.refs_help_formats_b') }}</p>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
/* ── 面板根: 作为 .prompt-media 的直接子项, 填满媒体列且 min-height:0 ——
      列高由正/负文本框决定, 本面板的最小内容高度只有「标签行 + 添加行」,
      素材再多也只让网格内部滚动, 绝不反向撑高容器 (与 upload-zone 同一原理) ── */
.ref-media-panel {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* 标签行: 与 .model-tab__frame-lbl 同款; 右端帮助按钮 */
.ref-media-panel__lbl {
  flex-shrink: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}
.ref-media-panel__title {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.ref-media-panel__count {
  font-style: normal;
  font-size: .62rem;
  font-weight: 500;
  color: var(--t3);
}

/* 帮助按钮: 与 prompt-help-btn 同款 (18px 圆钮, hover 高亮) */
.ref-help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: color .15s, background .15s;
}
.ref-help-btn:hover {
  color: var(--ac);
  background: var(--bg3);
}

/* ── 使用说明模态 (与 prompt help 内容同款排版) ── */
.ref-help {
  font-size: .88rem;
  line-height: 1.7;
}
.ref-help__sec { margin-bottom: 14px; }
.ref-help__sec:last-child { margin-bottom: 0; }
.ref-help__title {
  font-weight: 600;
  color: var(--t1);
  margin-bottom: 6px;
}
.ref-help__row {
  margin: 0 0 6px;
  color: var(--t2);
}
.ref-help__row:last-child { margin-bottom: 0; }
.ref-help__code {
  font-family: monospace;
  font-size: .84rem;
  background: var(--bg3);
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--t2);
}

/* ── 素材块网格: 3 列 40px tile, 溢出纵向滚动 (滚动条隐藏, 与 prompt-toolbar 同款) ── */
.ref-media-panel__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
  scrollbar-width: none;
}
.ref-media-panel__grid::-webkit-scrollbar { display: none; }

.ref-media-panel__empty {
  align-self: center;
  margin: auto;
  padding: var(--sp-2) 0;
  font-size: .68rem;
  line-height: 1.5;
  text-align: center;
  color: var(--t3);
}

/* ── 素材块: 40px 方形 tile ── */
.ref-tile {
  position: relative;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.ref-tile__thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ref-tile__icon { color: var(--t3); }

/* 引用编号角标 (右下) */
.ref-tile__num {
  position: absolute;
  right: 1px;
  bottom: 1px;
  min-width: 10px;
  padding: 0 2px;
  font-size: .5rem;
  line-height: 1.2;
  text-align: center;
  color: #fff;
  background: #000000a8;
  border-radius: 2px;
}

/* 删除 × (右上, 悬浮显现; 触屏常显) */
.ref-tile__del {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 14px;
  height: 14px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #000000a8;
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity .15s;
}
.ref-tile:hover .ref-tile__del { opacity: 1; }
@media (hover: none) {
  .ref-tile__del { opacity: 1; }
}
.ref-tile__del:disabled { cursor: not-allowed; }

/* ── 添加行: 三钮等分, 纯图标 (title 悬浮给文案), 与 prompt-tool-btn 同款质感 ── */
.ref-media-panel__adds {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
.ref-add-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--t2);
  font-family: inherit;
  cursor: pointer;
  transition: color .15s, background .15s;
}
.ref-add-btn__icon { color: var(--ac); }
.ref-add-btn:hover:not(:disabled) {
  color: var(--t1);
  background: var(--bg3);
}
.ref-add-btn:disabled {
  opacity: .3;
  cursor: not-allowed;
}

/* 移动端: 媒体列变全宽横带且高度 auto, 网格须显式限高, 否则失去 flex 约束会撑高 */
@media (max-width: 600px) {
  .ref-media-panel__grid { max-height: 160px; }
}
</style>
