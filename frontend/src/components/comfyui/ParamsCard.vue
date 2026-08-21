<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import Spinner from '@/components/ui/Spinner.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import FormField from '@/components/form/FormField.vue'
import BaseInput from '@/components/form/BaseInput.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import VersionCard from './VersionCard.vue'
import type {
  ParamSchema,
  ComfyParamsResponse, ComfyParamsSaveResponse,
} from '@/types/comfyui'

defineOptions({ name: 'ParamsCard' })

const props = defineProps<{
  active?: boolean
}>()

const { t, te } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const extraArgs = ref('')
const paramsSchema = ref<Record<string, ParamSchema>>({})
const paramsCurrent = ref<Record<string, string | number | boolean>>({})
const loading = ref(false)
const saving = ref(false)
const savedSnapshot = ref('')

const LRU_CACHE_SIZE_PRESETS = ['16', '32', '64', '128', '256']

const PARAM_GROUPS = [
  { key: 'memory', icon: 'memory', params: ['vram', 'reserve_vram', 'vram_headroom', 'async_offload', 'dynamic_vram', 'cuda_device'] },
  { key: 'attention', icon: 'bolt', params: ['attention', 'disable_xformers', 'fast', 'upcast_attention'] },
  { key: 'precision', icon: 'tune', params: ['unet_precision', 'vae_precision', 'text_enc_precision', 'fp16_intermediates', 'force_channels_last'] },
  { key: 'cache', icon: 'cached', params: ['cache', 'cache_lru_size'] },
  { key: 'preview', icon: 'preview', params: ['preview_method', 'preview_size'] },
  { key: 'output', icon: 'description', params: ['disable_metadata'] },
  { key: 'disk', icon: 'storage', params: ['fast_disk', 'mmap', 'pinned_memory'] },
  { key: 'network', icon: 'cloud_upload', params: ['max_upload_size'] },
]

onMounted(loadParams)

async function loadParams() {
  loading.value = true
  try {
    const d = await get<ComfyParamsResponse>('/api/comfyui/params')
    if (!d) return
    paramsSchema.value = d.schema || {}
    paramsCurrent.value = d.current || {}
    normalizeCacheLruSize()
    extraArgs.value = extractExtraArgs(d.raw_args || [])
    savedSnapshot.value = formSnapshot()
  } finally {
    loading.value = false
  }
}

function normalizeCacheLruSize() {
  const current = String(paramsCurrent.value.cache_lru_size ?? '')
  if (!LRU_CACHE_SIZE_PRESETS.includes(current) && !/^[1-9]\d*$/.test(current)) {
    paramsCurrent.value.cache_lru_size = '16'
  }
}

function collectParams() {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, schema] of Object.entries(paramsSchema.value)) {
    result[key] = paramsCurrent.value[key] ?? schema.value
  }
  result.listen = paramsCurrent.value.listen || '0.0.0.0'
  result.port = paramsCurrent.value.port || 8188
  return result
}

function knownArgFlags() {
  const withValue = new Set<string>(['--listen', '--port'])
  const standalone = new Set<string>()
  for (const schema of Object.values(paramsSchema.value)) {
    if (schema.flag) standalone.add(schema.flag)
    if (schema.flag_prefix) withValue.add(schema.flag_prefix)
    if (schema.flag_map) Object.values(schema.flag_map).forEach(flag => standalone.add(flag))
  }
  return { withValue, standalone }
}

function extractExtraArgs(raw: string[] | string) {
  const parts = Array.isArray(raw)
    ? raw
    : raw.replace(/^main\.py\s*/, '').split(/\s+/).filter(Boolean)
  const { withValue, standalone } = knownArgFlags()
  const extras: string[] = []
  for (let i = 0; i < parts.length;) {
    if (withValue.has(parts[i])) {
      i += 2
      continue
    }
    if (standalone.has(parts[i])) {
      i += 1
      continue
    }
    if (parts[i] !== 'main.py') extras.push(parts[i])
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
    return { value, label: te(key) ? t(key) : fallbackLabel }
  })
}

