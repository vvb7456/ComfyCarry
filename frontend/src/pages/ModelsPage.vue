<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import Drawer from '@/components/ui/Drawer.vue'
import DrawerTrigger from '@/components/ui/DrawerTrigger.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
import CivitaiModelModal from '@/components/models/CivitaiModelModal.vue'
import LocalModelModal from '@/components/models/LocalModelModal.vue'
import LocalModelsTab from '@/components/models/LocalModelsTab.vue'
import HuggingFaceTab from '@/components/models/HuggingFaceTab.vue'
import CivitaiTab from '@/components/models/CivitaiTab.vue'
import FavoritesPanel from '@/components/models/FavoritesPanel.vue'
import DownloadsPanel from '@/components/models/DownloadsPanel.vue'
import DownloadDirModal from '@/components/models/DownloadDirModal.vue'
import { useDownloads } from '@/composables/useDownloads'
import { useDownloadsStore } from '@/stores/downloads'
import type { ModelMeta } from '@/types/models'
import type { LocalModel } from '@/composables/useLocalModels'

defineOptions({ name: 'ModelsPage' })

const { t } = useI18n({ useScope: 'global' })

// ── Tabs ──
// 按「看哪个来源的模型」区分。收藏与下载任务是流水线状态不是浏览目的地,
// 已收进右侧抽屉 (见下)。
const activeTab = ref('local')
const tabs = computed(() => [
  { key: 'local', label: t('models.tabs.local'), icon: 'inventory_2' },
  { key: 'huggingface', label: t('models.tabs.huggingface'), icon: 'verified' },
  { key: 'civitai', label: t('models.tabs.civitai'), icon: 'search' },
])

// ── 收藏&下载抽屉 ──────────────────────────────────────────────────────────
const {
  tasks: dlTasks,
  activeTasks: dlActiveTasks,
  failedTasks: dlFailedTasks,
  loadFavorites: dlLoadFavorites,
  refreshStatus: dlRefreshStatus,
  startPolling: dlStartPolling,
} = useDownloads()

const drawerOpen = ref(false)
// 抽屉内容首开才挂载: Drawer 本身常驻 (Teleport), slot 内容首次打开后保留
const drawerEverOpened = ref(false)

/** 进行中 = active + queued + paused, 与抽屉里「进行中」分组同口径 */
const inProgressCount = computed(() =>
  dlTasks.value.filter(t =>
    t.status === 'active' || t.status === 'queued' || t.status === 'paused',
  ).length,
)

/** 有任务在真正跑 → 图标 pulse (paused 不算) */
const isRunning = computed(() =>
  dlTasks.value.some(t => t.status === 'active' || t.status === 'queued'),
)

// 失败提示: 抽屉关着时失败任务完全无感, 所以在触发器上留一个红点。
// 打开一次就算"已看过", 之后只有新的失败才会再亮。已看过的集合只存内存 ——
// 刷新页面重新提示一次不算 bug, 换 localStorage 反而会漏掉真正需要处理的失败。
const seenFailedIds = ref<Set<string>>(new Set())
const hasUnseenFailure = computed(() =>
  dlFailedTasks.value.some(t => !seenFailedIds.value.has(t.download_id)),
)

function openDrawer() {
  drawerOpen.value = true
  if (!drawerEverOpened.value) drawerEverOpened.value = true
  // 打开时拿一次即时数据。startPolling 不在这里调 —— store 的下载动作自己会调,
  // 且 refreshStatus 在没有活跃任务时会自行 stopPolling。
  dlLoadFavorites()
  dlRefreshStatus()
  seenFailedIds.value = new Set(dlFailedTasks.value.map(x => x.download_id))
}

