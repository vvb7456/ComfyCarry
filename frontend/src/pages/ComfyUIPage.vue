<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatCard from '@/components/ui/StatCard.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import HeaderStatusBadge from '@/components/layout/HeaderStatusBadge.vue'
import type {
  ComfyStatus, ParamSchema, ParamOption,
  ComfyParamsResponse, ComfyParamsSaveResponse,
  ComfyQueueResponse, ComfyHistoryItem, ComfyHistoryResponse,
} from '@/types/comfyui'

defineOptions({ name: 'ComfyUIPage' })

const { t, te } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const activeTab = ref('console')
const comfyTabs = computed(() => [
  { key: 'console', label: t('comfyui.tabs.console'), icon: 'terminal' },
  { key: 'queue',   label: t('comfyui.tabs.queue'), icon: 'queue' },
  { key: 'history', label: t('comfyui.tabs.history'), icon: 'history' },
])

const comfyCardStatus = computed<'info' | 'running' | 'stopped' | 'loading' | 'error'>(() => {
  if (!status.value) return 'info'
  if (status.value.online) return execState.value ? 'loading' : 'running'
  if (status.value.pm2_status === 'errored') return 'error'
  if (status.value.pm2_status === 'online') return 'info'
  return 'stopped'
})

// Status
const status = ref<ComfyStatus | null>(null)
const rawArgs = ref('')

// Params
const paramsSchema = ref<Record<string, ParamSchema>>({})
const paramsCurrent = ref<Record<string, string | number | boolean>>({})
const paramsStatus = ref('')
const paramsStatusColor = ref('var(--t3)')
let paramsStatusTimer: ReturnType<typeof setTimeout> | null = null
const LRU_CACHE_SIZE_PRESETS = ['16', '32', '64', '128', '256']

// Queue
type QueueItem = [number, string, Record<string, unknown>, ...unknown[]]
const queueRunning = ref<QueueItem[]>([])
const queuePending = ref<QueueItem[]>([])
const queueSummary = ref('')

// History
const historyItems = ref<ComfyHistoryItem[]>([])
const historySortAsc = ref(false)
const historySize = ref<'sm' | 'md' | 'lg'>('md')

// Exec + SSE
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

const sse = useComfySSE(tracker, {
  onEvent(evt, result) {
    if (evt.type === 'status') {
      if (activeTab.value === 'queue') loadQueue()
    }
    if (result?.finished) {
      if (result.type === 'execution_done') {
        const elapsed = result.data?.elapsed ? ` (${result.data.elapsed}s)` : ''
        toast(`✅ ${t('comfyui.toast.gen_complete')}${elapsed}`)
        loadStatus()
        if (activeTab.value === 'queue') loadQueue()
        if (activeTab.value === 'history') loadHistory()
      } else if (result.type === 'execution_interrupted') {
        toast(`⏹ ${t('comfyui.toast.exec_interrupted')}`)
        if (activeTab.value === 'queue') loadQueue()
      }
    }
  }
})

// Log stream
const logStream = useLogStream({
  historyUrl: '/api/logs/comfy?lines=200',
  streamUrl: '/api/comfyui/logs/stream',
  classify(line) {
    if (/error|exception|traceback/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/loaded|model|checkpoint|lora/i.test(line)) return 'log-info'
    return ''
  },
})

const refresh = useAutoRefresh(loadStatus, 10000)

onMounted(() => {
  loadPage()
  refresh.start({ immediate: false })
  sse.start()
  logStream.start()
})

onUnmounted(() => {
  refresh.stop()
  sse.stop()
  logStream.stop()
  if (paramsStatusTimer) {
    clearTimeout(paramsStatusTimer)
    paramsStatusTimer = null
  }
})

async function loadPage() {
  await Promise.all([loadStatus(), loadParams()])
}

function clearParamsStatus() {
  paramsStatus.value = ''
  paramsStatusColor.value = 'var(--t3)'
  if (paramsStatusTimer) {
    clearTimeout(paramsStatusTimer)
    paramsStatusTimer = null
  }
}

function scheduleParamsStatusClear(delay = 5000) {
  if (paramsStatusTimer) clearTimeout(paramsStatusTimer)
  paramsStatusTimer = setTimeout(() => {
    clearParamsStatus()
  }, delay)
}

