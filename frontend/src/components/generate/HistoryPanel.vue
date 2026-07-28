<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateQueueStore } from '@/stores/generateQueue'
import type { ComfyHistoryItem } from '@/types/comfyui'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'

defineOptions({ name: 'HistoryPanel' })

// 历史产物条目 — 后端已把节点层 animated 归一下放到每个 image 条目 (标量布尔)
// 前端扩展类型以读取该字段 (扩展名兜底覆盖字段缺失的老节点)。
type HistoryImage = {
  filename: string
  subfolder: string
  type: string
  animated?: boolean
}

const { t } = useI18n({ useScope: 'global' })

const queueStore = useGenerateQueueStore()
const historyItems = computed(() => queueStore.historyItems)
const historySortAsc = computed({
  get: () => queueStore.historySortAsc,
  set: (v: boolean) => { queueStore.historySortAsc = v },
})

const cardSize = ref<'sm' | 'md' | 'lg'>('md')

// emit('makeVideo', item) — 带上产物定位信息, 由 GeneratePage 接线跳转
//  payload 结构见文件末尾注释
const emit = defineEmits<{
  makeVideo: [payload: {
    filename: string
    subfolder: string
    type: string
    prompt_id: string
    animated: boolean
  }]
}>()

// Image preview
const previewOpen = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)

const sortedHistory = computed(() => historyItems.value)

// ── 媒体判定 ──
// 视频扩展名兜底 (animated 字段缺失时的老节点覆盖)
// 与 useGeneratePreview / GeneratePage / 后端兜底集保持一致 —— 不一致会导致
// 同一个产物在预览区判为视频、在历史里判为图像 (走错缩略图端点且显示「生成视频」按钮)。
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi']
function hasVideoExt(filename: string): boolean {
  const i = filename.toLowerCase().lastIndexOf('.')
  if (i < 0) return false
  return VIDEO_EXTS.includes(filename.slice(i))
}
/** 媒体判定: 优先读条目上的 animated 标量布尔, 扩展名兜底 (.mp4/.webm/.mov) */
function isVideo(img: HistoryImage): boolean {
  if (typeof img.animated === 'boolean') return img.animated
  return hasVideoExt(img.filename)
}

// ── 视频时长角标 (右下胶囊 ▶ 时长) ──
// 时长由隐藏 <video preload="metadata"> 的 loadedmetadata 事件按需获取, 拿不到就只显 ▶
const durationMap = ref<Record<string, number>>({})
function durKey(img: HistoryImage): string {
  return `${img.type}|${img.subfolder}|${img.filename}`
}
function setDuration(img: HistoryImage, e: Event) {
  const v = e.target as HTMLVideoElement
  const d = v.duration
  if (Number.isFinite(d) && d > 0) durationMap.value[durKey(img)] = d
}
function fmtDuration(d: number): string {
  if (d >= 60) {
    const m = Math.floor(d / 60)
    const s = Math.round(d % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return `${d.toFixed(d < 10 ? 1 : 0)}s`
}

// ── 渲染分页: 首屏 30 条, 哨兵 IntersectionObserver 触发追加 30 ──
const PAGE_SIZE = 30
const visibleCount = ref(PAGE_SIZE)
const visibleHistory = computed(() => sortedHistory.value.slice(0, visibleCount.value))
const sentinelRef = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

function resetPageWindow() {
  visibleCount.value = PAGE_SIZE
}

function loadMore() {
  if (visibleCount.value >= sortedHistory.value.length) return
  visibleCount.value = Math.min(
    visibleCount.value + PAGE_SIZE,
    sortedHistory.value.length,
  )
  // 追加后若哨兵仍在视口内, 下一帧再次检查 (确保一次滚动填满视口)
  nextTick(() => reobserve())
}

function reobserve() {
  if (!io || !sentinelRef.value) return
  io.disconnect()
  io.observe(sentinelRef.value)
}

function setupObserver() {
  if (io) io.disconnect()
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) loadMore()
    }
  })
  if (sentinelRef.value) io.observe(sentinelRef.value)
}

onMounted(() => {
  // 抽屉首开挂载 — 从 store 取数 (未加载或 dirty 则拉取)
  if (!queueStore.historyLoaded || queueStore.historyDirty) {
    queueStore.loadHistory()
  } else {
    // 已加载但首次挂载: 仍需建立哨兵观察
    nextTick(() => setupObserver())
  }
})

// 数据到达时哨兵 DOM 才出现 — 需重新观察
watch(() => queueStore.historyItems.length, () => {
  nextTick(() => reobserve())
})

