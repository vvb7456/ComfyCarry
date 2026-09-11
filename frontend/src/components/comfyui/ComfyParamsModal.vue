<script setup lang="ts">
/**
 * ComfyParamsModal — ComfyUI 启动参数弹窗 (C08, 需求 8.3 / 实施计划 2.5)。
 *
 * 原 ParamsCard 的表单迁入 600px BaseModal, 字段按「显存与内存 / 精度 / 速度与缓存 /
 * 其他」四组组织。字段控件、默认值与 depends_on 联动仍取后端 schema。
 * 修改过的分组在分组标签上显示圆点; 底部显示已修改项数 + 取消 + 保存并重启。
 * 保存需重启 ComfyUI 是按钮明示的常识, 取消 / Esc / 遮罩 / 关闭按钮一律丢弃改动直接关闭。
 *
 * 表单状态保留在本组件内: 组件常驻挂载, BaseModal 关闭只销毁插槽, 不销毁这里的 ref。
 * 保存成功通过 saved 事件把新的启动命令回传主页。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Spinner from '@/components/ui/Spinner.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import FormField from '@/components/form/FormField.vue'
import BaseInput from '@/components/form/BaseInput.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import {
  LRU_CACHE_SIZE_PRESETS,
  collectParams,
  extractExtraArgs,
  isParamEnabled,
  type ParamValue,
} from './paramsCommand'
import type {
  ParamSchema,
  ComfyParamsResponse, ComfyParamsSaveResponse,
} from '@/types/comfyui'

defineOptions({ name: 'ComfyParamsModal' })

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功: 新的启动命令行 */
  saved: [command: string]
}>()

const { t, te } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const PARAM_GROUPS = [
  { key: 'vram', params: ['vram', 'reserve_vram', 'vram_headroom', 'async_offload', 'dynamic_vram', 'cuda_device', 'fast_disk', 'mmap', 'pinned_memory'] },
  { key: 'precision', params: ['unet_precision', 'vae_precision', 'text_enc_precision', 'fp16_intermediates', 'force_channels_last'] },
  { key: 'speed', params: ['attention', 'disable_xformers', 'fast', 'upcast_attention', 'cache', 'cache_lru_size'] },
  { key: 'misc', params: ['preview_method', 'preview_size', 'disable_metadata', 'max_upload_size'] },
] as const

const activeGroup = ref<string>('vram')

const paramsSchema = ref<Record<string, ParamSchema>>({})
const paramsCurrent = ref<Record<string, ParamValue>>({})
const savedCurrent = ref<Record<string, ParamValue>>({})
const extraArgs = ref('')
const savedExtraArgs = ref('')
const loading = ref(false)
const loadError = ref(false)
const loaded = ref(false)
const saving = ref(false)

function cloneParams(source: Record<string, ParamValue>): Record<string, ParamValue> {
  return JSON.parse(JSON.stringify(source)) as Record<string, ParamValue>
}

async function loadParams() {
  if (loading.value) return
  loading.value = true
  loadError.value = false
  loaded.value = false
  const d = await get<ComfyParamsResponse>('/api/comfyui/params')
  loading.value = false
  if (!d) {
    loadError.value = true
    return
  }
  paramsSchema.value = d.schema || {}
  paramsCurrent.value = { ...(d.current || {}) }
  normalizeCacheLruSize()
  // 缓存策略非 LRU 时, 大小字段取默认基线, 避免 watch 异步触发把表单误标为已修改
  if (paramsCurrent.value.cache !== 'lru') paramsCurrent.value.cache_lru_size = '16'
  extraArgs.value = extractExtraArgs(d.raw_args || [], paramsSchema.value)
  savedCurrent.value = cloneParams(paramsCurrent.value)
  savedExtraArgs.value = extraArgs.value
  loaded.value = true
}

watch(() => props.modelValue, (open) => {
  if (open) void loadParams()
})