async function loadStatus() {
  const d = await get<ComfyStatus>('/api/comfyui/status')
  if (d) {
    status.value = d
    rawArgs.value = (d.args || []).join(' ')
  }
}

async function loadParams() {
  const d = await get<ComfyParamsResponse>('/api/comfyui/params')
  if (d) {
    paramsSchema.value = d.schema || {}
    paramsCurrent.value = d.current || {}
    normalizeCacheLruSize()
  }
}

function normalizeCacheLruSize() {
  const current = String(paramsCurrent.value.cache_lru_size ?? '')
  if (!LRU_CACHE_SIZE_PRESETS.includes(current) && !/^[1-9]\d*$/.test(current)) {
    paramsCurrent.value.cache_lru_size = '16'
  }
}

// Tab switching
function switchTab(tab: string) {
  activeTab.value = tab
  if (tab === 'queue') loadQueue()
  else if (tab === 'history') loadHistory()
}

// Actions
async function comfyStart() {
  if (!await post('/api/services/comfy/start')) return
  toast(t('comfyui.toast.starting'))
  setTimeout(loadPage, 3000)
}

async function comfyStop() {
  if (!await confirm({ message: t('comfyui.confirm.stop') })) return
  if (!await post('/api/services/comfy/stop')) return
  toast(t('comfyui.toast.stopped'))
  setTimeout(loadStatus, 1000)
}

async function comfyRestart() {
  if (!await confirm({ message: t('comfyui.confirm.restart') })) return
  // Auto-save params before restart
  if (!await saveParams(false)) return
  if (!await post('/api/services/comfy/restart')) return
  toast(t('comfyui.toast.restarting'))
  setTimeout(loadPage, 5000)
}

async function comfyInterrupt() {
  if (!await post('/api/comfyui/interrupt')) return
  toast(t('comfyui.toast.interrupt_sent'))
  setTimeout(loadQueue, 1000)
}

// Params
function collectParams() {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, schema] of Object.entries(paramsSchema.value)) {
    result[key] = paramsCurrent.value[key] ?? schema.value
  }
  if (!result.listen) result.listen = '0.0.0.0'
  if (!result.port) result.port = 8188
  return result
}

function extractExtraArgs() {
  const knownFlags = new Set<string>(['--listen', '--port'])
  for (const schema of Object.values(paramsSchema.value)) {
    if (schema.flag) knownFlags.add(schema.flag)
    if (schema.flag_prefix) knownFlags.add(schema.flag_prefix)
    if (schema.flag_map) {
      Object.values(schema.flag_map).forEach(flag => knownFlags.add(flag))
    }
  }

  const parts = rawArgs.value.replace(/^main\.py\s*/, '').split(/\s+/).filter(Boolean)
  const extras: string[] = []
  let i = 0

  while (i < parts.length) {
    if (knownFlags.has(parts[i])) {
      i += 1
      if (i < parts.length && !parts[i].startsWith('--')) i += 1
      continue
    }
    extras.push(parts[i])
    i += 1
  }

  return extras.join(' ')
}

function getParamLabel(paramKey: string, schema: ParamSchema) {
  const key = `comfyui.params.fields.${paramKey}.label`
  return te(key) ? t(key) : schema.label
}

function getParamHelp(paramKey: string, schema: ParamSchema) {
  if (!schema.help) return ''
  const key = `comfyui.params.fields.${paramKey}.help`
  return te(key) ? t(key) : schema.help
}

function getParamOptions(paramKey: string, schema: ParamSchema) {
  if (paramKey === 'cache_lru_size') {
    const options = LRU_CACHE_SIZE_PRESETS.map((value) => {
      const key = `comfyui.params.fields.${paramKey}.options.${value}`
      return { value, label: te(key) ? t(key) : value }
    })
    const current = String(paramsCurrent.value.cache_lru_size ?? '')
    if (current && !LRU_CACHE_SIZE_PRESETS.includes(current) && /^[1-9]\d*$/.test(current)) {
      options.push({ value: current, label: current })
    }
    return options
  }

  return (schema.options || []).map((option) => {
    const value = Array.isArray(option) ? option[0] : option
    const fallbackLabel = Array.isArray(option) ? option[1] : option
    const key = `comfyui.params.fields.${paramKey}.options.${value}`
    if (Array.isArray(option)) {
      return { value: option[0], label: te(key) ? t(key) : fallbackLabel }
    }
    return { value: option, label: te(key) ? t(key) : fallbackLabel }
  })
}

