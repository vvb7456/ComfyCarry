<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCivitaiSearch, type SortKey } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
import SearchInput from '@/components/ui/SearchInput.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import CivitaiFilterPopover from '@/components/models/CivitaiFilterPopover.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import CivitaiModelCard from '@/components/models/CivitaiModelCard.vue'
import VersionPickerModal from '@/components/models/VersionPickerModal.vue'
import FavoriteVersionModal from '@/components/models/FavoriteVersionModal.vue'
import type { ModelMeta } from '@/types/models'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { remoteHitToMeta } from '@/utils/remote-model-meta'

defineOptions({ name: 'CivitaiTab' })

const props = defineProps<{ active: boolean }>()

const emit = defineEmits<{
  openMeta: [meta: ModelMeta]
  openPreview: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })

// ── Downloads (singleton) ──
const {
  favoritesItems: dlFavItems,
  addFavorite: dlAddFavorite,
  removeFavorite: dlRemoveFavorite,
  isInFavorites: dlIsInFavorites,
  getModelAggregateState: dlGetModelState,
  downloadOne: dlDownloadOne,
  fetchLocalIndex: dlFetchLocalIndex,
  refreshStatus: dlRefreshStatus,
  startPolling: dlStartPolling,
  activeTasks: dlActiveTasks,
} = useDownloads()

// ── CivitAI Search ──
// Empty-query browsing is ranked by downloads; text searches switch to relevance.
const civitaiSort = ref<SortKey>('Most Downloaded')
const queryInput = ref('')
const sortTouched = ref(false)
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
  applyFilters,
} = useCivitaiSearch(civitaiSort)

// ── 筛选器选项 ────────────────────────────────────────────────────────────
// selectedTypes / selectedBaseModels 本身就是 string[], ChipSelect 开 multiple
// 后直接双向绑定, 不需要适配层。
/** facet → ChipSelect 选项; count 作为 chip 右侧的小字。 */
function facetOptions(facets: typeof typeFacets) {
  return computed(() => facets.value.map(f => ({
    value: f.value,
    label: f.label,
    count: f.count,
  })))
}

const typeOptions = facetOptions(typeFacets)
const baseModelOptions = facetOptions(baseModelFacets)

const sortOptions = computed(() => [
  { value: 'Relevancy', label: t('models.civitai.sort.relevance') },
  { value: 'Most Downloaded', label: t('models.civitai.sort.downloads') },
  { value: 'Highest Rated', label: t('models.civitai.sort.rating') },
  { value: 'Newest', label: t('models.civitai.sort.newest') },
])

function isExactQuery(text: string): boolean {
  const parts = text.split(/[,\s\n]+/).filter(p => p.trim())
  return parts.length > 0 && parts.every(p =>
    /^\d+$/.test(p.trim()) || /civitai\.com\/models\/\d+/.test(p.trim()),
  )
}

const exactQuery = computed(() => isExactQuery(queryInput.value.trim()))

function handleSearch(query: string) {
  queryInput.value = query
  submitCurrentQuery()
}

function submitCurrentQuery() {
  const query = queryInput.value.trim()
  if (!sortTouched.value) {
    if (!query) civitaiSort.value = 'Most Downloaded'
    else civitaiSort.value = 'Relevancy'
  }
  civitaiSearch(query)
}

function handleFilterApply(types: string[], baseModels: string[]) {
  applyFilters(types, baseModels)
  submitCurrentQuery()
}

function handleSortChange() {
  sortTouched.value = true
  if (!exactQuery.value) civitaiSearch(queryInput.value.trim())
}

// Auto-activate when tab becomes visible
watch(() => props.active, (val) => {
  if (val) {
    civitaiActivate()
    dlFetchLocalIndex()
    // Connect to any in-flight downloads so card states are accurate
    dlRefreshStatus().then(() => {
      if (dlActiveTasks.value.length) dlStartPolling()
    })
  }
}, { immediate: true })

// ── Version picker ──
const vpOpen = ref(false)
const vpHit = ref<CivitaiHit | null>(null)
const favOpen = ref(false)
const favHit = ref<CivitaiHit | null>(null)

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

