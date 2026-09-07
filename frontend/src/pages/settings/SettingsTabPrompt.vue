<script setup lang="ts">
/**
 * 设置 tab: 提示词编辑器 — 翻译 / 规格化 / 自动补全 / 标签库。
 * group 式布局; 守卫经 useSettingsGuard 注册给 shell。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { useSettingsGuard } from '@/composables/useSettingsGuard'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'SettingsTabPrompt' })

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
    // 开启总开关 → 恢复默认值
    promptSettings.normalize_comma = true
    promptSettings.normalize_period = true
    promptSettings.normalize_bracket = true
  } else {
    // 关闭总开关 → 全部关闭
    promptSettings.normalize_comma = false
    promptSettings.normalize_period = false
    promptSettings.normalize_bracket = false
    promptSettings.normalize_underscore = false
    promptSettings.escape_bracket = false
  }
}

const translateProviderOptions = computed(() => [
  { value: '', label: t('settings.prompt.translation.provider_auto') },
  ...promptTranslateProviders.value.map(p => ({
    value: p,
    label: t(`settings.prompt.translation.providers.${p}`, p),
  })),
])

// ── 守卫注册 (shell banner / 路由离开拦截) ──
const guardHub = useSettingsGuard()
const provider = {
  isDirty: () => promptFormDirty.value,
  isSaving: () => promptSaving.value,
  save: async () => {
    const ok = await savePromptSettings()
    if (ok) toast(t('settings.prompt.saved'), 'success')
    return ok
  },
  discard: () => discardPromptSettings(),
}

// ── 加载失败态 (async setup 由 Suspense 门控首渲, 失败显示错误+重试) ──
const loadError = ref(false)

async function loadAll(): Promise<void> {
  // 强制重载: 基线以服务端实际值为准, 避免其他入口改动造成快照漂移
  loadError.value = !(await loadPromptSettings(true))
}

async function retryLoad(): Promise<void> {
  await loadAll()
}

// async setup: 数据就绪后才挂载渲染
await loadAll()
onMounted(() => guardHub.register(provider))
onUnmounted(() => guardHub.unregister(provider))
</script>

<template>
  <div class="tab-panel settings-centered">
    <!-- 加载失败: 错误 + 重试 (不渲染表单, 防止初值冒充服务端值) -->
    <SettingsGroup v-if="loadError">
      <EmptyState icon="cloud_off" :message="t('common.load_failed')">
        <BaseButton size="sm" @click="retryLoad">{{ t('common.btn.retry') }}</BaseButton>
      </EmptyState>
    </SettingsGroup>

    <template v-else>
    <SettingsGroup icon="translate" :title="t('settings.prompt.translation.title')">
      <SettingsGroupToggleRow
        :label="t('settings.prompt.translation.show')"
        :desc="t('settings.prompt.translation.show_desc')"
        v-model="promptSettings.show_translation"
      />
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.prompt.translation.provider') }}</div>
          <div class="settings-row__desc">{{ t('settings.prompt.translation.provider_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="promptSettings.translate_provider"
            :options="translateProviderOptions"
            :disabled="!promptSettings.show_translation"
          />
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup icon="auto_fix_high" :title="t('settings.prompt.normalize.title')">
      <SettingsGroupToggleRow
        :label="t('settings.prompt.normalize.enable')"
        :desc="t('settings.prompt.normalize.enable_desc')"
        :model-value="normalizeEnabled"
        @update:model-value="toggleNormalizeAll"
      />
      <SettingsGroupToggleRow
        :label="t('settings.prompt.normalize.comma')"
        :desc="t('settings.prompt.normalize.comma_desc')"
        v-model="promptSettings.normalize_comma"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('settings.prompt.normalize.period')"
        :desc="t('settings.prompt.normalize.period_desc')"
        v-model="promptSettings.normalize_period"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('settings.prompt.normalize.bracket')"
        :desc="t('settings.prompt.normalize.bracket_desc')"
        v-model="promptSettings.normalize_bracket"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('settings.prompt.normalize.underscore')"
        :desc="t('settings.prompt.normalize.underscore_desc')"
        v-model="promptSettings.normalize_underscore"
        :disabled="!normalizeEnabled"
      />
      <SettingsGroupToggleRow
        :label="t('settings.prompt.normalize.escape_bracket')"
        :desc="t('settings.prompt.normalize.escape_bracket_desc')"
        v-model="promptSettings.escape_bracket"
        :disabled="!normalizeEnabled"
      />
    </SettingsGroup>

    <SettingsGroup icon="auto_awesome" :title="t('settings.prompt.autocomplete.title')">
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.prompt.autocomplete.limit') }}</div>
          <div class="settings-row__desc">{{ t('settings.prompt.autocomplete.limit_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="promptSettings.autocomplete_limit"
            :options="promptAutocompleteOptions"
          />
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup icon="category" :title="t('settings.prompt.tag_library.title')">
      <SettingsGroupToggleRow
        :label="t('settings.prompt.tag_library.show_nsfw')"
        :desc="t('settings.prompt.tag_library.show_nsfw_desc')"
        v-model="promptSettings.show_nsfw"
      />
    </SettingsGroup>
    </template>
  </div>
</template>