function isParamEnabled(schema: ParamSchema) {
  if (!schema.depends_on) return true
  return Object.entries(schema.depends_on).every(([depKey, depValue]) => {
    // 值以 '!' 开头表示「不等于」条件 (如 preview_method != none)
    if (typeof depValue === 'string' && depValue.startsWith('!')) {
      return String(paramsCurrent.value[depKey]) !== depValue.slice(1)
    }
    return String(paramsCurrent.value[depKey]) === String(depValue)
  })
}

function formSnapshot() {
  return JSON.stringify({ params: collectParams(), extra_args: extraArgs.value.trim() })
}

const isDirty = computed(() => !!Object.keys(paramsSchema.value).length && formSnapshot() !== savedSnapshot.value)

const currentCommand = computed(() => {
  const params = collectParams()
  const args = ['main.py', '--listen', String(params.listen), '--port', String(params.port)]
  for (const [key, schema] of Object.entries(paramsSchema.value)) {
    if (!isParamEnabled(schema)) continue
    const value = paramsCurrent.value[key] ?? schema.value
    const mapped = schema.flag_map?.[String(value)]
    if (mapped) args.push(mapped)
    else if (schema.flag_prefix && value !== 'default' && value !== '' && value !== false) {
      // number 类型 0 = 未设置, 不产出 flag (与后端 build_comfyui_args 对齐)
      if (schema.type === 'number' && value === 0) continue
      args.push(schema.flag_prefix, String(value))
    } else if (schema.flag && value === true) {
      args.push(schema.flag)
    }
  }
  return `${args.join(' ')}${extraArgs.value.trim() ? ` ${extraArgs.value.trim()}` : ''}`
})

watch(() => paramsCurrent.value.cache, (cache) => {
  if (cache !== 'lru') paramsCurrent.value.cache_lru_size = '16'
  else normalizeCacheLruSize()
})

async function saveParams(withConfirm = true): Promise<boolean> {
  if (withConfirm && !await confirm({ message: t('comfyui.console.params_save_confirm') })) return false
  saving.value = true
  const d = await post<ComfyParamsSaveResponse>('/api/comfyui/params', {
    params: collectParams(),
    extra_args: extraArgs.value.trim(),
  })
  saving.value = false

  if (d?.ok) {
    savedSnapshot.value = formSnapshot()
    toast(t('comfyui.console.params_restart_toast'), 'success')
    return true
  }

  toast(d?.error || t('comfyui.console.params_save_failed'), 'error')
  return false
}

defineExpose({ saveParams, loadParams, isDirty, saving })
</script>

<template>
  <div class="params-workspace">
    <div v-if="loading && !Object.keys(paramsSchema).length" class="params-loading">
      <Spinner size="md" />
      <span>{{ t('comfyui.console.params_loading') }}</span>
    </div>

    <template v-else>
      <BaseCard variant="bg2" density="roomy" class="runtime-baseline">
        <div class="runtime-command">
          <div class="runtime-section__heading">
            <span class="runtime-section__icon"><MsIcon name="terminal" /></span>
            <h3>{{ t('comfyui.settings.command_preview') }}</h3>
          </div>
          <code class="runtime-command__code">{{ currentCommand }}</code>

          <div class="runtime-extra">
            <div class="runtime-extra__label">
              <span>{{ t('comfyui.settings.extra_args') }}</span>
              <HelpTip :text="t('comfyui.settings.extra_args_desc')" />
            </div>
            <BaseInput
              v-model="extraArgs"
              :placeholder="t('comfyui.settings.extra_args_placeholder')"
              mono
            />
          </div>
        </div>

        <div class="runtime-version">
          <VersionCard :active="active" />
        </div>
      </BaseCard>

      <div class="params-groups">
        <BaseCard
          v-for="group in PARAM_GROUPS"
          :key="group.key"
          variant="bg2"
          density="roomy"
          class="param-group"
        >
          <div class="param-group__heading">
            <span class="param-group__icon"><MsIcon :name="group.icon" /></span>
            <div>
              <h3>{{ t(`comfyui.settings.groups.${group.key}`) }}</h3>
            </div>
          </div>

          <div class="param-group__fields">
            <template v-for="paramKey in group.params" :key="paramKey">
              <FormField
                v-if="paramsSchema[paramKey]"
                layout="horizontal"
                density="compact"
                :class="{ 'param-disabled': !isParamEnabled(paramsSchema[paramKey]) }"
              >
                <template #label>
                  {{ getParamLabel(paramKey, paramsSchema[paramKey]) }}
                  <HelpTip v-if="paramsSchema[paramKey].help" :text="getParamHelp(paramKey, paramsSchema[paramKey])" />
                </template>
                <BaseSelect
                  v-if="paramsSchema[paramKey].type === 'select' || paramKey === 'cache_lru_size'"
                  :modelValue="String(paramsCurrent[paramKey])"
                  @update:modelValue="v => paramsCurrent[paramKey] = v"
                  :options="getParamOptions(paramKey, paramsSchema[paramKey])"
                  :disabled="!isParamEnabled(paramsSchema[paramKey])"
                />
                <NumberInput
                  v-else-if="paramsSchema[paramKey].type === 'number'"
                  :modelValue="Number(paramsCurrent[paramKey]) || 0"
                  @update:modelValue="v => paramsCurrent[paramKey] = v"
                  :spinners="false"
                  :disabled="!isParamEnabled(paramsSchema[paramKey])"
                />
                <BaseInput
                  v-else
                  :modelValue="String(paramsCurrent[paramKey] ?? '')"
                  @update:modelValue="v => paramsCurrent[paramKey] = v"
                  :disabled="!isParamEnabled(paramsSchema[paramKey])"
                />
              </FormField>
            </template>
          </div>
        </BaseCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.params-workspace {
  display: grid;
  gap: var(--sp-4);
}

