<script setup lang="ts">
import { computed, ref, watch, onDeactivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCivitaiSearch, type SortKey } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
import { useCivitaiSettings } from '@/composables/useCivitaiSettings'
import SearchInput from '@/components/ui/SearchInput.vue'
import AppToolbar from '@/components/ui/AppToolbar.vue'
import CivitaiFilterPopover from '@/components/models/CivitaiFilterPopover.vue'
import CivitaiSettingsModal from '@/components/models/CivitaiSettingsModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import CivitaiModelCard from '@/components/models/CivitaiModelCard.vue'
import VersionPickerModal from '@/components/models/VersionPickerModal.vue'
import FavoriteVersionModal from '@/components/models/FavoriteVersionModal.vue'
import type { ModelMeta } from '@/types/models'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { remoteHitToMeta } from '@/utils/remote-model-meta'
import { isCivitaiIdQuery } from '@/utils/constants'

defineOptions({ name: 'CivitaiTab' })

const props = defineProps<{
  active: boolean
  initialType?: string
  toolbarTarget?: HTMLElement | null
}>()

const emit = defineEmits<{
  openMeta: [meta: ModelMeta]
  openPreview: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })

// 搜索/下载强制要求 API Key: 未配置时本 tab 呈引导空态, 不发起任何请求。
const civitaiSettings = useCivitaiSettings()
const settingsOpen = ref(false)
const gateLoading = ref(true)

async function refreshSettings(): Promise<void> {
  gateLoading.value = true
  await civitaiSettings.load(true)
  gateLoading.value = false
}

/** key 未配置 → gate; 其余一切 (搜索/下载/收藏动作) 均以 key 已配置为前提 */
const needsKey = computed(() => !civitaiSettings.keySet.value)

const {
  favoritesItems: dlFavItems,
  addFavorite: dlAddFavorite,
  removeFavorite: dlRemoveFavorite,
  isInFavorites: dlIsInFavorites,
  getModelAggregateState: dlGetModelState,
  downloadOne: dlDownloadOne,
  refreshStatus: dlRefreshStatus,
  startPolling: dlStartPolling,
  activeTasks: dlActiveTasks,
} = useDownloads()

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
  blocking,
  search: civitaiSearch,
  loadMore: civitaiLoadMore,
  activate: civitaiActivate,
  applyFilters,
} = useCivitaiSearch(civitaiSort)

// selectedTypes / selectedBaseModels 本身就是 string[], ChipSelect 开 multiple
// 后直接双向绑定, 不需要适配层。
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

const exactQuery = computed(() => isCivitaiIdQuery(queryInput.value.trim()))

function handleSearch(query: string) {
  queryInput.value = query
  submitCurrentQuery()
}

function submitCurrentQuery() {
  if (blocking.value) return
  const query = queryInput.value.trim()
  if (!sortTouched.value) {
    if (!query) civitaiSort.value = 'Most Downloaded'
    else civitaiSort.value = 'Relevancy'
  }
  civitaiSearch(query)
}

function handleFilterApply(types: string[], baseModels: string[], sort: string) {
  if (sort !== civitaiSort.value) sortTouched.value = true
  civitaiSort.value = sort as SortKey
  applyFilters(types, baseModels)
  submitCurrentQuery()
}

let initialTypeApplied = false

function activateBrowsing() {
  // 外部跳转预选类型 (仅首次激活应用一次, 避免覆盖用户后续操作)
  if (props.initialType && !initialTypeApplied) {
    initialTypeApplied = true
    applyFilters([props.initialType], [])
  }
  civitaiActivate()
  // Connect to any in-flight downloads so card states are accurate
  dlRefreshStatus().then(() => {
    if (dlActiveTasks.value.length) dlStartPolling()
  })
}

async function onSettingsSaved() {
  await refreshSettings()
  if (!needsKey.value && props.active) activateBrowsing()
}

watch(() => props.active, (val) => {
  if (!val) return
  void refreshSettings().then(() => {
    if (!needsKey.value) activateBrowsing()
  })
}, { immediate: true })

const vpOpen = ref(false)
const vpHit = ref<CivitaiHit | null>(null)
const favOpen = ref(false)
const favHit = ref<CivitaiHit | null>(null)

const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