// 冷启动: 直接刷新落在模型页、而后台已有任务在跑时 store 是空的, badge 会假报 0。
// 拿一次快照补上 —— /api/downloads/snapshot 很小; 只有快照里确实有活跃任务才
// 建连接 (startPolling 会拉全量本地模型索引, 空闲时不值得)。同 CivitaiTab 的做法。
// 离开本页不 stopPolling: 生成页的依赖状态条共用同一个 store 单例, 断连会让那边
// 一起瞎; 收尾交给 store 自己的空闲断开。
onMounted(() => {
  dlRefreshStatus().then(() => {
    if (dlActiveTasks.value.length) dlStartPolling()
  })
})

// ── 下载目录裁决 ──
// 后端判不出文件用途时返回 409, store 把载荷放进 pendingClassification。
// 挂在页面层而非抽屉内 —— 搜索页、收藏面板的下载都走同一条 store 动作。
const downloads = useDownloadsStore()
const dirModalOpen = computed({
  get: () => downloads.pendingClassification !== null,
  set: (v: boolean) => { if (!v) downloads.cancelClassification() },
})

// ── Shared Modals ──
const civitaiOpen = ref(false)
const civitaiMeta = ref<ModelMeta | null>(null)
const localOpen = ref(false)
const localModel = ref<LocalModel | null>(null)
const previewOpen = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)

function openMeta(meta: ModelMeta) {
  civitaiMeta.value = meta
  civitaiOpen.value = true
}

function openLocal(model: LocalModel) {
  localModel.value = model
  localOpen.value = true
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
  <PageHeader :title="t('models.title')" />
  <div class="page-body">
    <!-- 触发器走 TabSwitcher 的默认插槽: 与 tab 同处一行, 底边线仍然通栏 -->
    <TabSwitcher v-model="activeTab" :tabs="tabs">
      <DrawerTrigger
        class="models-drawer-trigger"
        icon="download"
        :label="t('models.drawer.title')"
        :badge="inProgressCount"
        :pulse="isRunning"
        :alert="hasUnseenFailure"
        :alert-text="t('models.drawer.has_failed')"
        @click="openDrawer"
      />
    </TabSwitcher>

    <div v-show="activeTab === 'local'">
      <LocalModelsTab :active="activeTab === 'local'" @open-local="openLocal" @open-preview="openPreviewSingle" />
    </div>

    <div v-show="activeTab === 'huggingface'">
      <HuggingFaceTab :active="activeTab === 'huggingface'" @open-meta="openMeta" @open-preview="openPreviewSingle" />
    </div>

    <div v-show="activeTab === 'civitai'">
      <CivitaiTab :active="activeTab === 'civitai'" @open-meta="openMeta" @open-preview="openPreviewSingle" />
    </div>

    <!-- ═══ 收藏&下载抽屉 (常驻挂载 Drawer, slot 内容首开才挂载) ═══
         收藏 → 进行中 → 历史 三块竖排, 正好是一条流水线的时间顺序。 -->
    <Drawer
      v-model="drawerOpen"
      :title="t('models.drawer.title')"
      icon="download"
      width="clamp(480px, 46vw, 720px)"
    >
      <template v-if="drawerEverOpened">
        <FavoritesPanel />
        <DownloadsPanel />
      </template>
    </Drawer>

    <DownloadDirModal
      v-model="dirModalOpen"
      :civitai-url="downloads.pendingClassification?.civitaiUrl || ''"
      :pending-files="downloads.pendingClassification?.files || []"
      :dir-options="downloads.pendingClassification?.dirOptions || []"
      @confirm="downloads.resolveClassification"
    />

    <LocalModelModal v-model="localOpen" :model="localModel" @preview="openPreview" />
    <CivitaiModelModal v-model="civitaiOpen" :meta="civitaiMeta" :show-download="activeTab === 'civitai' || activeTab === 'huggingface'" @preview="openPreview" />
    <ImagePreview v-model="previewOpen" :images="previewImages" :initial-index="previewIndex" />
  </div>
</template>

<style scoped>
/* 触发器贴 tab 行右端 (插槽内容带的是本组件的 scope id, 从这里定样式) */
.models-drawer-trigger {
  margin-left: auto;
}
</style>