function isParamEnabled(schema: ParamSchema) {
  if (!schema.depends_on) return true
  return Object.entries(schema.depends_on).every(([depKey, depValue]) => {
    return String(paramsCurrent.value[depKey]) === String(depValue)
  })
}

watch(() => paramsCurrent.value.cache, (cache) => {
  if (cache !== 'lru') {
    paramsCurrent.value.cache_lru_size = '16'
    return
  }
  normalizeCacheLruSize()
})

async function saveParams(withConfirm = true): Promise<boolean> {
  if (withConfirm && !await confirm({ message: t('comfyui.console.params_save_confirm') })) return false
  clearParamsStatus()
  paramsStatus.value = t('comfyui.console.params_saving')
  paramsStatusColor.value = 'var(--amber)'
  const params = collectParams()
  const d = await post<ComfyParamsSaveResponse>('/api/comfyui/params', { params, extra_args: extractExtraArgs() })
  if (d?.ok) {
    paramsStatus.value = t('comfyui.console.saved_restarting')
    paramsStatusColor.value = 'var(--green)'
    toast(t('comfyui.console.params_restart_toast'))
    scheduleParamsStatusClear()
    if (withConfirm) setTimeout(() => { loadPage() }, 5000)
    return true
  } else {
    paramsStatus.value = d?.error || t('comfyui.console.params_save_failed')
    paramsStatusColor.value = 'var(--red)'
    return false
  }
}

// Queue
async function loadQueue() {
  const d = await get<ComfyQueueResponse>('/api/comfyui/queue')
  if (!d) return
  queueRunning.value = (d.queue_running || []) as QueueItem[]
  queuePending.value = (d.queue_pending || []) as QueueItem[]
  const parts = []
  if (queueRunning.value.length) parts.push(t('comfyui.queue.executing_count', { count: queueRunning.value.length }))
  if (queuePending.value.length) parts.push(t('comfyui.queue.pending_count', { count: queuePending.value.length }))
  queueSummary.value = parts.join(' · ') || t('comfyui.queue.idle')
}

async function deleteQueueItem(promptId: string) {
  if (!await confirm({ message: t('comfyui.queue.delete_confirm'), variant: 'danger' })) return
  if (!await post('/api/comfyui/queue/delete', { delete: [promptId] })) return
  toast(t('comfyui.toast.deleted'))
  loadQueue()
}

async function clearQueue() {
  if (!await post('/api/comfyui/queue/clear')) return
  toast(t('comfyui.queue.cleared'))
  loadQueue()
}

// History
async function loadHistory() {
  const d = await get<ComfyHistoryResponse>('/api/comfyui/history?max_items=20')
  if (!d) return
  let items = d.history || []
  if (historySortAsc.value) items = [...items].reverse()
  historyItems.value = items
}

