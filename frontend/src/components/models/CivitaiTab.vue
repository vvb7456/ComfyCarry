<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCivitaiSearch, type SortKey } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
import SearchInput from '@/components/ui/SearchInput.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import ChipSelect from '@/components/ui/ChipSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import CivitaiModelCard from '@/components/models/CivitaiModelCard.vue'
import VersionPickerModal from '@/components/models/VersionPickerModal.vue'
import type { ModelMeta, ModelMetaImage } from '@/types/models'
import type { CivitaiHit, CivitaiImage } from '@/composables/useCivitaiSearch'

defineOptions({ name: 'CivitaiTab' })

const props = defineProps<{ active: boolean }>()

const emit = defineEmits<{
  openMeta: [meta: ModelMeta]
  openPreview: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })

// ── Downloads (singleton) ──
const {
  cartItems: dlCartItems,
  addToCart: dlAddToCart,
  removeFromCart: dlRemoveFromCart,
  isInCart: dlIsInCart,
  downloadingModelIds: dlDownloadingIds,
  downloadOne: dlDownloadOne,
  localCivitaiIds: dlLocalIds,
  fetchLocalIndex: dlFetchLocalIndex,
} = useDownloads()

// ── CivitAI Search ──
const civitaiSort = ref<SortKey>('Relevancy')
const {
  hits: civitaiHits,
  loading: civitaiLoading,
  totalHits: civitaiTotalHits,
  hasMore: civitaiHasMore,
  errorMsg: civitaiError,
  typeFacets,
  baseModelFacets,
  selectedTypes,
  selectedBaseModels,
  facetsLoaded,
  search: civitaiSearch,
  loadMore: civitaiLoadMore,
  activate: civitaiActivate,
} = useCivitaiSearch(civitaiSort)

// Auto-activate when tab becomes visible
watch(() => props.active, (val) => {
  if (val) {
    civitaiActivate()
    dlFetchLocalIndex()
  }
}, { immediate: true })

// ── Version picker ──
const vpOpen = ref(false)
const vpHit = ref<CivitaiHit | null>(null)

// ── Infinite scroll sentinel ──
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

watch(sentinelRef, (el) => {
  observer?.disconnect()
  if (!el) return
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && civitaiHasMore.value && !civitaiLoading.value) {
      civitaiLoadMore()
    }
  }, { rootMargin: '200px' })
  observer.observe(el)
})

// ── Cart helpers ──
function hitToCartItem(hit: CivitaiHit) {
  const CDN = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'
  const imgs = hit.images?.length ? hit.images : (hit.version?.images || [])
  const rawUrl = imgs[0]?.url || ''
  const imageUrl = rawUrl.startsWith('http') ? rawUrl : rawUrl ? `${CDN}${rawUrl}/width=200/default.jpg` : ''
  const v = hit.version
  const allVersions = hit.versions?.map(ver => ({ id: ver.id, name: ver.name, baseModel: ver.baseModel }))
  return {
    modelId: String(hit.id),
    name: hit.name,
    type: hit.type,
    imageUrl,
    versionId: v?.id,
    versionName: v?.name,
    baseModel: v?.baseModel,
    allVersions,
  }
}

function toggleCart(hit: CivitaiHit) {
  if (dlIsInCart(hit.id)) {
    for (const item of dlCartItems.value) {
      if (item.modelId === String(hit.id)) {
        const key = item.versionId ? `${item.modelId}:${item.versionId}` : item.modelId
        dlRemoveFromCart(key)
      }
    }
  } else {
    dlAddToCart(hitToCartItem(hit))
  }
}

function getDownloadState(hit: CivitaiHit): string {
  if (dlDownloadingIds.value.has(String(hit.id))) return 'downloading'
  const localVersions = dlLocalIds.value.get(String(hit.id))
  if (localVersions && localVersions.size > 0) {
    const allVersions = hit.versions || (hit.version ? [hit.version] : [])
    if (allVersions.length > 0 && allVersions.every(v => localVersions.has(String(v.id)))) {
      return 'local'
    }
    return 'partial'
  }
  return 'idle'
}

/** Handle download click — single version direct, multi version opens picker */
function handleDownload(hit: CivitaiHit) {
  const allVersions = hit.versions || (hit.version ? [hit.version] : [])
  if (allVersions.length > 1) {
    vpHit.value = hit
    vpOpen.value = true
  } else {
    // Single version: download directly
    const versionId = hit.version?.id
    dlDownloadOne(String(hit.id), (hit.type || 'Checkpoint').toLowerCase(), versionId)
  }
}

/** Handle download from version picker */
function handlePickerDownload(modelId: string, modelType: string, versionId: number) {
  dlDownloadOne(modelId, modelType, versionId)
}

// ── CivitAI → MetaModal ──
function convertImages(imgs: CivitaiImage[]): ModelMetaImage[] {
  const out: ModelMetaImage[] = []
  for (const img of imgs) {
    if (!img.url) continue
    const url = img.url.startsWith('http')
      ? img.url
      : `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${img.url}/default.jpg`
    const m = img.meta
    out.push({
      url,
      type: img.type,
      ...(m && {
        seed: m.seed,
        steps: m.steps,
        cfg: m.cfgScale,
        sampler: m.sampler,
        positive: m.prompt,
        negative: m.negativePrompt,
      }),
    })
  }
  return out
}

