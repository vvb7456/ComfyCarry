<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloads } from '@/composables/useDownloads'
import CivitaiModelCard from '@/components/models/CivitaiModelCard.vue'
import VersionPickerModal from '@/components/models/VersionPickerModal.vue'
import FavoriteVersionModal from '@/components/models/FavoriteVersionModal.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { ModelMeta } from '@/types/models'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { HUGGINGFACE_MODELS } from '@/config/huggingface-models'
import { remoteHitToMeta } from '@/utils/remote-model-meta'

defineOptions({ name: 'HuggingFaceTab' })

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

// ── 激活时同步本地索引与下载状态 ──
// 卡片要展示已安装与下载进度, 需要本地模型索引和任务快照。与 CivitaiTab 的做法一致。
watch(() => props.active, (val) => {
  if (val) {
    dlFetchLocalIndex()
    // 连接到进行中的下载, 保证卡片状态准确
    dlRefreshStatus().then(() => {
      if (dlActiveTasks.value.length) dlStartPolling()
    })
  }
}, { immediate: true })

// ── 搜索 / 筛选 ──────────────────────────────────────────────────────────────
// 白名单是本地静态数据, 无需请求远端; 搜索/筛选全部本地完成。
const searchQuery = ref('')
const selectedTypes = ref<string[]>([])
const selectedBaseModels = ref<string[]>([])

/** facet 元素: 值 → 计数 */
interface Facet { value: string; count: number }

/** facet → BaseSelect 选项; count 走 hint 显示在右侧小字。label 直接用原值。 */
function facetOptions(facets: ComputedRef<Facet[]>) {
  return computed(() => facets.value.map(f => ({
    value: f.value,
    label: f.value,
    hint: f.count.toLocaleString(),
  })))
}

/** 一个模型可能有多版本不同 baseModel, 取并集 */
function modelBaseModels(model: (typeof HUGGINGFACE_MODELS)[number]): string[] {
  const set = new Set<string>()
  if (model.version?.baseModel) set.add(model.version.baseModel)
  for (const v of model.versions || []) {
    if (v.baseModel) set.add(v.baseModel)
  }
  return [...set]
}

// 类型 / baseModel 分布 (值 → 计数)
const typeFacets = computed<Facet[]>(() => {
  const map = new Map<string, number>()
  for (const m of HUGGINGFACE_MODELS) {
    map.set(m.type, (map.get(m.type) ?? 0) + 1)
  }
  return [...map.entries()].map(([value, count]) => ({ value, count }))
})

const baseModelFacets = computed<Facet[]>(() => {
  const map = new Map<string, number>()
  for (const m of HUGGINGFACE_MODELS) {
    for (const bm of modelBaseModels(m)) {
      map.set(bm, (map.get(bm) ?? 0) + 1)
    }
  }
  return [...map.entries()].map(([value, count]) => ({ value, count }))
})

const typeOptions = facetOptions(typeFacets)
const baseModelOptions = facetOptions(baseModelFacets)

/**
 * 本地过滤: 名称子串 (不区分大小写) + 类型/baseModel 多选。
 * 任一多选为空表示不过滤该维度。
 */
const filteredModels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const hasType = selectedTypes.value.length > 0
  const hasBase = selectedBaseModels.value.length > 0
  return HUGGINGFACE_MODELS.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false
    if (hasType && !selectedTypes.value.includes(m.type)) return false
    if (hasBase) {
      const bms = modelBaseModels(m)
      if (!bms.some(bm => selectedBaseModels.value.includes(bm))) return false
    }
    return true
  })
})

// ── 增量渲染 (IntersectionObserver sentinel) ──────────────────────────────
const visibleCount = ref(60)
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const hasMore = computed(() => visibleCount.value < filteredModels.value.length)

watch(sentinelRef, (el) => {
  observer?.disconnect()
  if (!el) return
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && hasMore.value) {
      visibleCount.value += 60
    }
  }, { rootMargin: '200px' })
  observer.observe(el)
})

onBeforeUnmount(() => observer?.disconnect())

// 筛选条件变化时重置增量渲染起点
watch([searchQuery, selectedTypes, selectedBaseModels], () => {
  visibleCount.value = 60
})

// ── Version picker ──
// 与 CivitaiTab 一致用 CivitaiHit 承载弹窗数据;白名单条目在结构上兼容 CivitaiHit。
const vpOpen = ref(false)
const vpHit = ref<CivitaiHit | null>(null)
const favOpen = ref(false)
const favHit = ref<CivitaiHit | null>(null)

// ── Favorite helpers ──
function hitToFavoriteItem(hit: CivitaiHit) {
  const imgs = hit.images?.length ? hit.images : (hit.version?.images || [])
  // HF 图片 URL 已是绝对地址, 直接使用不拼 CivitAI CDN 前缀
  const imageUrl = imgs[0]?.url || ''
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
    source: 'huggingface',
  }
}