watch(sentinelRef, (el) => {
  observer?.disconnect()
  if (!el) return
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && civitaiHasMore.value && !civitaiLoading.value) {
      civitaiLoadMore()
    }
  }, { rootMargin: '200px' })
  observer.observe(el)
})

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
    for (const item of dlFavItems.value) {
      if (item.modelId === String(hit.id)) {
        const key = item.versionId ? `${item.modelId}:${item.versionId}` : item.modelId
        dlRemoveFavorite(key)
      }
    }
  } else {
    const allVersions = hit.versions || (hit.version ? [hit.version] : [])
    if (allVersions.length > 1) {
      favHit.value = hit
      favOpen.value = true
    } else {
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

// KeepAlive 下离开模型页走 onDeactivated 而非 onUnmounted: 关闭本 tab 自己的浮层
// (设置 / 版本选择 / 收藏版本), 其 body 滚动锁不会在失活时释放, 且状态被缓存后
// 切回还会重新出现。筛选弹层自身已 watch exactMode/blocked 关闭, 这里不重复。
onDeactivated(() => {
  settingsOpen.value = false
  vpOpen.value = false
  favOpen.value = false
})
</script>

<template>
  <!-- Gate: 搜索/下载强制要求 API Key, 未配置时呈引导空态 (工具栏与请求均不出现) -->
  <EmptyState
    v-if="active && needsKey && !gateLoading"
    icon="vpn_lock"
    :title="t('models.civitai.gate.title')"
    :message="t('models.civitai.gate.message')"
    class="civitai-gate"
  >
    <BaseButton variant="primary" @click="settingsOpen = true">
      <MsIcon name="settings" /> {{ t('models.civitai.settings.open_btn') }}
    </BaseButton>
  </EmptyState>

  <LoadingCenter v-else-if="active && gateLoading && needsKey" />

  <template v-else>
  <Teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget || !active">
    <AppToolbar search-full>
      <template #search>
        <SearchInput
          v-model="queryInput"
          :placeholder="t('models.civitai.search_placeholder')"
          :loading="civitaiLoading"
          :disabled="blocking"
          full
          @search="handleSearch"
        />
      </template>
      <template #actions>
        <CivitaiFilterPopover
          :types="selectedTypes"
          :base-models="selectedBaseModels"
          :type-options="typeOptions"
          :base-model-options="baseModelOptions"
          :sort="civitaiSort"
          :sort-options="sortOptions"
          :disabled="!facetsLoaded"
          :blocked="blocking"
          :exact-mode="exactQuery"
          @apply="handleFilterApply"
        />
        <BaseButton
          size="sm"
          :aria-label="t('models.civitai.settings.title')"
          @click="settingsOpen = true"
        >
          <MsIcon name="settings" />
          <span class="app-toolbar__label">{{ t('common.btn.settings') }}</span>
        </BaseButton>
      </template>
    </AppToolbar>
  </Teleport>

  <EmptyState v-if="civitaiError" icon="error_outline" :message="civitaiError" />

  <LoadingCenter v-else-if="civitaiLoading && civitaiHits.length === 0" />

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

  <EmptyState
    v-else-if="!civitaiLoading && civitaiTotalHits === 0 && facetsLoaded"
    icon="search_off"
    :message="t('models.civitai.no_results')"
  />

  <div
    v-if="civitaiHits.length > 0 && civitaiHasMore"
    ref="sentinelRef"
    class="civitai-sentinel"
  >
    <LoadingCenter v-if="civitaiLoading" />
  </div>

  <VersionPickerModal
    v-model="vpOpen"
    :hit="vpHit"
    @download="handlePickerDownload"
  />

  <FavoriteVersionModal
    v-model="favOpen"
    :hit="favHit"
    @favorite="handleFavoriteVersion"
    @unfavorite="handleUnfavoriteVersion"
  />
  </template>

  <!-- CivitAI 设置 (API Key + NSFW) -->
  <CivitaiSettingsModal v-model="settingsOpen" @saved="onSettingsSaved" />
</template>

<style scoped>
.model-grid {
  display: grid;
  /* 竖版 3:4 卡片: 桌面端大卡 (240–320px), 外层 min(…,100%) 保证窄容器 (手机+侧栏) 不撑破。 */
  grid-template-columns: repeat(auto-fill, minmax(min(clamp(240px, 18vw, 320px), 100%), 1fr));
  gap: clamp(14px, 1.2vw, 22px);
}

.civitai-sentinel {
  padding: 24px 0;
  min-height: 60px;
}

/* Key 引导空态 */
.civitai-gate {
  min-height: 320px;
}

</style>