onBeforeUnmount(() => {
  if (io) { io.disconnect(); io = null }
})

function onSortChange() {
  resetPageWindow()
  queueStore.loadHistory()
  nextTick(() => reobserve())
}

/** 缩略图 URL — 带 preview=webp;80 转码 */
function thumbUrl(img: { filename: string; subfolder: string; type: string }) {
  return `/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}&preview=webp;80`
}

/** 视频首帧缩略图 URL — 走首帧端点 (?preview=webp;80 对 mp4 无效) */
function videoThumbUrl(img: { filename: string; subfolder: string; type: string }) {
  return `/api/comfyui/video_thumb?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
}

/** 大图 URL — 不带 preview */
function fullUrl(img: { filename: string; subfolder: string; type: string }) {
  return `/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
}

/** 卡片缩略图 URL — 按媒体类型分流 (视频走首帧端点, 图像保持原 webp 预览) */
function cardThumbUrl(img: HistoryImage): string {
  return isVideo(img) ? videoThumbUrl(img) : thumbUrl(img)
}

/** Collect all image URLs across all history items for navigation (full-res) */
function allImageUrls(): string[] {
  const urls: string[] = []
  for (const item of sortedHistory.value) {
    for (const img of item.images || []) {
      urls.push(fullUrl(img))
    }
  }
  return urls
}

function openPreview(item: ComfyHistoryItem, imgIndex: number) {
  const urls = allImageUrls()
  let globalIdx = 0
  for (const h of sortedHistory.value) {
    if (h.prompt_id === item.prompt_id) {
      globalIdx += imgIndex
      break
    }
    globalIdx += (h.images?.length || 0)
  }
  previewImages.value = urls
  previewIndex.value = globalIdx
  previewOpen.value = true
}

function downloadImage(filename: string, subfolder: string, type: string) {
  const url = fullUrl({ filename, subfolder, type })
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

function downloadAll(images: ComfyHistoryItem['images']) {
  if (!images) return
  images.forEach((img, i) =>
    setTimeout(() => downloadImage(img.filename, img.subfolder || '', img.type || 'output'), i * 200),
  )
}

/**
 * 「生成视频」入口 — 仅 emit, 不实现跳转。
 * payload 携带该产物定位信息 (filename/subfolder/type) + 所属 prompt_id + 媒体标志。
 */
function onMakeVideo(img: HistoryImage, item: ComfyHistoryItem) {
  emit('makeVideo', {
    filename: img.filename,
    subfolder: img.subfolder,
    type: img.type,
    prompt_id: item.prompt_id,
    animated: isVideo(img),
  })
}

// 暴露给模板通过 ref 调用 setupObserver (哨兵 ref 挂载后)
defineExpose({ setupObserver })
</script>

<template>
  <CollapsibleGroup
    icon="history"
    :title="t('comfyui.history.total')"
    :default-open="true"
  >
    <SectionToolbar class="history-toolbar">
      <template #start>
        <span class="history-count">
          {{ historyItems.length > 0 ? t('comfyui.history.record_count', { count: historyItems.length }) : '' }}
        </span>
      </template>
      <template #end>
        <BaseSelect
          v-model="historySortAsc"
          :options="[
            { value: false, label: t('comfyui.history.sort_desc') },
            { value: true, label: t('comfyui.history.sort_asc') },
          ]"
          size="sm"
          @change="onSortChange"
          class="history-select"
        />
        <BaseSelect
          v-model="cardSize"
          :options="[
            { value: 'sm', label: t('comfyui.history.size_sm') },
            { value: 'md', label: t('comfyui.history.size_md') },
            { value: 'lg', label: t('comfyui.history.size_lg') },
          ]"
          size="sm"
          class="history-select"
        />
      </template>
    </SectionToolbar>

    <EmptyState
      v-if="historyItems.length === 0"
      icon="history"
      :message="t('comfyui.history.no_records')"
    />

    <div v-else :class="['history-grid', 'size-' + cardSize]">
      <div v-for="item in visibleHistory" :key="item.prompt_id" class="history-card">
        <!-- Images -->
        <div v-if="item.images?.length" class="history-card-images">
          <div
            v-for="(img, imgIdx) in (item.images as HistoryImage[])"
            :key="img.filename"
            :class="['history-thumb', isVideo(img) ? 'history-thumb--video' : 'history-thumb--image']"
            @click="openPreview(item, imgIdx)"
          >
            <img
              :src="cardThumbUrl(img)"
              loading="lazy"
              alt=""
            >
            <!-- 视频角标: ▶ 时长; 时长由隐藏 <video> 抽取, 拿不到只显 ▶ -->
            <span
              v-if="isVideo(img)"
              class="history-thumb-dur"
            >▶<template v-if="durationMap[durKey(img)] != null">{{ ' ' + fmtDuration(durationMap[durKey(img)]) }}</template></span>
            <!-- 视频时长抽取: preload="metadata" 只取头部, @loadedmetadata 写入时长 Map -->
            <video
              v-if="isVideo(img)"
              class="history-thumb-probe"
              preload="metadata"
              muted
              :src="fullUrl(img)"
              @loadedmetadata="setDuration(img, $event)"
            ></video>
            <!-- 生成视频入口: 仅图像卡 hover 时显示 -->
            <button
              v-else
              class="history-thumb-make"
              :title="t('generate.history.make_video')"
              @click.stop="onMakeVideo(img, item)"
            >{{ t('generate.history.make_video') }}</button>
          </div>
        </div>
        <div v-else class="history-card-images empty">
          {{ t('comfyui.history.no_preview') }}
        </div>

        <!-- Info -->
        <div class="history-card-info">
          <span class="history-card-filename text-truncate" :title="item.images?.[0]?.filename">
            {{ item.images?.[0]?.filename || item.prompt_id.substring(0, 8) + '…' }}
          </span>
          <BaseButton v-if="item.images?.length" size="xs" square :title="t('common.btn.download')" @click="downloadAll(item.images)">
            <MsIcon name="download" size="xs" color="none" />
          </BaseButton>
        </div>
      </div>
      <!-- 渲染分页哨兵: 进入视口 → 追加 30 条 -->
      <div ref="sentinelRef" class="history-sentinel" aria-hidden="true"></div>
    </div>
  </CollapsibleGroup>

  <!-- Image Preview Overlay -->
  <ImagePreview
    v-model="previewOpen"
    :images="previewImages"
    :initial-index="previewIndex"
  />
