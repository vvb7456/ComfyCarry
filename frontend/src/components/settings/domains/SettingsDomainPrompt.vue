<script setup lang="ts">
/**
 * 设置模块: 提示词编辑器 — 翻译 / 规格化 / 自动补全 / 标签库。
 * 单页 v3: 模块头 (SettingsModule) dirty 时浮现保存, 无放弃按钮;
 * onMounted 加载 + 本地 skeleton / 错误重试 (单页无 Suspense);
 * dirty 经 useSettingsGuard 只读登记, 离开守卫由 SettingsPage 统一处理。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsModule from '@/components/settings/SettingsModule.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { useSettingsGuard } from '@/composables'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'SettingsDomainPrompt' })

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

const {
  settings: promptSettings,
  saving: promptSaving,
  isDirty: promptFormDirty,
  translateProviders: promptTranslateProviders,
  load: loadPromptSettings,
  save: savePromptSettings,
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

// ── 卡片级保存/放弃 (域内完成, 注册表不持有动作) ──
async function save(): Promise<void> {
  const ok = await savePromptSettings()
  if (ok) toast(t('settings.prompt.saved'), 'success')
}

// ── 放弃: 走离开守卫「放弃并离开」(组件卸载即丢), 模块内不提供按钮 ──

// ── onMounted 加载 (替代 async setup; skeleton 门控首渲防默认值跳变) ──
const loading = ref(true)
const loadError = ref(false)

async function loadAll(): Promise<void> {
  loading.value = true
  // 强制重载: 基线以服务端实际值为准, 避免其他入口改动造成快照漂移
  loadError.value = !(await loadPromptSettings(true))
  loading.value = false
}

// ── dirty 登记 (只读; save/discard 不进注册表) ──
const guardHub = useSettingsGuard()
const dirtyEntry = {
  id: 'prompt',
  label: () => t('settings.domains.prompt'),
  isDirty: () => promptFormDirty.value,
}

onMounted(() => {
  guardHub.register(dirtyEntry)
  void loadAll()
})
onUnmounted(() => guardHub.unregister(dirtyEntry))
</script>

<template>
  <SettingsModule
    id="settings-focus-prompt"
    :title="t('settings.domains.prompt')"
    :dirty="promptFormDirty"
    :saving="promptSaving"
    :disabled="loading || loadError"
    @save="save"
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
      

              <SettingsGroupToggleRow
          :label="t('settings.prompt.tag_library.show_nsfw')"
          :desc="t('settings.prompt.tag_library.show_nsfw_desc')"
          v-model="promptSettings.show_nsfw"
        />
      
    </div>
  </SettingsModule>
</template>
