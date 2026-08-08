<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalModels } from '@/composables/useLocalModels'
import { useModelActions } from '@/composables/useModelActions'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import LocalModelCard from '@/components/models/LocalModelCard.vue'
import type { LocalModel } from '@/composables/useLocalModels'

defineOptions({ name: 'LocalModelsTab' })

const props = defineProps<{
  active?: boolean
}>()

const emit = defineEmits<{
  openLocal: [model: LocalModel]
  openPreview: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })

const {
  loading: localLoading,
  categoryFilter,
  folderFilter,
  textFilter,
  filteredModels,
  availableFolders,
  loadModels,
} = useLocalModels()

const { isFetching, fetchInfo, deleteModel, fetchAll, batchProgress } = useModelActions(loadModels)

const displayCount = computed(() => filteredModels.value.length)
const displayInfoCount = computed(() => filteredModels.value.filter(m => m.has_info).length)

// '默认' = 仅视觉资产 (组件过滤在 useLocalModels 按 category 白名单实现);
// '全部' 含功能组件, 置末位。
const categoryOptions = computed(() => [
  { value: 'default', label: t('models.local.default_types') },
  { value: 'checkpoints', label: t('models.local.checkpoints') },
  { value: 'loras', label: t('models.local.lora') },
  { value: 'controlnet', label: t('models.local.controlnet') },
  { value: 'vae', label: t('models.local.vae') },
  { value: 'upscale_models', label: t('models.local.upscale') },
  { value: 'embeddings', label: t('models.local.embeddings') },
  { value: 'all', label: t('models.local.all_types') },
])

const folderOptions = computed(() => [
  { value: '', label: t('models.local.all_folders') },
  ...availableFolders.value.map(f => ({ value: f, label: f })),
])

onMounted(() => {
  loadModels()
})

// 切回本 tab 时重新加载本地模型 —— 其他 tab (HF/Civitai) 下载完成后,
// 本列表不会自己知道; 上次挂载后下载的模型要靠这次刷新才能出现
// (v-show 常驻不重新挂载, 只靠 onMounted 会漏)。
watch(() => props.active, (val) => {
  if (val) loadModels()
})

function openMeta(m: LocalModel) {
  emit('openLocal', m)
}
</script>

<template>
  <SectionToolbar>
    <template #start>
      <FilterInput
        v-model="textFilter"
        :placeholder="t('models.local.filter_placeholder')"
      />
      <span class="toolbar-status">
        <template v-if="batchProgress.running">
          {{ t('models.local.fetching_progress', { current: batchProgress.current, total: batchProgress.total, filename: batchProgress.filename }) }}
        </template>
        <template v-else>
          {{ t('models.local.total_models', { count: displayCount, infoCount: displayInfoCount }) }}
        </template>
      </span>
    </template>
    <template #end>
      <BaseSelect
        v-model="categoryFilter"
        :options="categoryOptions"
        size="sm"
        fit
      />
      <BaseSelect
        v-model="folderFilter"
        :options="folderOptions"
        size="sm"
        fit
        :disabled="categoryFilter === 'all' || categoryFilter === 'default'"
      />
      <BaseButton size="sm" @click="loadModels">
        {{ t('models.local.refresh') }}
      </BaseButton>
      <BaseButton size="sm" variant="primary" @click="fetchAll(filteredModels)">
        {{ t('models.local.fetch_all') }}
      </BaseButton>
    </template>
  </SectionToolbar>

  <LoadingCenter v-if="localLoading" />

  <EmptyState
    v-else-if="filteredModels.length === 0"
    icon="inventory_2"
    :message="t('models.local.not_found_category')"
  />

  <div v-else class="model-grid">
    <LocalModelCard
      v-for="m in filteredModels"
      :key="m.id"
      :model="m"
      :fetching="isFetching(m.id)"
      @details="openMeta"
      @fetch-info="fetchInfo"
      @delete="deleteModel"
      @preview="(url: string) => emit('openPreview', url)"
    />
  </div>
</template>

<style scoped>
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(280px, 22vw, 380px), 1fr));
  gap: clamp(14px, 1.2vw, 22px);
}
</style>