// ── Favorite helpers ──
function hitToFavoriteItem(hit: CivitaiHit) {
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

function toggleFavorite(hit: CivitaiHit) {
  if (dlIsInFavorites(hit.id)) {
    // Remove all versions of this model from favorites
    for (const item of dlFavItems.value) {
      if (item.modelId === String(hit.id)) {
        const key = item.versionId ? `${item.modelId}:${item.versionId}` : item.modelId
        dlRemoveFavorite(key)
      }
    }
  } else {
    const allVersions = hit.versions || (hit.version ? [hit.version] : [])
    if (allVersions.length > 1) {
      // Multi-version: open picker modal
      favHit.value = hit
      favOpen.value = true
    } else {
      // Single version: add directly
      dlAddFavorite(hitToFavoriteItem(hit))
    }
  }
}

function handleFavoriteVersion(modelId: string, versionId: number, versionName: string, baseModel?: string) {
  const hit = favHit.value
  if (!hit) return
  const CDN = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'
  const imgs = hit.images?.length ? hit.images : (hit.version?.images || [])
  const rawUrl = imgs[0]?.url || ''
  const imageUrl = rawUrl.startsWith('http') ? rawUrl : rawUrl ? `${CDN}${rawUrl}/width=200/default.jpg` : ''
  dlAddFavorite({
    modelId,
    name: hit.name,
    type: hit.type,
    imageUrl,
    versionId,
    versionName,
    baseModel,
  })
}

function handleUnfavoriteVersion(modelId: string, versionId: number) {
  dlRemoveFavorite(`${modelId}:${versionId}`)
}

function getDownloadState(hit: CivitaiHit): string {
  const allVersions = hit.versions || (hit.version ? [hit.version] : [])
  const versionIds = allVersions.map(v => v.id)
  return dlGetModelState(hit.id, versionIds)
}

/** Handle download click — partial / multi-version opens picker; single idle downloads directly */
function handleDownload(hit: CivitaiHit) {
  const allVersions = hit.versions || (hit.version ? [hit.version] : [])
  const versionIds = allVersions.map(v => v.id)
  const aggState = dlGetModelState(hit.id, versionIds)
  // partial aggregate → open VersionPickerModal so user picks uninstalled version
  if (aggState === 'partial' || allVersions.length > 1) {
    vpHit.value = hit
    vpOpen.value = true
  } else {
    // Single version (idle/downloading/installed): download directly
    const versionId = hit.version?.id
    dlDownloadOne(String(hit.id), (hit.type || 'Checkpoint').toLowerCase(), versionId)
  }
}

/** Handle download from version picker */
function handlePickerDownload(modelId: string, modelType: string, versionId: number) {
  dlDownloadOne(modelId, modelType, versionId)
}

// ── CivitAI → MetaModal ──
function openCivitaiMeta(hit: CivitaiHit) {
  emit('openMeta', remoteHitToMeta(hit))
}
</script>

<template>
  <SectionToolbar>
    <template #start>
      <SearchInput
        v-model="queryInput"
        :placeholder="t('models.civitai.search_placeholder')"
        :loading="civitaiLoading"
        full
        @search="handleSearch"
      />
      <CivitaiFilterPopover
        :types="selectedTypes"
        :base-models="selectedBaseModels"
        :type-options="typeOptions"
        :base-model-options="baseModelOptions"
        :disabled="!facetsLoaded"
        :exact-mode="exactQuery"
        @apply="handleFilterApply"
      />
      <BaseSelect
        class="civitai-sort"
        v-model="civitaiSort"
        :options="sortOptions"
        :disabled="exactQuery"
        size="sm"
        fit
        teleport
        @change="handleSortChange"
      />
      <span v-if="civitaiTotalHits > 0" class="toolbar-status">
        {{ t('models.civitai.total_results', { count: civitaiTotalHits.toLocaleString() }) }}
      </span>
    </template>
  </SectionToolbar>

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
      :is-favorite="dlIsInFavorites(hit.id)"
      :download-state="getDownloadState(hit)"
      @details="openCivitaiMeta"
      @toggle-favorite="toggleFavorite"
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

  <!-- Favorite Version Modal -->
  <FavoriteVersionModal
    v-model="favOpen"
    :hit="favHit"
    @favorite="handleFavoriteVersion"
    @unfavorite="handleUnfavoriteVersion"
  />
</template>

<style scoped>
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(280px, 22vw, 380px), 1fr));
  gap: clamp(14px, 1.2vw, 22px);
}

.civitai-sentinel {
  padding: 24px 0;
  min-height: 60px;
}

/* Remote search controls stay on one compact row; narrow screens scroll it. */
:deep(.section-toolbar) {
  flex-wrap: nowrap;
  overflow: visible;
}

:deep(.section-toolbar-start) {
  flex-wrap: nowrap;
  min-width: 0;
}

:deep(.section-toolbar-start .search-input) {
  min-width: 160px;
}

:deep(.section-toolbar-start .civitai-sort) {
  --ctl-w-sm: 128px;
  --ctl-w-md: 160px;
}

:deep(.section-toolbar-start .civitai-sort .base-select__trigger) {
  min-height: 34px;
}

:deep(.section-toolbar-start .toolbar-status) {
  flex: 0 0 auto;
}

@media (max-width: 720px) {
  :deep(.section-toolbar-start .search-input) {
    min-width: 80px;
  }

  :deep(.section-toolbar-start .civitai-sort) {
    --ctl-w-sm: 110px;
    --ctl-w-md: 120px;
  }

  :deep(.section-toolbar-start .toolbar-status) {
    display: none;
  }
}
</style>
