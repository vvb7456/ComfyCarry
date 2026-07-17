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

const { t } = useI18n({ useScope: 'global' })

const queueStore = useGenerateQueueStore()
const historyItems = computed(() => queueStore.historyItems)
const historySortAsc = computed({
  get: () => queueStore.historySortAsc,
  set: (v: boolean) => { queueStore.historySortAsc = v },
})

const cardSize = ref<'sm' | 'md' | 'lg'>('md')

// Image preview
const previewOpen = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)

const sortedHistory = computed(() => historyItems.value)

// ── 渲染分页 (规格 E4): 首屏 30 条, 哨兵 IntersectionObserver 触发追加 30 ──
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
  // 抽屉首开挂载 (规格 E3) — 从 store 取数 (未加载或 dirty 则拉取)
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

/** 缩略图 URL — 带 preview=webp;80 转码 (规格 E5) */
function thumbUrl(img: { filename: string; subfolder: string; type: string }) {
  return `/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}&preview=webp;80`
}

/** 大图 URL — 不带 preview (规格 E5) */
function fullUrl(img: { filename: string; subfolder: string; type: string }) {
  return `/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
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
          <img
            v-for="(img, imgIdx) in item.images"
            :key="img.filename"
            :src="thumbUrl(img)"
            loading="lazy"
            alt=""
            @click="openPreview(item, imgIdx)"
          >
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
      <!-- 渲染分页哨兵 (规格 E4): 进入视口 → 追加 30 条 -->
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
.history-card-images img {
  flex: 1;
  min-width: 0;
  height: 100%;
  object-fit: cover;
  cursor: pointer;
}
.history-card-images.empty {
  align-items: center;
  justify-content: center;
  color: var(--t3);
  font-size: .78rem;
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

/* 渲染分页哨兵 (E4): 占据网格末尾一行的占位, 进入视口触发追加 */
.history-sentinel {
  grid-column: 1 / -1;
  height: 1px;
  min-height: 1px;
}
</style>
