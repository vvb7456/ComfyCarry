<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import Spinner from '@/components/ui/Spinner.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import type {
  ComfyStatus, ParamSchema,
  ComfyParamsResponse, ComfyParamsSaveResponse,
  ComfyVersionsResponse, ComfyVersionSwitchResponse,
} from '@/types/comfyui'

defineOptions({ name: 'SettingsTab' })

const props = defineProps<{
  status: ComfyStatus | null
}>()

const { t, te } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ── 版本管理 ──────────────────────────────────────────────────

const versions = ref<string[]>([])
const currentVersion = ref<string | null>(null)
const latestVersion = ref<string | null>(null)
const hasGit = ref(true)
const versionsLoading = ref(false)
const switching = ref(false)
const switchTarget = ref<string | null>(null)

// 翻页
const PAGE_SIZE = 10
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(versions.value.length / PAGE_SIZE)))
const pagedVersions = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return versions.value.slice(start, start + PAGE_SIZE)
})

/**
 * 从 git describe 格式 (e.g. "v0.16.4-3-ge4b0bb83") 中提取基础 tag。
 * 精确 tag 或 "nightly" 直接返回。
 */
function baseTag(version: string | null): string | null {
  if (!version) return null
  // exact semver tag or "nightly"
  if (/^v\d+\.\d+\.\d+$/.test(version) || version === 'nightly') return version
  // git describe format: vX.Y.Z-N-gHASH → extract vX.Y.Z
  const m = version.match(/^(v\d+\.\d+\.\d+)-\d+-g[0-9a-f]+$/)
  return m ? m[1] : null
}

async function loadVersions() {
  versionsLoading.value = true
  try {
    const d = await get<ComfyVersionsResponse>('/api/comfyui/versions')
    if (d) {
      versions.value = d.versions
      currentVersion.value = d.current
      latestVersion.value = d.latest
      hasGit.value = d.has_git
    }
  } finally {
    versionsLoading.value = false
  }
}

async function switchVersion(tag: string) {
  const confirmMsg = tag === 'nightly'
    ? t('comfyui.settings.switch_confirm_nightly')
    : t('comfyui.settings.switch_confirm', { version: tag })
  const result = await confirm({
    message: confirmMsg,
    confirmText: t('comfyui.settings.switch_only'),
    altText: t('comfyui.settings.switch_and_install'),
    altVariant: 'primary',
  })
  if (!result) return
  const installDeps = result === 'alt'

  switching.value = true
  switchTarget.value = tag
  try {
    const d = await post<ComfyVersionSwitchResponse>('/api/comfyui/switch', {
      version: tag,
      install_deps: installDeps,
    })
    if (d?.ok) {
      toast(d.message || t('comfyui.settings.switch_success'), 'success')
      if (d.warning) toast(d.warning, 'warning')
      currentVersion.value = d.current || tag
    } else {
      toast(d?.error || t('comfyui.settings.switch_failed'), 'error')
    }
  } finally {
    switching.value = false
    switchTarget.value = null
  }
}

function versionLabel(v: string) {
  if (v === 'nightly') return 'nightly (master)'
  return v
}

function isCurrentVersion(v: string) {
  if (v === currentVersion.value) return true
  return v === baseTag(currentVersion.value)
}

function isLatestVersion(v: string) {
  return v === latestVersion.value
}

// ── 启动参数 ──────────────────────────────────────────────────

const rawArgs = ref('')
const paramsSchema = ref<Record<string, ParamSchema>>({})
const paramsCurrent = ref<Record<string, string | number | boolean>>({})
const paramsStatus = ref('')
const paramsStatusColor = ref('var(--t3)')
let paramsStatusTimer: ReturnType<typeof setTimeout> | null = null
const LRU_CACHE_SIZE_PRESETS = ['16', '32', '64', '128', '256']

// 参数分组 (前端硬编码)
const PARAM_GROUPS = [
  { key: 'memory', icon: 'memory', params: ['vram', 'attention', 'disable_xformers', 'fast'] },
  { key: 'precision', icon: 'tune', params: ['unet_precision', 'vae_precision', 'text_enc_precision'] },
  { key: 'cache', icon: 'cached', params: ['cache', 'cache_lru_size'] },
  { key: 'preview', icon: 'preview', params: ['preview_method'] },
]

watch(() => props.status, (s) => {
  if (s) rawArgs.value = (s.args || []).join(' ')
})

onMounted(() => {
  loadVersions()
  loadParams()
})

