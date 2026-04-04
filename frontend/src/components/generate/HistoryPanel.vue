<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import type { ComfyHistoryItem, ComfyHistoryResponse } from '@/types/comfyui'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'

defineOptions({ name: 'HistoryPanel' })

const { t } = useI18n({ useScope: 'global' })
const { get } = useApiFetch()

const historyItems = ref<ComfyHistoryItem[]>([])
const sortAsc = ref(false)
const cardSize = ref<'sm' | 'md' | 'lg'>('md')

// Image preview
const previewOpen = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)

const sortedHistory = computed(() =>
  sortAsc.value ? [...historyItems.value].reverse() : historyItems.value,
)

async function loadHistory() {
  const d = await get<ComfyHistoryResponse>('/api/comfyui/history?max_items=200')
  if (!d) return
  const items = d.history || []
  historyItems.value = sortAsc.value ? [...items].reverse() : items
}

function imgUrl(img: { filename: string; subfolder: string; type: string }) {
  return `/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
}

/** Collect all image URLs across all history items for navigation */
function allImageUrls(): string[] {
  const urls: string[] = []
  for (const item of sortedHistory.value) {
    for (const img of item.images || []) {
      urls.push(imgUrl(img))
    }
  }
  return urls
}

function openPreview(item: ComfyHistoryItem, imgIndex: number) {
  const urls = allImageUrls()
  // Find the global index of this image
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
  const url = `/api/comfyui/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

function downloadAll(images: ComfyHistoryItem['images']) {
  if (!images) return
  images.forEach((img, i) =>
    setTimeout(() => downloadImage(img.filename, img.subfolder || '', img.type || 'output'), i * 200),
  )
}

onMounted(loadHistory)

defineExpose({ loadHistory })
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
          v-model="sortAsc"
          :options="[
            { value: false, label: t('comfyui.history.sort_desc') },
            { value: true, label: t('comfyui.history.sort_asc') },
          ]"
          size="sm"
          @change="loadHistory"
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
      <div v-for="item in sortedHistory" :key="item.prompt_id" class="history-card">
        <!-- Images -->
        <div v-if="item.images?.length" class="history-card-images">
          <img
            v-for="(img, imgIdx) in item.images"
            :key="img.filename"
            :src="imgUrl(img)"
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
          <StatusDot :status="item.completed ? 'running' : 'error'" />
          <div class="history-card-meta">
            <div>{{ item.prompt_id.substring(0, 8) }}…</div>
            <div class="history-card-ts">
              {{ item.timestamp ? new Date(Number(item.timestamp)).toLocaleString('zh-CN') : '' }}
            </div>
          </div>
          <div v-if="item.images?.length" class="history-card-actions">
            <span v-if="item.images.length > 1" class="history-card-imgcount">
              {{ t('comfyui.history.image_count', { count: item.images.length }) }}
            </span>
            <BaseButton size="sm" square :title="t('common.btn.download')" @click="downloadAll(item.images)">
              <MsIcon name="download" color="none" />
            </BaseButton>
          </div>
        </div>
      </div>
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
.history-grid.size-sm .history-card-images { height: 90px; }
.history-grid.size-sm .history-card-info { padding: 6px 10px; }
.history-grid.size-sm .history-card-meta { font-size: .68rem; }
.history-grid.size-lg {
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.history-grid.size-lg .history-card-images { height: 220px; }
.history-grid.size-lg .history-card-info { padding: 14px 18px; }

/* ── Card ── */
.history-card {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
}

/* ── Image gallery ── */
.history-card-images {
  display: flex;
  gap: 2px;
  background: var(--bg);
  height: 140px;
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
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.history-card-meta {
  flex: 1;
  font-size: .78rem;
  color: var(--t2);
}
.history-card-ts {
  font-size: .7rem;
  color: var(--t3);
}
.history-card-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}
.history-card-imgcount {
  font-size: .68rem;
  color: var(--t3);
}
</style>