function normalizeCacheLruSize() {
  const current = String(paramsCurrent.value.cache_lru_size ?? '')
  if (!LRU_CACHE_SIZE_PRESETS.includes(current) && !/^[1-9]\d*$/.test(current)) {
    paramsCurrent.value.cache_lru_size = '16'
  }
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

function paramEnabled(paramKey: string): boolean {
  const schema = paramsSchema.value[paramKey]
  if (!schema) return true
  return isParamEnabled(schema, paramsCurrent.value)
}

// ── 修改跟踪 ─────────────────────────────────────────────────
function isDirtyKey(paramKey: string): boolean {
  const schema = paramsSchema.value[paramKey]
  if (!schema) return false
  const saved = savedCurrent.value[paramKey] ?? schema.value
  const current = paramsCurrent.value[paramKey] ?? schema.value
  return String(current) !== String(saved)
}

const dirtyKeys = computed(() => Object.keys(paramsSchema.value).filter(isDirtyKey))
const extraDirty = computed(() => loaded.value && extraArgs.value.trim() !== savedExtraArgs.value.trim())
const isDirty = computed(() => loaded.value && (dirtyKeys.value.length > 0 || extraDirty.value))
const dirtyCount = computed(() => dirtyKeys.value.length + (extraDirty.value ? 1 : 0))

function groupDirty(groupKey: string): boolean {
  const group = PARAM_GROUPS.find(g => g.key === groupKey)
  if (!group) return false
  if (groupKey === 'misc' && extraDirty.value) return true
  return group.params.some(key => dirtyKeys.value.includes(key))
}

const activeParams = computed(() => {
  const group = PARAM_GROUPS.find(g => g.key === activeGroup.value) || PARAM_GROUPS[0]
  return group.params as readonly string[]
})

const groupOptions = computed(() =>
  PARAM_GROUPS.map(g => ({
    value: g.key,
    label: t(`comfyui.params.groups.${g.key}`),
    dot: groupDirty(g.key),
  })),
)

// cache 策略变化时同步 lru 大小 (与后端默认值口径一致)
watch(() => paramsCurrent.value.cache, (cache) => {
  if (cache !== 'lru') paramsCurrent.value.cache_lru_size = '16'
  else normalizeCacheLruSize()
})

// ── 操作 ─────────────────────────────────────────────────────
function discardChanges() {
  paramsCurrent.value = cloneParams(savedCurrent.value)
  extraArgs.value = savedExtraArgs.value
  normalizeCacheLruSize()
}

/** 取消: 丢弃全部改动并直接关闭 (footer 取消按钮) */
function cancelAndClose() {
  if (saving.value) return
  discardChanges()
  emit('update:modelValue', false)
}

async function save() {
  if (!await confirm({ message: t('comfyui.params.save_confirm') })) return
  saving.value = true
  const d = await post<ComfyParamsSaveResponse>('/api/comfyui/params', {
    params: collectParams(paramsSchema.value, paramsCurrent.value),
    extra_args: extraArgs.value.trim(),
  })
  saving.value = false
  if (d?.ok) {
    savedCurrent.value = cloneParams(paramsCurrent.value)
    savedExtraArgs.value = extraArgs.value
    toast(t('comfyui.params.restart_toast'), 'success')
    emit('saved', d.args || '')
    emit('update:modelValue', false)
  } else {
    toast(d?.error || t('comfyui.params.save_failed'), 'error')
  }
}

/**
 * 关闭 (Esc / 遮罩 / 关闭按钮): 与取消一致 —— 丢弃全部改动后直接关闭。
 * 保存需重启 ComfyUI 是按钮明示的常识, 关闭即放弃, 无需二次确认守卫。
 */
function requestClose() {
  cancelAndClose()
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('comfyui.params.title')"
    width="600px"
    :close-on-overlay="!saving"
    :close-on-esc="!saving"
    @update:model-value="requestClose()"
  >
    <div v-if="loading && !loaded" class="params-loading">
      <Spinner size="md" />
      <span>{{ t('comfyui.params.loading') }}</span>
    </div>

    <EmptyState v-else-if="loadError" icon="cloud_off" :message="t('common.load_failed')">
      <BaseButton size="sm" @click="loadParams">{{ t('common.btn.retry') }}</BaseButton>
    </EmptyState>

    <template v-else-if="loaded">
      <SegmentedControl
        v-model="activeGroup"
        :options="groupOptions"
        block
        class="param-group-switch"
      />

      <div class="param-list">
        <template v-for="paramKey in activeParams" :key="paramKey">
          <FormField
            v-if="paramsSchema[paramKey]"
            layout="horizontal"
            density="compact"
            :class="{ 'param-disabled': !paramEnabled(paramKey) }"
          >
            <template #label>
              {{ getParamLabel(paramKey, paramsSchema[paramKey]) }}
              <HelpTip v-if="paramsSchema[paramKey].help" :text="getParamHelp(paramKey, paramsSchema[paramKey])" />
            </template>
            <BaseSelect
              v-if="paramsSchema[paramKey].type === 'select' || paramKey === 'cache_lru_size'"
              :model-value="String(paramsCurrent[paramKey])"
              :options="getParamOptions(paramKey, paramsSchema[paramKey])"
              :disabled="!paramEnabled(paramKey)"
              @update:model-value="v => paramsCurrent[paramKey] = v"
            />
            <NumberInput
              v-else-if="paramsSchema[paramKey].type === 'number'"
              :model-value="Number(paramsCurrent[paramKey]) || 0"
              :spinners="false"
              :disabled="!paramEnabled(paramKey)"
              @update:model-value="v => paramsCurrent[paramKey] = v"
            />
            <BaseInput
              v-else
              :model-value="String(paramsCurrent[paramKey] ?? '')"
              :disabled="!paramEnabled(paramKey)"
              @update:model-value="v => paramsCurrent[paramKey] = v"
            />
          </FormField>
        </template>

        <FormField
          v-if="activeGroup === 'misc'"
          layout="horizontal"
          density="compact"
        >
          <template #label>
            {{ t('comfyui.params.extra_args') }}
            <HelpTip :text="t('comfyui.params.extra_args_desc')" />
          </template>
          <BaseInput
            v-model="extraArgs"
            mono
            :placeholder="t('comfyui.params.extra_args_placeholder')"
          />
        </FormField>
      </div>
    </template>

    <template #footer>
      <span class="param-footer-note">
        {{ dirtyCount ? t('comfyui.params.changed', { count: dirtyCount }) : t('comfyui.params.unchanged') }}
      </span>
      <BaseButton :disabled="saving" @click="cancelAndClose">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!isDirty || loading || loadError"
        :loading="saving"
        @click="save"
      >
        {{ t('comfyui.params.save_restart') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.params-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  min-height: 180px;
  color: var(--t3);
  font-size: var(--text-sm);
}

/* 分组切换全宽, 与下方参数列表拉开间距 */
.param-group-switch {
  margin-bottom: var(--sp-3);
}

.param-list {
  display: flex;
  flex-direction: column;
}

.param-list :deep(.form-field--h) {
  min-height: 44px;
  margin-bottom: 0;
  padding: 8px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--bd) 55%, transparent);
}

.param-list :deep(.form-field--h:last-child) {
  border-bottom: 0;
}

.param-list :deep(.form-field__h-left) {
  min-width: 150px;
}

.param-list :deep(.form-field__h-right) {
  width: min(56%, 260px);
}

.param-list :deep(.base-select),
.param-list :deep(.number-input) {
  width: 100%;
}

.param-disabled {
  opacity: .45;
}

.param-footer-note {
  margin-right: auto;
  align-self: center;
  color: var(--t3);
  font-size: var(--text-xs);
}

@media (max-width: 560px) {
  .param-list :deep(.form-field--h) {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .param-list :deep(.form-field__h-right) {
    width: 100%;
  }
}
</style>
