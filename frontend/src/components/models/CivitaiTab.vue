<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCivitaiSearch, type SortKey } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
import SearchInput from '@/components/ui/SearchInput.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import CivitaiModelCard from '@/components/models/CivitaiModelCard.vue'
import VersionPickerModal from '@/components/models/VersionPickerModal.vue'
import FavoriteVersionModal from '@/components/models/FavoriteVersionModal.vue'
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

// ── 筛选器选项 ────────────────────────────────────────────────────────────
// selectedTypes / selectedBaseModels 本身就是 string[], BaseSelect 开 multiple
// 后直接双向绑定, 不需要适配层。
/** facet → BaseSelect 选项; count 走 hint 显示在右侧小字。 */
function facetOptions(facets: typeof typeFacets) {
  return computed(() => facets.value.map(f => ({
    value: f.value,
    label: f.label,
    hint: f.count.toLocaleString(),
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
  <SectionToolbar>
    <template #start>
      <SearchInput
        :placeholder="t('models.civitai.search_placeholder')"
        :loading="civitaiLoading"
        @search="civitaiSearch"
      />
      <span v-if="civitaiTotalHits > 0" class="toolbar-status">
        {{ t('models.civitai.total_results', { count: civitaiTotalHits.toLocaleString() }) }}
      </span>
    </template>
    <template #end>
      <BaseSelect
        v-model="selectedTypes"
        :options="typeOptions"
        :disabled="!facetsLoaded"
        :all-text="t('models.civitai.all_types')"
        multiple
        size="sm"
        fit
        searchable
        teleport
        :search-placeholder="t('models.civitai.filter_type')"
      />
      <BaseSelect
        v-model="selectedBaseModels"
        :options="baseModelOptions"
        :disabled="!facetsLoaded"
        :all-text="t('models.civitai.all_base_models')"
        multiple
        size="sm"
        fit
        searchable
        teleport
        :search-placeholder="t('models.civitai.filter_base_model')"
      />
      <BaseSelect
        v-model="civitaiSort"
        :options="sortOptions"
        size="sm"
        fit
        teleport
      />
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
</style>