onUnmounted(() => {
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

defineExpose({ saveParams, loadParams })
</script>

<template>
  <div class="settings-sections">
    <!-- Section 1: Launch Parameters -->
    <BaseCard variant="bg2" density="roomy">
      <SectionHeader icon="settings" flush>
        {{ t('comfyui.console.params') }}
        <HelpTip :text="t('comfyui.console.params_restart_hint')" />
        <template #actions>
          <span :style="{ color: paramsStatusColor, fontSize: '.78rem' }">{{ paramsStatus }}</span>
          <BaseButton size="sm" variant="primary" @click="saveParams()">
            <MsIcon name="save" size="xs" color="none" /> {{ t('common.btn.save') }}
          </BaseButton>
        </template>
      </SectionHeader>

      <div class="params-content">
        <div style="margin-bottom: 12px">
          <FormField :label="t('comfyui.settings.raw_args')" density="compact">
            <input
              v-model="rawArgs"
              type="text"
              :placeholder="t('comfyui.console.params_placeholder')"
              class="form-input form-input--mono"
            >
          </FormField>
        </div>

        <div v-if="Object.keys(paramsSchema).length" class="params-groups">
          <CollapsibleGroup
            v-for="group in PARAM_GROUPS" :key="group.key"
            :title="t(`comfyui.settings.groups.${group.key}`)"
            :icon="group.icon"
            :default-open="true"
          >
            <div class="params-group-fields">
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
                  <input
                    v-else-if="paramsSchema[paramKey].type === 'number'"
                    type="number"
                    v-model.number="paramsCurrent[paramKey]"
                    class="form-number"
                    :disabled="!isParamEnabled(paramsSchema[paramKey])"
                  >
                  <input
                    v-else
                    type="text"
                    v-model="paramsCurrent[paramKey]"
                    class="form-input"
                    :disabled="!isParamEnabled(paramsSchema[paramKey])"
                  >
                </FormField>
              </template>
            </div>
          </CollapsibleGroup>
        </div>
        <div v-else-if="status" style="color:var(--t3);font-size:.85rem;padding:8px 0">
          {{ t('comfyui.console.params_loading') }}
        </div>
      </div>
    </BaseCard>

    <!-- Section 2: Version Management -->
    <BaseCard variant="bg2" density="roomy">
      <SectionHeader icon="update" flush>
        {{ t('comfyui.settings.version_title') }}
      </SectionHeader>

      <div v-if="!hasGit" class="version-no-git">
        <MsIcon name="error" size="sm" />
        {{ t('comfyui.settings.no_git') }}
      </div>

      <template v-else>
        <CollapsibleGroup
          :title="t('comfyui.settings.available_versions')"
          icon="sell"
          :count="versions.length"
          :default-open="true"
        >
          <div v-if="versionsLoading && !versions.length" class="version-loading">
            <Spinner size="sm" />
          </div>

          <div v-else-if="!versions.length" class="version-empty">
            {{ t('comfyui.settings.no_versions') }}
          </div>

          <template v-else>
            <div class="version-list">
              <div
                v-for="v in pagedVersions" :key="v"
                class="version-item"
                :class="{
                  'version-item--current': isCurrentVersion(v),
                  'version-item--nightly': v === 'nightly',
                }"
              >
                <div class="version-item__info">
                  <span class="version-item__name">{{ versionLabel(v) }}</span>
                  <Badge v-if="isCurrentVersion(v)" color="var(--green)">{{ t('comfyui.settings.current') }}</Badge>
                  <Badge v-if="isLatestVersion(v) && !isCurrentVersion(v)" color="var(--blue)">{{ t('comfyui.settings.latest') }}</Badge>
                  <Badge v-if="v === 'nightly'" color="var(--amber)">{{ t('comfyui.settings.unstable') }}</Badge>
                </div>
                <div class="version-item__actions">
                  <BaseButton
                    v-if="!isCurrentVersion(v)"
                    size="xs"
                    @click="switchVersion(v)"
                    :loading="switching && switchTarget === v"
                    :disabled="switching"
                  >
                    {{ t('comfyui.settings.switch') }}
                  </BaseButton>
                </div>
              </div>
            </div>

            <!-- 分页 -->
            <div v-if="totalPages > 1" class="version-pagination">
              <BaseButton size="xs" :disabled="currentPage <= 1" @click="currentPage--">
                <MsIcon name="chevron_left" size="xs" />
              </BaseButton>
              <span class="version-pagination__info">{{ currentPage }} / {{ totalPages }}</span>
              <BaseButton size="xs" :disabled="currentPage >= totalPages" @click="currentPage++">
                <MsIcon name="chevron_right" size="xs" />
              </BaseButton>
            </div>
          </template>
        </CollapsibleGroup>
      </template>
    </BaseCard>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────── */
.settings-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Version Section ─────────────────────────────── */
.version-no-git {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--red);
  font-size: var(--text-sm);
  padding: 12px;
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border-radius: var(--r-md);
}

.version-loading,
.version-empty {
  padding: 24px;
  text-align: center;
  color: var(--t3);
  font-size: var(--text-sm);
}

.version-list {
  display: flex;
  flex-direction: column;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--bd);
  transition: background .15s;
}
.version-item:last-child { border-bottom: none; }
.version-item:hover { background: color-mix(in srgb, var(--ac) 4%, transparent); }

.version-item--current {
  background: color-mix(in srgb, var(--green) 6%, transparent);
}
.version-item--current:hover {
  background: color-mix(in srgb, var(--green) 10%, transparent);
}

.version-item__info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.version-item__name {
  font-weight: 500;
  color: var(--t1);
  font-family: var(--font-mono, monospace);
}

.version-item--nightly .version-item__name { color: var(--amber); }

.version-item__actions {
  flex-shrink: 0;
}

/* ── Pagination ──────────────────────────────────── */
.version-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 0 4px;
  border-top: 1px solid var(--bd);
}

.version-pagination__info {
  font-size: var(--text-xs);
  color: var(--t3);
  font-variant-numeric: tabular-nums;
}

/* ── Params Section ──────────────────────────────── */
.params-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.params-groups :deep(.collapsible-group) {
  flex: 1 1 220px;
  min-width: 220px;
}

.params-group-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.params-group-fields :deep(.form-field--h) {
  align-items: center;
}

.params-group-fields :deep(.form-field__h-left) {
  min-width: 120px;
  max-width: 160px;
}

.params-group-fields :deep(.form-field__h-right) {
  flex: 1;
  max-width: 200px;
}

.param-disabled { opacity: 0.5; }

.form-number {
  width: 100%;
  text-align: right;
}
.form-number::-webkit-outer-spin-button,
.form-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
</style>