</template>

<style scoped>
.history-count {
  font-size: .82rem;
  color: var(--t3);
}

.history-toolbar {
  margin-bottom: 14px;
}

.history-select {
  width: auto;
  min-width: 100px;
}

/* ── Grid ── */
.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.history-grid.size-sm {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
}
.history-grid.size-sm .history-card-info { padding: 3px 6px; }
.history-grid.size-lg {
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.history-grid.size-lg .history-card-info { padding: 6px 10px; }

/* ── Card ── */
.history-card {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
  aspect-ratio: 3 / 4;
  display: flex;
  flex-direction: column;
}

/* ── Image gallery ── */
.history-card-images {
  display: flex;
  gap: 2px;
  background: var(--bg);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
/* 每个产物单元格: 相对定位承载角标与 hover 按钮 */
.history-thumb {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  cursor: pointer;
  overflow: hidden;
}
.history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.history-card-images.empty {
  align-items: center;
  justify-content: center;
  color: var(--t3);
  font-size: .78rem;
}

/* ── 视频角标 (▶ 时长): 右下角半透明黑底胶囊 ── */
.history-thumb-dur {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 7px;
  background: rgba(0, 0, 0, .6);
  border-radius: 999px;
  font-size: .62rem;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  color: #fff;
  line-height: 1.4;
  pointer-events: none;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .5);
}

/* 视频时长抽取 <video> (隐藏, 仅用于 preload="metadata" 取时长) */
.history-thumb-probe {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* ── 生成视频入口: 图像卡 hover 时显示的胶囊按钮 ── */
.history-thumb-make {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translate(-50%, 50%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 12px;
  background: rgba(10, 10, 15, .82);
  border: 1px solid var(--ac);
  color: #fff;
  font-size: .7rem;
  font-weight: 500;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s, transform .15s;
  z-index: 2;
}
/* hover 时: 底部渐变遮罩 + 显按钮 — 图像卡专属 (视频卡无此按钮) */
.history-thumb--image:hover::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 45%;
  background: linear-gradient(to top, rgba(10, 10, 15, .7), transparent);
  pointer-events: none;
  z-index: 1;
}
.history-thumb:hover .history-thumb-make {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, -22%);
}
.history-thumb-make:hover {
  background: rgba(10, 10, 15, .95);
  border-color: var(--ac2);
}

/* ── Info row ── */
.history-card-info {
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.history-card-filename {
  flex: 1;
  font-size: var(--text-xs);
  color: var(--t2);
  min-width: 0;
}

/* 渲染分页哨兵: 占据网格末尾一行的占位, 进入视口触发追加 */
.history-sentinel {
  grid-column: 1 / -1;
  height: 1px;
  min-height: 1px;
}
</style>