function toggleFavorite(hit: CivitaiHit) {
  if (dlIsInFavorites(hit.id)) {
    // 移除该模型全部版本的收藏
    for (const item of dlFavItems.value) {
      if (item.modelId === String(hit.id)) {
        const key = item.versionId ? `${item.modelId}:${item.versionId}` : item.modelId
        dlRemoveFavorite(key)
      }
    }
  } else {
    const allVersions = hit.versions || (hit.version ? [hit.version] : [])
    if (allVersions.length > 1) {
      // 多版本: 打开版本选择弹窗
      favHit.value = hit
      favOpen.value = true
    } else {
      // 单版本: 直接收藏
      dlAddFavorite(hitToFavoriteItem(hit))
    }
  }
}

function handleFavoriteVersion(modelId: string, versionId: number, versionName: string, baseModel?: string) {
  const hit = favHit.value
  if (!hit) return
  const imgs = hit.images?.length ? hit.images : (hit.version?.images || [])
  const imageUrl = imgs[0]?.url || ''
  dlAddFavorite({
    modelId,
    name: hit.name,
    type: hit.type,
    imageUrl,
    versionId,
    versionName,
    baseModel,
    source: 'huggingface',
  })
}

function handleUnfavoriteVersion(modelId: string, versionId: number) {
  dlRemoveFavorite(`${modelId}:${versionId}`)
}

// ── Download state & actions ──
function getDownloadState(hit: CivitaiHit): string {
  const allVersions = hit.versions || (hit.version ? [hit.version] : [])
  const versionIds = allVersions.map(v => v.id)
  return dlGetModelState(hit.id, versionIds)
}

/** 下载点击: 部分安装 / 多版本 → 打开版本选择; 单版本直接提交 (store 按负 ID 走 HF 通道) */
function handleDownload(hit: CivitaiHit) {
  const allVersions = hit.versions || (hit.version ? [hit.version] : [])
  const versionIds = allVersions.map(v => v.id)
  const aggState = dlGetModelState(hit.id, versionIds)
  if (aggState === 'partial' || allVersions.length > 1) {
    vpHit.value = hit
    vpOpen.value = true
  } else {
    const versionId = hit.version?.id
    dlDownloadOne(String(hit.id), (hit.type || 'Checkpoint').toLowerCase(), versionId)
  }
}

/** 版本选择弹窗里的下载 */
function handlePickerDownload(modelId: string, modelType: string, versionId: number) {
  dlDownloadOne(modelId, modelType, versionId)
}

// ── HuggingFace → MetaModal ──
function openModelMeta(hit: CivitaiHit) {
  emit('openMeta', remoteHitToMeta(hit, { channel: 'huggingface' }))
}
</script>

<template>
  <SectionToolbar>
    <template #start>
      <FilterInput
        v-model="searchQuery"
        :placeholder="t('models.local.filter_placeholder')"
      />
      <span v-if="filteredModels.length > 0" class="toolbar-status">
        {{ t('models.huggingface.total_results', { count: filteredModels.length.toLocaleString() }) }}
      </span>
    </template>
    <template #end>
      <BaseSelect
        v-model="selectedTypes"
        :options="typeOptions"
        :all-text="t('models.huggingface.all_types')"
        multiple
        size="sm"
        fit
        searchable
        teleport
        :search-placeholder="t('models.huggingface.filter_type')"
      />
      <BaseSelect
        v-model="selectedBaseModels"
        :options="baseModelOptions"
        :all-text="t('models.huggingface.all_base_models')"
        multiple
        size="sm"
        fit
        searchable
        teleport
        :search-placeholder="t('models.huggingface.filter_base_model')"
      />
    </template>
  </SectionToolbar>

  <!-- 卡片网格 (增量渲染前 visibleCount 张) -->
  <div v-if="filteredModels.length > 0" class="model-grid">
    <CivitaiModelCard
      v-for="model in filteredModels.slice(0, visibleCount)"
      :key="model.id"
      :hit="model"
      :is-favorite="dlIsInFavorites(model.id)"
      :download-state="getDownloadState(model)"
      @details="openModelMeta"
      @toggle-favorite="toggleFavorite"
      @download="handleDownload"
      @preview="(url: string) => emit('openPreview', url)"
    />
  </div>

  <!-- 空结果 -->
  <EmptyState v-else icon="search_off" :message="t('models.huggingface.empty')" />

  <!-- 无限滚动 sentinel -->
  <div
    v-if="filteredModels.length > 0 && hasMore"
    ref="sentinelRef"
    class="hf-sentinel"
  />

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

.hf-sentinel {
  padding: 24px 0;
  min-height: 60px;
}
</style>