.params-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  min-height: 220px;
  color: var(--t3);
  font-size: var(--text-sm);
}

.params-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
  align-items: stretch;
}

.runtime-baseline {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr);
  gap: var(--sp-5);
  align-items: stretch;
  --card-py-roomy: 20px;
  --card-px-roomy: 20px;
}

.runtime-command {
  display: grid;
  align-content: start;
  gap: 0;
  min-width: 0;
}

.runtime-extra__label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--t2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.runtime-command__code {
  display: block;
  min-width: 0;
  padding: 9px 11px;
  overflow-x: auto;
  color: var(--t2);
  background: var(--bg-in);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin-bottom: var(--sp-3);
  scrollbar-width: thin;
  white-space: nowrap;
}

.runtime-extra {
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  align-items: center;
  gap: var(--sp-3);
}

.runtime-version {
  min-width: 0;
  padding-left: var(--sp-5);
  border-left: 1px solid var(--bd);
}

.param-group {
  --card-py-roomy: 20px;
  --card-px-roomy: 20px;
}

.runtime-section__heading,
.param-group__heading {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding-bottom: var(--sp-4);
  margin-bottom: var(--sp-3);
  border-bottom: 1px solid var(--bd);
}

.runtime-section__icon,
.param-group__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  color: var(--ac);
  background: color-mix(in srgb, var(--ac) 10%, var(--bg3));
  border-radius: var(--r-md);
}

.runtime-section__icon :deep(.ms),
.param-group__icon :deep(.ms) { font-size: 20px; }

.runtime-section__heading h3,
.param-group h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--t1);
  font-size: var(--text-md);
  font-weight: 600;
}

.param-group__fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.param-group__fields :deep(.form-field--h) {
  min-height: 42px;
  margin-bottom: 4px;
}

.param-group__fields :deep(.form-field__h-left) {
  min-width: 130px;
}

.param-group__fields :deep(.form-field__h-right) {
  width: min(52%, 240px);
}

.param-group__fields :deep(.base-select) { width: 100%; }
/* NumberInput 根是 flex 自适应容器, 撑满右侧控件区与 select/input 对齐 */
.param-group__fields :deep(.number-input) { width: 100%; }
.param-disabled { opacity: .45; }

@media (max-width: 900px) {
  .params-groups { grid-template-columns: 1fr; }

  .runtime-baseline {
    grid-template-columns: 1fr;
  }

  .runtime-version {
    padding-top: var(--sp-4);
    padding-left: 0;
    border-top: 1px solid var(--bd);
    border-left: none;
  }
}

@media (max-width: 640px) {
  .runtime-extra {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .param-group__fields :deep(.form-field--h) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .param-group__fields :deep(.form-field__h-right) {
    width: 100%;
  }
}
</style>
