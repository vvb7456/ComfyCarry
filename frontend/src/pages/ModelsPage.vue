<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
import ModelMetaModal from '@/components/models/ModelMetaModal.vue'
import LocalModelsTab from '@/components/models/LocalModelsTab.vue'
import CivitaiTab from '@/components/models/CivitaiTab.vue'
import DownloadsTab from '@/components/models/DownloadsTab.vue'
import type { ModelMeta } from '@/types/models'

defineOptions({ name: 'ModelsPage' })

const { t } = useI18n({ useScope: 'global' })

// ── Tabs ──
const activeTab = ref('local')
const tabs = computed(() => [
  { key: 'local', label: t('models.tabs.local'), icon: 'inventory_2' },
  { key: 'civitai', label: t('models.tabs.civitai'), icon: 'search' },
  { key: 'downloads', label: t('models.tabs.downloads'), icon: 'download' },
])

// ── Shared Modals ──
const metaOpen = ref(false)
const metaMeta = ref<ModelMeta | null>(null)
const previewOpen = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)

function openMeta(meta: ModelMeta) {
  metaMeta.value = meta
  metaOpen.value = true
}

function openPreview(images: string[], index = 0) {
  previewImages.value = images
  previewIndex.value = index
  previewOpen.value = true
}

function openPreviewSingle(url: string) {
  openPreview([url], 0)
}
</script>

<template>
  <PageHeader icon="extension" :title="t('models.title')" />
  <div class="page-body">
    <TabSwitcher v-model="activeTab" :tabs="tabs" />

    <div v-show="activeTab === 'local'">
      <LocalModelsTab @open-meta="openMeta" @open-preview="openPreviewSingle" />
    </div>

    <div v-show="activeTab === 'civitai'">
      <CivitaiTab :active="activeTab === 'civitai'" @open-meta="openMeta" @open-preview="openPreviewSingle" />
    </div>

    <div v-show="activeTab === 'downloads'">
      <DownloadsTab :active="activeTab === 'downloads'" />
    </div>

    <ModelMetaModal v-model="metaOpen" :meta="metaMeta" :show-download="activeTab === 'civitai'" @preview="openPreview" />
    <ImagePreview v-model="previewOpen" :images="previewImages" :initial-index="previewIndex" />
  </div>
</template>