function downloadImage(filename: string, subfolder: string, type: string) {
  const url = `/api/comfyui/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

function downloadAllImages(images: Array<{ filename: string; subfolder: string; type: string }>) {
  images.forEach((img, i) => setTimeout(() => downloadImage(img.filename, img.subfolder || '', img.type || 'output'), i * 200))
}

// Formatters
function fmtBytes(b: number) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i]
}

function fmtUptime(pm2Uptime: number) {
  if (!pm2Uptime) return ''
  const up = Date.now() - pm2Uptime
  const h = Math.floor(up / 3600000)
  const m = Math.floor((up % 3600000) / 60000)
  return `${h}h ${m}m`
}

function openImageInTab(event: MouseEvent) {
  const img = event.currentTarget as HTMLImageElement | null
  if (img?.src) window.open(img.src, '_blank')
}

const sortedHistory = computed(() => historySortAsc.value ? [...historyItems.value] : historyItems.value)
</script>

<template>
  <PageHeader icon="terminal" :title="t('comfyui.title')">
    <template #badge>
      <HeaderStatusBadge
        v-if="status"
        :running="status.pm2_status === 'online'"
        :running-label="t('comfyui.status.running')"
        :stopped-label="t('comfyui.status.stopped')"
      />
    </template>
    <template #controls>
      <span v-if="status">
        <template v-if="status.online">
          <BaseButton @click="comfyStop"><MsIcon name="stop" /> {{ t('common.btn.stop') }}</BaseButton>
          <BaseButton @click="comfyRestart"><MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}</BaseButton>
        </template>
        <BaseButton v-else @click="comfyStart"><MsIcon name="play_arrow" /> {{ t('common.btn.start') }}</BaseButton>
      </span>
    </template>
  </PageHeader>

  <div class="page-body">
    <!-- Tabs -->
    <TabSwitcher v-model="activeTab" :tabs="comfyTabs" @update:modelValue="switchTab" />

    <!-- ===== Console Tab ===== -->
    <div v-show="activeTab === 'console'">
      <!-- Status cards -->
      <div class="stat-grid" v-if="status">
        <!-- ComfyUI status -->
        <StatCard label="ComfyUI" :status="comfyCardStatus" value-size="sm">
          <template #value>{{ status.online ? (execState ? t('comfyui.status.generating') : t('comfyui.status.idle')) : t('comfyui.status.stopped') }}</template>
          <template #sub v-if="status.online">
            v{{ status.system?.comfyui_version || '?' }} · Python {{ status.system?.python_version || '?' }} · PyTorch {{ status.system?.pytorch_version || '?' }}
          </template>
          <template #sub v-else>PM2: {{ status.pm2_status }}</template>
        </StatCard>

        <!-- GPU VRAM cards -->
        <StatCard v-for="(dev, i) in status.devices" :key="i" :label="dev.name || 'GPU'">
          <template #value>{{ dev.vram_total > 0 ? (((dev.vram_total - dev.vram_free) / dev.vram_total) * 100).toFixed(0) + '%' : '—' }}</template>
          <template #sub>
            VRAM: {{ fmtBytes(dev.vram_total - dev.vram_free) }} / {{ fmtBytes(dev.vram_total) }} · Torch: {{ fmtBytes(dev.torch_vram_total - dev.torch_vram_free) }}
          </template>
          <UsageBar
            :percent="dev.vram_total > 0 ? ((dev.vram_total - dev.vram_free) / dev.vram_total * 100) : 0"
          />
        </StatCard>

        <!-- Uptime -->
        <StatCard v-if="status.pm2_uptime" :label="t('comfyui.console.uptime')" value-size="sm">
          <template #value>{{ fmtUptime(status.pm2_uptime) }}</template>
          <template #sub>{{ t('comfyui.console.restart_count', { count: status.pm2_restarts || 0 }) }}</template>
        </StatCard>
      </div>

      <!-- Exec progress bar — always visible (idle placeholder when not executing) -->
      <ComfyProgressBar :state="execState" :elapsed="tracker.elapsed.value" />

      <!-- Params Section -->
      <SectionHeader icon="settings">
        {{ t('comfyui.console.params') }}
        <HelpTip :text="t('comfyui.console.params_restart_hint')" />
        <template #actions>
          <span :style="{ color: paramsStatusColor, fontSize: '.78rem' }">{{ paramsStatus }}</span>
        </template>
      </SectionHeader>

      <!-- Raw args input -->
      <div style="margin-bottom:8px">
        <input
          v-model="rawArgs"
          type="text"
          :placeholder="t('comfyui.console.params_placeholder')"
          class="form-input form-input--mono"
        >
      </div>

      <!-- Params form -->
      <div class="comfy-params-form" v-if="Object.keys(paramsSchema).length">
        <div
          v-for="(schema, key) in paramsSchema"
          :key="key"
          class="comfy-param-group"
          :class="{ 'comfy-param-group--disabled': !isParamEnabled(schema) }"
        >
          <FormField density="compact">
            <template #label>
              {{ getParamLabel(String(key), schema) }}
              <HelpTip v-if="schema.help" :text="getParamHelp(String(key), schema)" />
            </template>
            <!-- Select -->
            <BaseSelect
              v-if="schema.type === 'select' || String(key) === 'cache_lru_size'"
              :modelValue="String(paramsCurrent[key])"
              @update:modelValue="v => paramsCurrent[key] = v"
              :options="getParamOptions(String(key), schema)"
              :disabled="!isParamEnabled(schema)"
              class="comfy-param-select"
            />
            <!-- Number -->
            <input v-else-if="schema.type === 'number'" type="number" v-model.number="paramsCurrent[key]" class="form-number comfy-param-number" :disabled="!isParamEnabled(schema)">
            <!-- Text -->
            <input v-else type="text" v-model="paramsCurrent[key]" class="form-input" :disabled="!isParamEnabled(schema)">
          </FormField>
        </div>
      </div>
      <div v-else-if="status" style="color:var(--t3);font-size:.82rem;padding:8px 0">{{ t('comfyui.console.params_loading') }}</div>

      <!-- Log -->
      <SectionHeader icon="receipt_long">{{ t('comfyui.console.log_title') }}</SectionHeader>
      <LogPanel :lines="logStream.lines.value" :status="logStream.status.value" />
    </div>

    <!-- ===== Queue Tab ===== -->
    <div v-show="activeTab === 'queue'">
      <div style="margin-bottom:16px;font-size:.82rem;color:var(--t3)">{{ queueSummary }}</div>

      <!-- Running -->
      <SectionHeader icon="play_arrow" flush>
        {{ t('comfyui.queue.running') }}
        <template #actions>
          <BaseButton variant="danger" size="sm" @click="comfyInterrupt">{{ t('comfyui.queue.interrupt') }}</BaseButton>
        </template>
      </SectionHeader>
      <div style="margin-bottom:20px">
        <EmptyState v-if="queueRunning.length === 0" density="compact" :message="t('comfyui.queue.no_running')" />
        <div v-for="item in queueRunning" :key="item[1]" class="queue-item running">
          <div class="queue-item-id">{{ (item[1] || '').substring(0, 8) }}… · {{ t('comfyui.queue.node_count', { count: Object.keys(item[2] || {}).length }) }}</div>
          <ComfyProgressBar v-if="execState && execState.promptId === item[1]"
            :state="execState" :elapsed="tracker.elapsed.value"
          />
        </div>
      </div>

      <!-- Pending -->
      <SectionHeader icon="hourglass_top" flush>
        {{ t('comfyui.queue.pending') }}
        <template #actions>
          <BaseButton size="sm" @click="clearQueue">{{ t('comfyui.queue.clear') }}</BaseButton>
        </template>
      </SectionHeader>
      <div style="margin-bottom:20px">
        <EmptyState v-if="queuePending.length === 0" density="compact" :message="t('comfyui.queue.no_pending')" />
        <div v-for="(item, idx) in queuePending" :key="item[1]" class="queue-item pending">
          <div class="queue-item-info">
            <div class="queue-item-id">#{{ idx + 1 }} · {{ (item[1] || '').substring(0, 8) }}… · {{ t('comfyui.queue.node_count', { count: Object.keys(item[2] || {}).length }) }}</div>
          </div>
          <BaseButton variant="danger" size="sm" square @click="deleteQueueItem(item[1])">
            <MsIcon name="delete" />
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- ===== History Tab ===== -->
    <div v-show="activeTab === 'history'">
      <SectionToolbar style="margin-bottom:14px">
        <template #start>
          <span style="font-size:.82rem;color:var(--t3)">{{ historyItems.length > 0 ? t('comfyui.history.record_count', { count: historyItems.length }) : '' }}</span>
        </template>
        <template #end>
          <BaseSelect v-model="historySortAsc" :options="[
            { value: false, label: t('comfyui.history.sort_desc') },
            { value: true, label: t('comfyui.history.sort_asc') },
          ]" size="sm" @change="loadHistory" style="width:auto;min-width:100px" />
          <BaseSelect v-model="historySize" :options="[
            { value: 'sm', label: t('comfyui.history.size_sm') },
            { value: 'md', label: t('comfyui.history.size_md') },
            { value: 'lg', label: t('comfyui.history.size_lg') },
          ]" size="sm" style="width:auto;min-width:100px" />
        </template>
      </SectionToolbar>

      <EmptyState v-if="historyItems.length === 0" icon="history" :message="t('comfyui.history.no_records')" />
      <div v-else :class="['history-grid', 'size-' + historySize]">
        <div v-for="item in sortedHistory" :key="item.prompt_id" class="history-card">
          <div class="history-card-images" v-if="item.images?.length">
            <img
              v-for="img in item.images"
              :key="img.filename"
              :src="`/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`"
              loading="lazy"
              alt=""
              @click="openImageInTab"
            >
          </div>
          <div v-else class="history-card-images empty">{{ t('comfyui.history.no_preview') }}</div>
          <div class="history-card-info">
            <StatusDot :status="item.completed ? 'running' : 'error'" />
            <div class="history-card-meta">
              <div>{{ item.prompt_id.substring(0, 8) }}…</div>
              <div style="font-size:.7rem;color:var(--t3)">{{ item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN') : '' }}</div>
            </div>
            <div v-if="item.images?.length" class="history-card-actions">
              <span v-if="item.images.length > 1" style="font-size:.68rem;color:var(--t3)">{{ t('comfyui.history.image_count', { count: item.images.length }) }}</span>
              <BaseButton size="sm" square :title="t('common.btn.download')" @click="downloadAllImages(item.images)">
                <MsIcon name="download" />
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Vue-unique: progress bar wrapper */
.exec-bar { margin: 12px 0; }

/* Vue-unique: param grid — FormField inside card needs no margin */
.comfy-param-group :deep(.form-field) { margin-bottom: 0; }

/* Vue-unique: number inputs right-aligned, no spinners */
.comfy-param-number { text-align: right; }
.comfy-param-number::-webkit-outer-spin-button,
.comfy-param-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

/* Vue-unique: no-image placeholder inside history card */
.history-card-images.empty { align-items: center; justify-content: center; color: var(--t3); font-size: .78rem; }

/* ── Queue Items ── */
.queue-item { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 12px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
.queue-item.running { border-left: 3px solid var(--green); flex-wrap: wrap; }
.queue-item.running .comfy-progress-bar { width: 100%; margin-top: 4px; min-height: 32px; padding: 8px 12px; font-size: .75rem; gap: 8px; }
.queue-item.pending { border-left: 3px solid var(--amber); }
.queue-item-info { flex: 1; min-width: 0; }
.queue-item-id { font-family: 'IBM Plex Mono', monospace; font-size: .75rem; color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── History Grid ── */
.history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.history-grid.size-sm { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
.history-grid.size-sm .history-card-images { height: 90px; }
.history-grid.size-sm .history-card-info { padding: 6px 10px; }
.history-grid.size-sm .history-card-meta { font-size: .68rem; }
.history-grid.size-lg { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.history-grid.size-lg .history-card-images { height: 220px; }
.history-grid.size-lg .history-card-info { padding: 14px 18px; }
.history-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); overflow: hidden; box-shadow: 0 1px 4px rgba(0, 0, 0, .2); }
.history-card-images { display: flex; gap: 2px; background: var(--bg); height: 140px; overflow: hidden; }
.history-card-images img { flex: 1; min-width: 0; height: 100%; object-fit: cover; cursor: pointer; }
.history-card-info { padding: 10px 14px; display: flex; align-items: center; gap: 8px; }
.history-card-info .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.history-card-info .status-dot.success { background: var(--green); }
.history-card-info .status-dot.error { background: var(--red); }
.history-card-meta { flex: 1; font-size: .78rem; color: var(--t2); }
.history-card-actions { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }

/* ── Params Form ── */
.comfy-params-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.comfy-param-group { background: var(--bg-in); border: 1px solid var(--bd); border-radius: var(--rs); padding: 12px; }
.comfy-param-group--disabled { opacity: .55; }
.comfy-param-group label { display: block; font-size: .82rem; font-weight: 600; color: var(--t1); margin-bottom: 6px; }
.comfy-param-group select,
.comfy-param-group input[type="number"] { width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--bd); background: var(--bg); color: var(--t1); font-size: .82rem; }

</style>
