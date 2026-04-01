<script setup lang="ts">
import { computed, onMounted } from 'vue'
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
import type { ModelMeta, ModelMetaImage } from '@/types/models'
import type { LocalModel } from '@/composables/useLocalModels'

defineOptions({ name: 'LocalModelsTab' })

const emit = defineEmits<{
  openMeta: [meta: ModelMeta]
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
  totalCount,
  infoCount,
  loadModels,
} = useLocalModels()

const { isFetching, fetchInfo, deleteModel, fetchAll, batchProgress } = useModelActions(loadModels)

const categoryOptions = computed(() => [
  { value: 'all', label: t('models.local.all_types') },
  { value: 'checkpoints', label: t('models.local.checkpoints') },
  { value: 'loras', label: t('models.local.lora') },
  { value: 'controlnet', label: t('models.local.controlnet') },
  { value: 'vae', label: t('models.local.vae') },
  { value: 'upscale_models', label: t('models.local.upscale') },
  { value: 'embeddings', label: t('models.local.embeddings') },
])

const folderOptions = computed(() => [
  { value: '', label: t('models.local.all_folders') },
  ...availableFolders.value.map(f => ({ value: f, label: f })),
])

onMounted(() => {
  loadModels()
})

function localToMeta(m: LocalModel): ModelMeta {
  const images: ModelMetaImage[] = []
  if (m.has_preview && m.preview_path) {
    images.push({ url: `/api/local_models/preview?path=${encodeURIComponent(m.preview_path)}` })
  }
  if (m.images) {
    for (const img of m.images) {
      images.push({
        url: img.url,
        type: img.type,
        seed: img.seed,
        steps: img.steps,
        cfg: img.cfg,
        sampler: img.sampler,
        model: img.model,
        positive: img.positive,
        negative: img.negative,
      })
    }
  }
  return {
    name: m.name,
    type: m.category,
    baseModel: m.base_model,
    id: m.civitai_id,
    versionId: m.civitai_version_id,
    versionName: m.version_name,
    sha256: m.sha256,
    filename: m.filename,
    civitaiUrl: m.civitai_id
      ? `https://civitai.com/models/${m.civitai_id}`
      : undefined,
    trainedWords: m.trained_words,
    images,
  }
}

function openMeta(m: LocalModel) {
  emit('openMeta', localToMeta(m))
}
</script>

<template>
  <SectionToolbar>
    <template #start>
      <FilterInput
        v-model="textFilter"
        :placeholder="t('models.local.filter_placeholder')"
        style="flex:1;max-width:280px"
      />
      <span class="toolbar-status">
        <template v-if="batchProgress.running">
          {{ t('models.local.fetching_progress', { current: batchProgress.current, total: batchProgress.total, filename: batchProgress.filename }) }}
        </template>
        <template v-else>
          {{ t('models.local.total_models', { count: totalCount, infoCount }) }}
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
        :disabled="categoryFilter === 'all'"
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
      :key="m.rel_path"
      :model="m"
      :fetching="isFetching(m.abs_path)"
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
