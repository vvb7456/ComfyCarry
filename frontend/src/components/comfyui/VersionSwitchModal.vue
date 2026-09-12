<script setup lang="ts">
/**
 * VersionSwitchModal — ComfyUI 版本切换弹窗 (C08, 需求 8.1)。
 *
 * 由原 VersionCard 的选择 + 切换逻辑迁入: 版本用可搜索的 BaseSelect 呈现
 * (稳定版 / nightly / 历史版本分组), 切换沿用「仅切换 / 切换并安装依赖」
 * 两种操作与各自的确认流程。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import Spinner from '@/components/ui/Spinner.vue'
import BaseSelect, { type SelectOption } from '@/components/form/BaseSelect.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiMessageText, apiWarningText, apiErrorText } from '@/utils/apiError'
import type { ComfyVersionsResponse, ComfyVersionSwitchResponse } from '@/types/comfyui'
import type { ConfirmResult } from '@/composables/useConfirm'

defineOptions({ name: 'VersionSwitchModal' })

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const versions = ref<string[]>([])
const currentVersion = ref<string | null>(null)
const latestVersion = ref<string | null>(null)
const hasGit = ref(true)
const versionsLoading = ref(false)
const switching = ref(false)
const switchTarget = ref<string | null>(null)
const selectedVersion = ref('')
const loaded = ref(false)

const currentIsCustom = computed(() => {
  const current = currentVersion.value
  return !!current && current !== 'nightly' && !/^v\d+\.\d+\.\d+$/.test(current)
})

const versionOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = []

  if (latestVersion.value) {
    options.push({
      value: latestVersion.value,
      label: latestVersion.value,
      group: t('comfyui.settings.stable_channel'),
      hint: currentVersion.value === latestVersion.value
        ? t('comfyui.settings.current')
        : t('comfyui.settings.recommended'),
      icon: 'verified',
    })
  }

  options.push({
    value: 'nightly',
    label: 'nightly',
    group: t('comfyui.settings.nightly_channel'),
    hint: currentVersion.value === 'nightly'
      ? t('comfyui.settings.current')
      : t('comfyui.settings.unstable'),
    icon: 'experiment',
  })

  const historical = versions.value.filter(v => v !== latestVersion.value && v !== 'nightly')
  historical.forEach((version) => {
    options.push({
      value: version,
      label: version,
      group: t('comfyui.settings.other_versions'),
      hint: currentVersion.value === version ? t('comfyui.settings.current') : undefined,
    })
  })

  const current = currentVersion.value
  if (current && currentIsCustom.value && !options.some(o => o.value === current)) {
    options.push({
      value: current,
      label: current,
      group: t('comfyui.version.current'),
      hint: t('comfyui.settings.custom_build'),
      disabled: true,
      icon: 'deployed_code',
    })
  }

  return options
})

const selectedIsCurrent = computed(() => !!selectedVersion.value && selectedVersion.value === currentVersion.value)

async function loadVersions() {
  if (versionsLoading.value) return
  versionsLoading.value = true
  try {
    const d = await get<ComfyVersionsResponse>('/api/comfyui/versions')
    if (d) {
      versions.value = d.versions || []
      currentVersion.value = d.current
      latestVersion.value = d.latest
      hasGit.value = d.has_git
      selectedVersion.value = d.current || ''
      loaded.value = true
    }
  } finally {
    versionsLoading.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) void loadVersions()
})

async function switchSelectedVersion() {
  const tag = selectedVersion.value
  if (!tag || selectedIsCurrent.value) return
  const result: ConfirmResult = await confirm({
    title: t('comfyui.confirm.switch_version.title'),
    message: t('comfyui.confirm.switch_version.message', { version: tag }),
    confirmText: t('comfyui.confirm.switch_version.button'),
    altText: t('comfyui.confirm.switch_version.alt'),
    altVariant: 'primary',
  })
  if (!result) {
    selectedVersion.value = currentVersion.value || ''
    return
  }

  switching.value = true
  switchTarget.value = tag
  let applied = false
  try {
    const d = await post<ComfyVersionSwitchResponse>('/api/comfyui/switch', {
      version: tag,
      install_deps: result === 'alt',
    })
    // 非 2xx 已由 useApiFetch 统一提示; 这里只判业务层 ok (finally 会回弹选择)
    if (!d) return
    if (d.ok) {
      applied = true
      toast(apiMessageText(d, t('comfyui.settings.switch_success')), 'success')
      const warnText = apiWarningText(d)
      if (warnText) toast(warnText, 'warning')
      currentVersion.value = d.current || tag
      emit('saved')
      emit('update:modelValue', false)
    } else {
      toast(apiErrorText(d, t('comfyui.settings.switch_failed')), 'error')
    }
  } finally {
    if (!applied) selectedVersion.value = currentVersion.value || ''
    switching.value = false
    switchTarget.value = null
  }
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('comfyui.version.switch_title')"
    width="520px"
    :close-on-overlay="!switching"
    :close-on-esc="!switching"
    @update:model-value="emit('update:modelValue', false)"
  >
    <div v-if="versionsLoading && !loaded" class="version-loading">
      <Spinner size="sm" />
      <span>{{ t('common.status.loading') }}</span>
    </div>

    <AlertBanner v-else-if="!hasGit" tone="danger" icon="error">
      {{ t('comfyui.settings.no_git') }}
    </AlertBanner>

    <BaseSelect
      v-else-if="loaded"
      v-model="selectedVersion"
      :options="versionOptions"
      :placeholder="t('comfyui.settings.channels_title')"
      :search-placeholder="t('comfyui.settings.available_versions')"
      :empty-text="t('comfyui.settings.no_versions')"
      :max-list-height="260"
      :disabled="switching"
      searchable
      teleport
    />

    <template #footer>
      <BaseButton :disabled="switching" @click="emit('update:modelValue', false)">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!hasGit || !selectedVersion || selectedIsCurrent || versionsLoading"
        :loading="switching"
        @click="switchSelectedVersion"
      >
        {{ t('comfyui.settings.switch') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.version-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  min-height: 120px;
  color: var(--t3);
  font-size: var(--text-sm);
}
</style>
