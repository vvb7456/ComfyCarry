<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import type { ExecState } from '@/composables/useExecTracker'
import type { ComfyQueueResponse } from '@/types/comfyui'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'QueuePanel' })

type QueueItem = [number, string, Record<string, unknown>, ...unknown[]]

const props = defineProps<{
  execState: ExecState | null
  elapsed: number
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const queueRunning = ref<QueueItem[]>([])
const queuePending = ref<QueueItem[]>([])

async function loadQueue() {
  const d = await get<ComfyQueueResponse>('/api/comfyui/queue')
  if (!d) return
  queueRunning.value = (d.queue_running || []) as QueueItem[]
  queuePending.value = (d.queue_pending || []) as QueueItem[]
}

async function interrupt() {
  if (!await post('/api/comfyui/interrupt')) return
  toast(t('comfyui.toast.interrupt_sent'), 'warning')
  setTimeout(loadQueue, 1000)
}

async function deleteItem(promptId: string) {
  if (!await confirm({ message: t('comfyui.queue.delete_confirm'), variant: 'danger' })) return
  if (!await post('/api/comfyui/queue/delete', { delete: [promptId] })) return
  toast(t('comfyui.toast.deleted'), 'success')
  loadQueue()
}

async function clearQueue() {
  if (!await post('/api/comfyui/queue/clear')) return
  toast(t('comfyui.queue.cleared'), 'success')
  loadQueue()
}

function fmtId(id: string) {
  return (id || '').substring(0, 8) + '…'
}

function nodeCount(item: QueueItem) {
  return Object.keys(item[2] || {}).length
}

onMounted(loadQueue)

defineExpose({ loadQueue })
</script>

<template>
  <div class="queue-panel">
    <!-- Running -->
    <CollapsibleGroup
      icon="play_arrow"
      :title="t('comfyui.queue.running')"
      :default-open="true"
    >
      <SectionToolbar>
        <template #end>
          <BaseButton variant="danger" size="sm" @click="interrupt">
            {{ t('comfyui.queue.interrupt') }}
          </BaseButton>
        </template>
      </SectionToolbar>

      <EmptyState
        v-if="queueRunning.length === 0"
        density="compact"
        :message="t('comfyui.queue.no_running')"
      />
      <div v-for="item in queueRunning" :key="item[1]" class="queue-running-item">
        <div class="queue-running-item__row">
          <span class="queue-id text-truncate">{{ fmtId(item[1]) }} · {{ t('comfyui.queue.node_count', { count: nodeCount(item) }) }}</span>
        </div>
        <ComfyProgressBar
          v-if="execState && execState.promptId === item[1]"
          :state="execState"
          :elapsed="elapsed"
        />
      </div>
    </CollapsibleGroup>

    <!-- Pending -->
    <CollapsibleGroup
      icon="hourglass_top"
      :title="t('comfyui.queue.pending')"
      :count="queuePending.length"
      :default-open="false"
    >
      <SectionToolbar>
        <template #end>
          <BaseButton size="sm" @click="clearQueue">
            {{ t('comfyui.queue.clear') }}
          </BaseButton>
        </template>
      </SectionToolbar>

      <EmptyState
        v-if="queuePending.length === 0"
        density="compact"
        :message="t('comfyui.queue.no_pending')"
      />
      <div v-for="(item, idx) in queuePending" :key="item[1]" class="queue-pending-item">
        <span class="queue-id text-truncate">
          #{{ idx + 1 }} · {{ fmtId(item[1]) }} · {{ t('comfyui.queue.node_count', { count: nodeCount(item) }) }}
        </span>
        <BaseButton variant="danger" size="sm" square @click="deleteItem(item[1])">
          <MsIcon name="delete" color="none" />
        </BaseButton>
      </div>
    </CollapsibleGroup>
  </div>
</template>

<style scoped>
.queue-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.queue-running-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.queue-running-item__row {
  display: flex;
  align-items: center;
}

.queue-id {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem;
  color: var(--t3);
}

.queue-pending-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--bd);
}

.queue-pending-item:last-child {
  border-bottom: none;
}

.queue-pending-item .queue-id {
  flex: 1;
  min-width: 0;
}
</style>
