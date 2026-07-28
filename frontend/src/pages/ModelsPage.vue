<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
import ModelMetaModal from '@/components/models/ModelMetaModal.vue'
import LocalModelsTab from '@/components/models/LocalModelsTab.vue'
import CivitaiTab from '@/components/models/CivitaiTab.vue'
import FavoritesTab from '@/components/models/FavoritesTab.vue'
import DownloadsTab from '@/components/models/DownloadsTab.vue'
import DownloadDirModal from '@/components/models/DownloadDirModal.vue'
import { useDownloadsStore } from '@/stores/downloads'
import type { ModelMeta } from '@/types/models'

defineOptions({ name: 'ModelsPage' })

const { t } = useI18n({ useScope: 'global' })

// ── Tabs ──
const activeTab = ref('local')
const tabs = computed(() => [
  { key: 'local', label: t('models.tabs.local'), icon: 'inventory_2' },
  { key: 'civitai', label: t('models.tabs.civitai'), icon: 'search' },
  { key: 'favorites', label: t('models.tabs.favorites'), icon: 'push_pin' },
  { key: 'tasks', label: t('models.tabs.tasks'), icon: 'download' },
])

// ── 下载目录裁决 ──
// 后端判不出文件用途时返回 409, store 把载荷放进 pendingClassification。
// 挂在页面层而非某个 tab —— 搜索页、收藏页的下载都走同一条 store 动作。
const downloads = useDownloadsStore()
const dirModalOpen = computed({
  get: () => downloads.pendingClassification !== null,
  set: (v: boolean) => { if (!v) downloads.cancelClassification() },
})

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

    <div v-show="activeTab === 'favorites'">
      <FavoritesTab :active="activeTab === 'favorites'" />
    </div>

    <div v-show="activeTab === 'tasks'">
      <DownloadsTab :active="activeTab === 'tasks'" />
    </div>

    <DownloadDirModal
      v-model="dirModalOpen"
      :civitai-url="downloads.pendingClassification?.civitaiUrl || ''"
      :pending-files="downloads.pendingClassification?.files || []"
      :dir-options="downloads.pendingClassification?.dirOptions || []"
      @confirm="downloads.resolveClassification"
    />

    <ModelMetaModal v-model="metaOpen" :meta="metaMeta" :show-download="activeTab === 'civitai'" @preview="openPreview" />
    <ImagePreview v-model="previewOpen" :images="previewImages" :initial-index="previewIndex" />
  </div>
</template>
