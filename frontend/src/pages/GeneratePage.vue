<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import { useToast } from '@/composables/useToast'
import PageHeader from '@/components/layout/PageHeader.vue'
import TabSwitcher, { type TabItem } from '@/components/ui/TabSwitcher.vue'
import QueuePanel from './generate/QueuePanel.vue'

defineOptions({ name: 'GeneratePage' })

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

const activeTab = ref('sdxl')

const tabs = computed<TabItem[]>(() => [
  { key: 'sdxl', label: t('generate.tabs.sdxl'), icon: 'image' },
  { key: 'flux', label: t('generate.tabs.flux'), icon: 'bolt', disabled: true },
  { key: 'history', label: t('generate.tabs.history'), icon: 'history', align: 'right' },
])

// Shared exec tracker + SSE (one connection for entire page)
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

const queuePanelRef = ref<InstanceType<typeof QueuePanel> | null>(null)

const sse = useComfySSE(tracker, {
  onEvent(evt, result) {
    if (evt.type === 'status') {
      queuePanelRef.value?.loadQueue()
    }
    if (result?.finished) {
      if (result.type === 'execution_done') {
        const elapsed = result.data?.elapsed ? ` (${result.data.elapsed}s)` : ''
        toast(`✅ ${t('comfyui.toast.gen_complete')}${elapsed}`)
        queuePanelRef.value?.loadQueue()
      } else if (result.type === 'execution_interrupted') {
        toast(`⏹ ${t('comfyui.toast.exec_interrupted')}`)
        queuePanelRef.value?.loadQueue()
      }
    }
  },
})

sse.start()
</script>

<template>
  <PageHeader icon="auto_awesome" :title="t('generate.title')" />
  <div class="page-body">
    <TabSwitcher v-model="activeTab" :tabs="tabs" />

    <!-- SDXL Tab (placeholder) -->
    <div v-show="activeTab === 'sdxl'" />

    <!-- History & Queue Tab -->
    <div v-show="activeTab === 'history'">
      <QueuePanel
        ref="queuePanelRef"
        :exec-state="execState"
        :elapsed="tracker.elapsed.value"
      />
    </div>
  </div>
</template>

