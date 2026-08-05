<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiMessageText, apiWarningText, apiErrorText } from '@/utils/apiError'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import Spinner from '@/components/ui/Spinner.vue'
import BaseSelect, { type SelectOption } from '@/components/form/BaseSelect.vue'
import type {
  ComfyVersionsResponse, ComfyVersionSwitchResponse,
} from '@/types/comfyui'
import type { ConfirmResult } from '@/composables/useConfirm'

defineOptions({ name: 'VersionCard' })

const props = defineProps<{ active?: boolean }>()

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

const currentIsNightly = computed(() => currentVersion.value === 'nightly')
const currentIsRelease = computed(() => /^v\d+\.\d+\.\d+$/.test(currentVersion.value || ''))
const currentIsCustom = computed(() => {
  const current = currentVersion.value
  return !!current && current !== 'nightly' && !/^v\d+\.\d+\.\d+$/.test(current)
})

/**
 * Keep every switch target in one searchable menu. Group metadata is rendered
 * by BaseSelect as non-clickable headings, so stable/nightly/history stay
 * visually distinct without taking up separate cards or a paginated list.
 */
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

  // A detached commit/hash cannot be selected as a checkout target, but it
  // should still be represented when it is the active build so the select
  // remains truthful instead of showing an unexplained empty value.
  const current = currentVersion.value
  if (current && currentIsCustom.value && !options.some(o => o.value === current)) {
    options.push({
      value: current,
      label: current,
      group: t('comfyui.settings.current_version'),
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
      // Keep the select anchored to the active build after refresh/switch.
      selectedVersion.value = d.current || ''
      loaded.value = true
    }
  } finally {
    versionsLoading.value = false
  }
}

function activateWorkspace() {
  if (props.active && !loaded.value) loadVersions()
}

onMounted(activateWorkspace)
watch(() => props.active, activateWorkspace)

async function switchVersion(tag: string) {
  const confirmMsg = tag === 'nightly'
    ? t('comfyui.settings.switch_confirm_nightly')
    : t('comfyui.settings.switch_confirm', { version: tag })
  const result: ConfirmResult = await confirm({
    message: confirmMsg,
    confirmText: t('comfyui.settings.switch_only'),
    altText: t('comfyui.settings.switch_and_install'),
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
    if (d?.ok) {
      applied = true
      toast(apiMessageText(d, t('comfyui.settings.switch_success')), 'success')
      const warnText = apiWarningText(d)
      if (warnText) toast(warnText, 'warning')
      currentVersion.value = d.current || tag
      await loadVersions()
    } else {
      toast(apiErrorText(d, t('comfyui.settings.switch_failed')), 'error')
    }
  } finally {
    if (!applied) selectedVersion.value = currentVersion.value || ''
    switching.value = false
    switchTarget.value = null
  }
}

function switchSelectedVersion() {
  if (!selectedVersion.value || selectedIsCurrent.value) return
  switchVersion(selectedVersion.value)
}
</script>

<template>
  <div class="version-control">
    <div v-if="versionsLoading && !loaded" class="version-loading">
      <Spinner size="sm" />
      <span>{{ t('common.status.loading') }}</span>
    </div>

    <AlertBanner v-else-if="!hasGit" tone="danger" icon="error">
      {{ t('comfyui.settings.no_git') }}
    </AlertBanner>

    <template v-else-if="loaded">
      <div class="version-control__summary">
        <div class="version-control__heading">
          <span class="version-control__icon"><MsIcon name="deployed_code" /></span>
          <h3>{{ t('comfyui.settings.current_version') }}</h3>
        </div>
        <span class="version-control__current">
          <strong>{{ currentVersion || 'unknown' }}</strong>
          <Badge v-if="currentIsNightly" tone="caution">nightly</Badge>
          <Badge v-else-if="currentIsRelease" tone="neutral">release</Badge>
        </span>
      </div>

      <div class="version-control__actions">
        <BaseSelect
          v-model="selectedVersion"
          class="version-control__select"
          :options="versionOptions"
          :placeholder="t('comfyui.settings.channels_title')"
          :search-placeholder="t('comfyui.settings.available_versions')"
          :empty-text="t('comfyui.settings.no_versions')"
          :max-list-height="240"
          searchable
          teleport
          :disabled="switching"
        />
        <BaseButton
          variant="primary"
          :loading="!!switchTarget && switchTarget === selectedVersion"
          :disabled="!selectedVersion || selectedIsCurrent || switching"
          @click="switchSelectedVersion"
        >
          <MsIcon name="swap_horiz" size="xs" /> {{ t('comfyui.settings.switch') }}
        </BaseButton>
        <BaseButton
          square
          :loading="versionsLoading"
          :disabled="switching"
          :aria-label="t('plugins.installed.refresh')"
          :title="t('plugins.installed.refresh')"
          @click="loadVersions"
        >
          <MsIcon name="refresh" size="xs" />
        </BaseButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.version-control {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
}

.version-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  min-height: 104px;
  color: var(--t3);
  font-size: var(--text-sm);
}

.version-control__summary,
.version-control__current,
.version-control__actions {
  display: flex;
  align-items: center;
}

.version-control__summary {
  display: grid;
  align-items: stretch;
  gap: 0;
}

.version-control__heading {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding-bottom: var(--sp-4);
  margin-bottom: var(--sp-3);
  border-bottom: 1px solid var(--bd);
}

.version-control__icon {
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

.version-control__icon :deep(.ms) { font-size: 20px; }

.version-control__heading h3 {
  margin: 0;
  color: var(--t1);
  font-size: var(--text-md);
  font-weight: 600;
}

.version-control__current {
  flex-wrap: wrap;
  gap: var(--sp-2);
  min-width: 0;
  padding-top: 2px;
}

.version-control__current strong {
  overflow: hidden;
  color: var(--t1);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-control__actions {
  gap: var(--sp-3);
}

.version-control__select {
  flex: 1;
  min-width: 0;
}

.version-control__actions > :deep(.base-btn) {
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .version-control__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .version-control__select {
    grid-column: 1 / -1;
  }

  .version-control__actions > :deep(.base-btn:not(.base-btn--square)) {
    width: 100%;
  }
}
</style>
