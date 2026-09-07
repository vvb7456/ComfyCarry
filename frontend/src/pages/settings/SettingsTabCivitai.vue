<script setup lang="ts">
/**
 * 设置 tab: CivitAI — API Key + NSFW 浏览设置 (两级)。
 * 守卫式表单: dirty → shell banner / 路由拦截, 无保存按钮。
 * NSFW 两级:
 *  - 浏览级别三档 (仅PG=1 / PG–R=7 / 全部=31): 控制出现的模型内容范围
 *  - 模糊 NSFW 开关: 已出现内容中 NSFW 图是否模糊
 * 保存走 useCivitaiNsfw().save(), 保存成功即同步全局共享状态 (模型页即时生效)。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useCivitaiNsfw } from '@/composables/useCivitaiNsfw'
import { useToast } from '@/composables/useToast'
import { useSettingsGuard } from '@/composables/useSettingsGuard'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'SettingsTabCivitai' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()

// ── API Key 表单 ──
const civitaiKey = ref('')
const civitaiBaseline = ref('')
const civitaiLoaded = ref(false)
const civitaiSaving = ref(false)
const keyDirty = computed(() => civitaiLoaded.value && civitaiKey.value.trim() !== civitaiBaseline.value)

// ── NSFW 两级 (草稿 + 基线, 走守卫) ──
// 底层仍是 browsingLevel bitmask, UI 仅暴露三档预设
const NSFW_LEVEL_PRESETS = [1, 7, 31] as const
const NSFW_LEVEL_DEFAULT = 7
const nsfwLevelDraft = ref(NSFW_LEVEL_DEFAULT)
const nsfwBlurDraft = ref(true)
const nsfwBaseline = ref({ level: NSFW_LEVEL_DEFAULT, blur: true })
const nsfwLoaded = ref(false)
const nsfwDirty = computed(() =>
  nsfwLoaded.value
  && (nsfwLevelDraft.value !== nsfwBaseline.value.level || nsfwBlurDraft.value !== nsfwBaseline.value.blur),
)

const nsfwLevelOptions = computed(() => [
  { value: '1', label: t('settings.civitai.nsfw.level.pg') },
  { value: '7', label: t('settings.civitai.nsfw.level.pg_r') },
  { value: '31', label: t('settings.civitai.nsfw.level.all') },
])

// ── 加载 ──
async function loadSettings() {
  const data = await get<{ civitai_key_set?: boolean; civitai_key?: string; civitai_nsfw_level?: number; civitai_nsfw_blur?: boolean }>('/api/settings')
  if (!data) {
    loadError.value = true
    return
  }
  loadError.value = false
  // 无条件赋值: 服务端已清除 key 时把输入框重置为空, 基线以服务端实际值为准
  civitaiKey.value = (data.civitai_key && data.civitai_key_set) ? data.civitai_key : ''
  civitaiBaseline.value = civitaiKey.value.trim()
  civitaiLoaded.value = true
  // NSFW: /api/settings 直接带两级值, 无需再走共享 store 的懒加载
  const level = Number(data.civitai_nsfw_level)
  if (Number.isFinite(level) && level >= 1 && level <= 31) {
    // 非三档值 (后端仍接受任意 1..31) 归一到默认档
    nsfwLevelDraft.value = (NSFW_LEVEL_PRESETS as readonly number[]).includes(level) ? level : NSFW_LEVEL_DEFAULT
    nsfwBlurDraft.value = data.civitai_nsfw_blur !== false
  }
  nsfwBaseline.value = { level: nsfwLevelDraft.value, blur: nsfwBlurDraft.value }
  nsfwLoaded.value = true
}

// ── 保存 (守卫调用) ──
async function saveAll(): Promise<boolean> {
  civitaiSaving.value = true
  try {
    if (nsfwDirty.value) {
      // 走共享 composable: 保存成功即同步全局状态, 模型页无需重新拉取
      const ok = await saveNsfwShared({ level: nsfwLevelDraft.value, blur: nsfwBlurDraft.value })
      if (!ok) {
        toast(t('settings.civitai.save_failed'), 'error')
        return false
      }
      nsfwBaseline.value = { level: nsfwLevelDraft.value, blur: nsfwBlurDraft.value }
    }
    if (keyDirty.value) {
      // 空 key = 清除 (后端 POST 空 api_key 即清除)
      const data = await post<{ ok?: boolean; civitai_key_set?: boolean; error?: string }>(
        '/api/settings/civitai-key',
        { api_key: civitaiKey.value.trim() },
      )
      if (!data?.ok) {
        toast(apiErrorText(data, t('settings.civitai.save_failed')), 'error')
        return false
      }
      toast(data.civitai_key_set ? t('settings.civitai.saved') : t('settings.civitai.cleared'), 'success')
    }
    await loadSettings()
    return true
  } finally {
    civitaiSaving.value = false
  }
}

function discardAll(): Promise<void> {
  return loadSettings()
}

const { save: saveNsfwShared } = useCivitaiNsfw()

// ── 守卫注册 ──
const guardHub = useSettingsGuard()
const provider = {
  isDirty: () => keyDirty.value || nsfwDirty.value,
  isSaving: () => civitaiSaving.value,
  save: saveAll,
  discard: discardAll,
}

// ── 加载失败态 (async setup 由 Suspense 门控首渲, 失败显示错误+重试) ──
const loadError = ref(false)

async function retryLoad(): Promise<void> {
  await loadSettings()
}

onUnmounted(() => guardHub.unregister(provider))

// async setup: 数据就绪后才挂载渲染
await loadSettings()
onMounted(() => guardHub.register(provider))
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
    <SettingsGroup icon="key" :title="t('settings.civitai.key_title')">
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.civitai.key_title') }}</div>
          <div class="settings-row__desc">
            {{ t('settings.civitai.key_desc_prefix') }}
            <a href="https://civitai.com/user/account" target="_blank" class="key-desc-link">{{ t('settings.civitai.key_link') }}</a>
            {{ t('settings.civitai.key_desc_suffix') }}
          </div>
        </div>
        <div class="settings-row__control">
          <SecretInput
            v-model="civitaiKey"
            :placeholder="t('settings.civitai.placeholder')"
            autocomplete="off"
          />
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup
      icon="visibility_off"
      :title="t('settings.civitai.nsfw.title')"
      :help="t('settings.civitai.nsfw.help')"
    >
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.civitai.nsfw.level_label') }}</div>
          <div class="settings-row__desc">{{ t('settings.civitai.nsfw.level_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <SegmentedControl
            :model-value="String(nsfwLevelDraft)"
            :options="nsfwLevelOptions"
            size="md"
            block
            @update:model-value="v => nsfwLevelDraft = Number(v)"
          />
        </div>
      </div>
      <SettingsGroupToggleRow
        :label="t('settings.civitai.nsfw.blur')"
        :desc="t('settings.civitai.nsfw.blur_desc')"
        v-model="nsfwBlurDraft"
      />
    </SettingsGroup>
    </template>
  </div>
</template>

<style scoped>
.key-desc-link {
  color: var(--ac);
  text-decoration: none;
}
.key-desc-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>