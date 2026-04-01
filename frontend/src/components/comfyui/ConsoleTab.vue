<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import type { ExecState } from '@/composables/useExecTracker'
import LogPanel from '@/components/ui/LogPanel.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import StatCard from '@/components/ui/StatCard.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import type {
  ComfyStatus, ParamSchema,
  ComfyParamsResponse, ComfyParamsSaveResponse,
} from '@/types/comfyui'

defineOptions({ name: 'ConsoleTab' })

const props = defineProps<{
  status: ComfyStatus | null
  execState: ExecState | null
  elapsed: number
}>()

const { t, te } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// Card status
const comfyCardStatus = computed<'info' | 'running' | 'stopped' | 'loading' | 'error'>(() => {
  if (!props.status) return 'info'
  if (props.status.online) return props.execState ? 'loading' : 'running'
  if (props.status.pm2_status === 'errored') return 'error'
  if (props.status.pm2_status === 'online') return 'info'
  return 'stopped'
})

// Params
const rawArgs = ref('')
const paramsSchema = ref<Record<string, ParamSchema>>({})
const paramsCurrent = ref<Record<string, string | number | boolean>>({})
const paramsStatus = ref('')
const paramsStatusColor = ref('var(--t3)')
let paramsStatusTimer: ReturnType<typeof setTimeout> | null = null
const LRU_CACHE_SIZE_PRESETS = ['16', '32', '64', '128', '256']

// Sync rawArgs from status
watch(() => props.status, (s) => {
  if (s) rawArgs.value = (s.args || []).join(' ')
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

onMounted(() => {
  loadParams()
  logStream.start()
})

onUnmounted(() => {
  logStream.stop()
  if (paramsStatusTimer) {
    clearTimeout(paramsStatusTimer)
    paramsStatusTimer = null
  }
})

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
  paramsStatusTimer = setTimeout(clearParamsStatus, delay)
}

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
    toast(t('comfyui.console.params_restart_toast'), 'success')
    scheduleParamsStatusClear()
    return true
  } else {
    paramsStatus.value = d?.error || t('comfyui.console.params_save_failed')
    paramsStatusColor.value = 'var(--red)'
    return false
  }
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

defineExpose({ saveParams, loadParams })
</script>

<template>
  <!-- Status cards -->
  <div class="stat-grid" v-if="status">
    <StatCard label="ComfyUI" :status="comfyCardStatus" value-size="sm">
      <template #value>{{ status.online ? (execState ? t('comfyui.status.generating') : t('comfyui.status.idle')) : t('comfyui.status.stopped') }}</template>
      <template #sub v-if="status.online">
        v{{ status.system?.comfyui_version || '?' }} · Python {{ status.system?.python_version || '?' }} · PyTorch {{ status.system?.pytorch_version || '?' }}
      </template>
      <template #sub v-else>PM2: {{ status.pm2_status }}</template>
    </StatCard>

    <StatCard v-for="(dev, i) in status.devices" :key="i" :label="dev.name || 'GPU'">
      <template #value>{{ dev.vram_total > 0 ? (((dev.vram_total - dev.vram_free) / dev.vram_total) * 100).toFixed(0) + '%' : '—' }}</template>
      <template #sub>
        VRAM: {{ fmtBytes(dev.vram_total - dev.vram_free) }} / {{ fmtBytes(dev.vram_total) }} · Torch: {{ fmtBytes(dev.torch_vram_total - dev.torch_vram_free) }}
      </template>
      <UsageBar :percent="dev.vram_total > 0 ? ((dev.vram_total - dev.vram_free) / dev.vram_total * 100) : 0" />
    </StatCard>

    <StatCard v-if="status.pm2_uptime" :label="t('comfyui.console.uptime')" value-size="sm">
      <template #value>{{ fmtUptime(status.pm2_uptime) }}</template>
      <template #sub>{{ t('comfyui.console.restart_count', { count: status.pm2_restarts || 0 }) }}</template>
    </StatCard>
  </div>

  <!-- Exec progress bar -->
  <ComfyProgressBar :state="execState" :elapsed="elapsed" />

  <!-- Params Section -->
  <SectionHeader icon="settings">
    {{ t('comfyui.console.params') }}
    <HelpTip :text="t('comfyui.console.params_restart_hint')" />
    <template #actions>
      <span :style="{ color: paramsStatusColor, fontSize: '.78rem' }">{{ paramsStatus }}</span>
    </template>
  </SectionHeader>

  <div style="margin-bottom:8px">
    <input
      v-model="rawArgs"
      type="text"
      :placeholder="t('comfyui.console.params_placeholder')"
      class="form-input form-input--mono"
    >
  </div>

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
        <BaseSelect
          v-if="schema.type === 'select' || String(key) === 'cache_lru_size'"
          :modelValue="String(paramsCurrent[key])"
          @update:modelValue="v => paramsCurrent[key] = v"
          :options="getParamOptions(String(key), schema)"
          :disabled="!isParamEnabled(schema)"
          class="comfy-param-select"
        />
        <input v-else-if="schema.type === 'number'" type="number" v-model.number="paramsCurrent[key]" class="form-number comfy-param-number" :disabled="!isParamEnabled(schema)">
        <input v-else type="text" v-model="paramsCurrent[key]" class="form-input" :disabled="!isParamEnabled(schema)">
      </FormField>
    </div>
  </div>
  <div v-else-if="status" style="color:var(--t3);font-size:.82rem;padding:8px 0">{{ t('comfyui.console.params_loading') }}</div>

  <!-- Log -->
  <SectionHeader icon="receipt_long">{{ t('comfyui.console.log_title') }}</SectionHeader>
  <LogPanel :lines="logStream.lines.value" :status="logStream.status.value" />
</template>

<style scoped>
.comfy-param-group :deep(.form-field) { margin-bottom: 0; }

.comfy-param-number { text-align: right; }
.comfy-param-number::-webkit-outer-spin-button,
.comfy-param-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.comfy-params-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.comfy-param-group { background: var(--bg-in); border: 1px solid var(--bd); border-radius: var(--rs); padding: 12px; }
.comfy-param-group--disabled { opacity: .55; }
.comfy-param-group label { display: block; font-size: .82rem; font-weight: 600; color: var(--t1); margin-bottom: 6px; }
.comfy-param-group select,
.comfy-param-group input[type="number"] { width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--bd); background: var(--bg); color: var(--t1); font-size: .82rem; }
</style>
