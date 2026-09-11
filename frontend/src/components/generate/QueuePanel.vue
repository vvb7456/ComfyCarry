<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useGenerateQueueStore } from '@/stores/generateQueue'
import type { ExecState } from '@/composables/useExecTracker'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ListRow from '@/components/ui/ListRow.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'QueuePanel' })

type QueueItem = [number, string, Record<string, unknown>, ...unknown[]]

const props = defineProps<{
  execState: ExecState | null
  elapsed: number
}>()

const { t } = useI18n({ useScope: 'global' })
const { post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const queueStore = useGenerateQueueStore()
const { queueRunning, queuePending } = storeToRefs(queueStore)

// 提交中的单动作标记: 对应按钮转 loading, 面板内其余动作互斥禁用。
// 标记为 prompt id 或动作名, 不引入额外状态机。
const acting = ref<string | null>(null)

// 挂载时自行从 store 取数 (抽屉首开才挂载内容, 此处仅首次挂载时拉一次)
onMounted(() => {
  if (queueStore.queueCount === 0) queueStore.loadQueue()
})

async function interrupt() {
  if (acting.value) return
  acting.value = 'interrupt'
  try {
    if (!await post('/api/comfyui/interrupt')) return
    toast(t('comfyui.msg.interrupt_sent'), 'warning')
    setTimeout(() => queueStore.loadQueue(), 1000)
  } finally {
    acting.value = null
  }
}

async function deleteItem(promptId: string) {
  if (acting.value) return
  if (!await confirm({ message: t('comfyui.queue.delete_confirm'), variant: 'danger' })) return
  acting.value = promptId
  try {
    if (!await post('/api/comfyui/queue/delete', { delete: [promptId] })) return
    toast(t('comfyui.msg.deleted'), 'success')
    queueStore.loadQueue()
  } finally {
    acting.value = null
  }
}

async function clearQueue() {
  if (acting.value) return
  acting.value = 'clear'
  try {
    if (!await post('/api/comfyui/queue/clear')) return
    toast(t('comfyui.queue.cleared'), 'success')
    queueStore.loadQueue()
  } finally {
    acting.value = null
  }
}

function fmtId(id: string) {
  return (id || '').substring(0, 8) + '…'
}

function nodeCount(item: QueueItem) {
  return Object.keys(item[2] || {}).length
}
</script>

<template>
  <div class="queue-panel">
    <!-- Running -->
    <CollapsibleGroup
      icon="play_arrow"
      :title="t('comfyui.queue.running')"
      :default-open="true"
    >
      <!-- 中断收进标题行右侧 (CollapsibleGroup 的 title-right 插槽, margin-left:auto 右对齐);
           header 整行绑了 toggle, 故按钮需 .stop 阻止冒泡, 与 DownloadsPanel 的用法一致 -->
      <template #title-right>
        <BaseButton variant="danger" size="xs" :disabled="!!acting" :loading="acting === 'interrupt'" @click.stop="interrupt">
          {{ t('comfyui.queue.interrupt') }}
        </BaseButton>
      </template>

      <EmptyState
        v-if="queueRunning.length === 0"
        density="compact"
        :message="t('comfyui.queue.no_running')"
      />
      <ul v-else class="list-plain">
        <ListRow
          v-for="item in queueRunning"
          :key="item[1]"
          :title="fmtId(item[1])"
          :status="{ tone: 'running', text: t('comfyui.queue.running') }"
          :facts="[t('comfyui.queue.node_count', { count: nodeCount(item) })]"
        >
          <template v-if="execState && execState.promptId === item[1]" #extra>
            <ComfyProgressBar :state="execState" :elapsed="elapsed" />
          </template>
        </ListRow>
      </ul>
    </CollapsibleGroup>

    <!-- Pending -->
    <CollapsibleGroup
      icon="hourglass_top"
      :title="t('comfyui.queue.pending')"
      :count="queuePending.length"
      :default-open="false"
    >
      <!-- 清空同样收进标题行右侧, 与「正在执行」的中断保持一致 -->
      <template #title-right>
        <BaseButton size="xs" :disabled="!!acting" :loading="acting === 'clear'" @click.stop="clearQueue">
          {{ t('comfyui.queue.clear') }}
        </BaseButton>
      </template>

      <EmptyState
        v-if="queuePending.length === 0"
        density="compact"
        :message="t('comfyui.queue.no_pending')"
      />
      <ul v-else class="list-plain">
        <ListRow
          v-for="(item, idx) in queuePending"
          :key="item[1]"
          :title="`#${idx + 1} · ${fmtId(item[1])}`"
          :facts="[t('comfyui.queue.node_count', { count: nodeCount(item) })]"
        >
          <template #actions>
            <BaseButton
              variant="danger"
              size="sm"
              icon-only
              :aria-label="t('common.btn.delete')"
              :title="t('common.btn.delete')"
              :disabled="!!acting"
              :loading="acting === item[1]"
              @click="deleteItem(item[1])"
            >
              <MsIcon name="delete" />
            </BaseButton>
          </template>
        </ListRow>
      </ul>
    </CollapsibleGroup>
  </div>
</template>

<style scoped>
.queue-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 队列项主行是 prompt id / 序号，用等宽字与节点事实对齐 */
.queue-panel :deep(.list-row__title) {
  font-family: var(--font-mono);
}

.queue-panel :deep(.comfy-progress-bar),
.queue-panel :deep(.comfy-progress-bar--idle) {
  margin-top: 8px;
}
</style>
