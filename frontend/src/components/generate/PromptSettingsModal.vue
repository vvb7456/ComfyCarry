<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { useModalCloseGuard } from '@/composables/useModalCloseGuard'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'PromptSettingsModal' })

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

const {
  settings: promptSettings,
  saving: promptSaving,
  isDirty: promptFormDirty,
  translateProviders: promptTranslateProviders,
  load: loadPromptSettings,
  save: savePromptSettings,
  discard: discardPromptSettings,
} = usePromptSettings()

const promptAutocompleteOptions = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
]

const normalizeEnabled = computed(() =>
  promptSettings.normalize_comma
  || promptSettings.normalize_period
  || promptSettings.normalize_bracket
  || promptSettings.normalize_underscore
  || promptSettings.escape_bracket,
)

function toggleNormalizeAll(on: boolean) {
  if (on) {
    promptSettings.normalize_comma = true
    promptSettings.normalize_period = true
    promptSettings.normalize_bracket = true
  } else {
    promptSettings.normalize_comma = false
    promptSettings.normalize_period = false
    promptSettings.normalize_bracket = false
    promptSettings.normalize_underscore = false
    promptSettings.escape_bracket = false
  }
}

const translateProviderOptions = ref<{ value: string; label: string }[]>([])

const loading = ref(true)
const loadError = ref(false)

async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = !(await loadPromptSettings(true))
  loading.value = false
  translateProviderOptions.value = [
    { value: '', label: t('prompt-library.settings.translation.provider_auto') },
    ...promptTranslateProviders.value.map(p => ({
      value: p,
      label: t(`prompt-library.settings.translation.providers.${p}`, p),
    })),
  ]
}

watch(() => props.modelValue, (open) => {
  if (open) void loadAll()
})

async function onSave(): Promise<void> {
  const ok = await savePromptSettings()
  if (!ok) {
    toast(t('prompt-library.settings.save_failed'), 'error')
    return
  }
  toast(t('prompt-library.settings.saved'), 'success')
  emit('update:modelValue', false)
}

const requestClose = useModalCloseGuard({
  dirty: () => promptFormDirty.value,
  saving: () => promptSaving.value,
  texts: {
    title: () => t('prompt-library.settings.discard_title'),
    message: () => t('prompt-library.settings.discard_message'),
    discard: () => t('prompt-library.settings.discard_button'),
    cancel: () => t('common.btn.cancel'),
  },
  onClose: () => {
    if (promptFormDirty.value) void discardPromptSettings()
    emit('update:modelValue', false)
  },
})
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('prompt-library.settings.title')"
    icon="tune"
    width="560px"
    :close-on-overlay="!promptSaving"
    :close-on-esc="!promptSaving"
    @update:model-value="requestClose()"
  >
    <div v-if="loading" class="settings-skeleton" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="settings-skeleton__row">
        <div class="settings-skeleton__lines">
          <div class="settings-skeleton__line settings-skeleton__line--text" />
          <div class="settings-skeleton__line settings-skeleton__line--text-sm" />
        </div>
        <div class="settings-skeleton__line settings-skeleton__line--control" />
      </div>
    </div>

    <!-- 加载失败: 错误 + 重试 (不渲染表单, 防止初值冒充服务端值) -->
    <div v-else-if="loadError">
      <EmptyState icon="error_outline" :message="t('common.load_failed')">
        <BaseButton size="sm" @click="loadAll">{{ t('common.btn.retry') }}</BaseButton>
      </EmptyState>
    </div>

    <div v-else class="settings-lines">
      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.translation.show')"
        :desc="t('prompt-library.settings.translation.show_desc')"
        v-model="promptSettings.show_translation"
      />
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('prompt-library.settings.translation.provider') }}</div>
          <div class="settings-row__desc">{{ t('prompt-library.settings.translation.provider_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="promptSettings.translate_provider"
            :options="translateProviderOptions"
            :disabled="!promptSettings.show_translation"
          />
        </div>
      </div>

      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.normalize.enable')"
        :desc="t('prompt-library.settings.normalize.enable_desc')"
        :model-value="normalizeEnabled"
        @update:model-value="toggleNormalizeAll"
      />
      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.normalize.comma')"
        :desc="t('prompt-library.settings.normalize.comma_desc')"
        v-model="promptSettings.normalize_comma"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.normalize.period')"
        :desc="t('prompt-library.settings.normalize.period_desc')"
        v-model="promptSettings.normalize_period"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.normalize.bracket')"
        :desc="t('prompt-library.settings.normalize.bracket_desc')"
        v-model="promptSettings.normalize_bracket"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.normalize.underscore')"
        :desc="t('prompt-library.settings.normalize.underscore_desc')"
        v-model="promptSettings.normalize_underscore"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.normalize.escape_bracket')"
        :desc="t('prompt-library.settings.normalize.escape_bracket_desc')"
        v-model="promptSettings.escape_bracket"
        :disabled="!normalizeEnabled"
      />

      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('prompt-library.settings.autocomplete.limit') }}</div>
          <div class="settings-row__desc">{{ t('prompt-library.settings.autocomplete.limit_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="promptSettings.autocomplete_limit"
            :options="promptAutocompleteOptions"
          />
        </div>
      </div>

      <SettingsGroupToggleRow
        :label="t('prompt-library.settings.tag_library.show_nsfw')"
        :desc="t('prompt-library.settings.tag_library.show_nsfw_desc')"
        v-model="promptSettings.show_nsfw"
      />
    </div>

    <template #footer>
      <BaseButton :disabled="promptSaving" @click="requestClose()">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!promptFormDirty || loading || loadError"
        :loading="promptSaving"
        @click="onSave"
      >{{ t('common.btn.save') }}</BaseButton>
    </template>
  </BaseModal>
</template>