function normalizeWords(words?: (string | { word: string })[]): string[] {
  if (!words?.length) return []
  return words.map(w => typeof w === 'string' ? w : w.word).filter(Boolean)
}

function civitaiToMeta(h: CivitaiHit): ModelMeta {
  const allImgs = h.images?.length ? h.images : (h.version?.images || [])
  return {
    name: h.name || 'Unknown',
    type: h.type,
    baseModel: h.version?.baseModel,
    id: h.id,
    versionId: h.version?.id,
    versionName: h.version?.name,
    author: h.user?.username,
    civitaiUrl: `https://civitai.com/models/${h.id}`,
    stats: {
      downloads: h.metrics?.downloadCount,
      likes: h.metrics?.thumbsUpCount,
    },
    trainedWords: normalizeWords(h.version?.trainedWords),
    images: convertImages(allImgs),
    versions: (h.versions || []).map(v => ({
      id: v.id,
      name: v.name,
      baseModel: v.baseModel,
      images: convertImages(v.images || []),
      trainedWords: normalizeWords(v.trainedWords),
      hashes: v.hashes,
    })),
  }
}

function openCivitaiMeta(hit: CivitaiHit) {
  emit('openMeta', civitaiToMeta(hit))
}
</script>

<template>
  <SearchInput
    :placeholder="t('models.civitai.search_placeholder')"
    full
    :loading="civitaiLoading"
    style="margin-bottom: 12px"
    @search="civitaiSearch"
  >
    <template #inline>
      <BaseSelect
        :options="[
          { value: 'Relevancy', label: t('models.civitai.sort.relevance') },
          { value: 'Most Downloaded', label: t('models.civitai.sort.downloads') },
          { value: 'Highest Rated', label: t('models.civitai.sort.rating') },
          { value: 'Newest', label: t('models.civitai.sort.newest') },
        ]"
        v-model="civitaiSort"
        size="sm"
        fit
        teleport
        class="civitai-sort-inline"
      />
    </template>
  </SearchInput>

  <!-- Facet Filters -->
  <div class="civitai-filters">
    <div class="civitai-filter-group">
      <div class="civitai-filter-label">{{ t('models.civitai.filter_type') }}</div>
      <ChipSelect
        v-model="selectedTypes"
        :options="typeFacets"
        :loading="!facetsLoaded"
        multiple
        :all-option="t('common.btn.all', '全部')"
        :collapsed-rows="1"
      />
    </div>
    <div class="civitai-filter-group">
      <div class="civitai-filter-label">{{ t('models.civitai.filter_base_model') }}</div>
      <ChipSelect
        v-model="selectedBaseModels"
        :options="baseModelFacets"
        :loading="!facetsLoaded"
        multiple
        :all-option="t('common.btn.all', '全部')"
        :collapsed-rows="1"
      />
    </div>
  </div>

  <!-- Result count -->
  <div v-if="civitaiTotalHits > 0" class="civitai-result-count">
    {{ t('models.civitai.total_results', { count: civitaiTotalHits.toLocaleString() }) }}
  </div>

  <!-- Error -->
  <EmptyState v-if="civitaiError" icon="error" :message="civitaiError" />

  <!-- Loading (initial) -->
  <LoadingCenter v-else-if="civitaiLoading && civitaiHits.length === 0" />

  <!-- Card Grid -->
  <div v-else-if="civitaiHits.length > 0" class="model-grid">
    <CivitaiModelCard
      v-for="hit in civitaiHits"
      :key="hit.id"
      :hit="hit"
      :in-cart="dlIsInCart(hit.id)"
      :download-state="getDownloadState(hit)"
      @details="openCivitaiMeta"
      @toggle-cart="toggleCart"
      @download="handleDownload"
      @preview="(url: string) => emit('openPreview', url)"
    />
  </div>

  <!-- Empty after search -->
  <EmptyState
    v-else-if="!civitaiLoading && civitaiTotalHits === 0 && facetsLoaded"
    icon="search_off"
    :message="t('models.civitai.no_results')"
  />

  <!-- Infinite scroll sentinel -->
  <div
    v-if="civitaiHits.length > 0 && civitaiHasMore"
    ref="sentinelRef"
    class="civitai-sentinel"
  >
    <LoadingCenter v-if="civitaiLoading" />
  </div>

  <!-- Version Picker Modal -->
  <VersionPickerModal
    v-model="vpOpen"
    :hit="vpHit"
    @download="handlePickerDownload"
  />
</template>

<style scoped>
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(280px, 22vw, 380px), 1fr));
  gap: clamp(14px, 1.2vw, 22px);
}

/* ── CivitAI Sort Inline ── */
.civitai-sort-inline {
  flex-shrink: 0;
  min-width: 85px !important;
  width: auto !important;
}

.civitai-sort-inline :deep(.base-select__trigger) {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 2px 4px;
  min-height: unset;
  font-size: .75rem;
  gap: 1px;
}

.civitai-sort-inline :deep(.base-select__trigger .ms) {
  font-size: 16px;
}

/* ── CivitAI Facet Filters ── */
.civitai-filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.civitai-filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.civitai-filter-label {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--t3);
  padding-left: 2px;
}

.civitai-result-count {
  font-size: var(--text-xs);
  color: var(--t3);
  margin-bottom: 12px;
}

.civitai-sentinel {
  padding: 24px 0;
  min-height: 60px;
}
</style>
