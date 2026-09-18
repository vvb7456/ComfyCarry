<script setup lang="ts">
/**
 * CivitaiSettingsModal — CivitAI 设置弹窗 (页内就近迁移自设置页)。
 *
 * 内容: API Key + NSFW 两级 (浏览级别三档 / 模糊开关)。
 * 由 CivitaiTab 工具栏的设置按钮承载; 保存成功后 emit('saved'),
 * 由宿主刷新共享状态 (keySet) 并在 gate 解除时激活搜索。
 * 关闭 (取消 / Esc / 遮罩 / 关闭按钮) 统一经过未保存检查。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useCivitaiSettings } from '@/composables/useCivitaiSettings'
import { useToast } from '@/composables/useToast'
import { useModalCloseGuard } from '@/composables/useModalCloseGuard'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'CivitaiSettingsModal' })

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功: 由宿主刷新 keySet 并解除 gate */
  saved: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()

// ── API Key 表单 ──
const civitaiKey = ref('')
const civitaiBaseline = ref('')
const civitaiLoaded = ref(false)
const civitaiSaving = ref(false)
const keyDirty = computed(() => civitaiLoaded.value && civitaiKey.value.trim() !== civitaiBaseline.value)

// ── NSFW 两级 (草稿 + 基线) ──
// 底层仍是 browsingLevel bitmask, UI 仅暴露三档预设
const NSFW_LEVEL_PRESETS = [1, 7, 31] as const
const NSFW_LEVEL_DEFAULT = 31
const nsfwLevelDraft = ref(NSFW_LEVEL_DEFAULT)
const nsfwBlurDraft = ref(true)
const nsfwBaseline = ref({ level: NSFW_LEVEL_DEFAULT, blur: true })
const nsfwLoaded = ref(false)
const nsfwDirty = computed(() =>
  nsfwLoaded.value
  && (nsfwLevelDraft.value !== nsfwBaseline.value.level || nsfwBlurDraft.value !== nsfwBaseline.value.blur),
)

const nsfwLevelOptions = computed(() => [
  { value: '1', label: t('models.civitai.settings.nsfw.level.pg') },
  { value: '7', label: t('models.civitai.settings.nsfw.level.pg_r') },
  { value: '31', label: t('models.civitai.settings.nsfw.level.all') },
])

// ── 加载 ──
const loading = ref(true)
const loadError = ref(false)

async function loadAll(): Promise<void> {
  loading.value = true
  const data = await get<{ civitai_key_set?: boolean; civitai_key?: string; civitai_nsfw_level?: number; civitai_nsfw_blur?: boolean }>('/api/settings')
  loading.value = false
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

watch(() => props.modelValue, (open) => {
  if (open) void loadAll()
})

// ── 保存并关闭 ──
const { save: saveNsfwShared } = useCivitaiSettings()

async function onSave(): Promise<void> {
  civitaiSaving.value = true
  try {
    if (nsfwDirty.value) {
      // 走共享 composable: 保存成功即同步全局状态, 模型页无需重新拉取
      const ok = await saveNsfwShared({ level: nsfwLevelDraft.value, blur: nsfwBlurDraft.value })
      if (!ok) {
        toast(t('models.civitai.settings.save_failed'), 'error')
        return
      }
      nsfwBaseline.value = { level: nsfwLevelDraft.value, blur: nsfwBlurDraft.value }
    }
    if (keyDirty.value) {
      // 空 key = 清除 (后端 POST 空 api_key 即清除)
      const data = await post<{ ok?: boolean; civitai_key_set?: boolean; error?: string }>(
        '/api/settings/civitai-key',
        { api_key: civitaiKey.value.trim() },
      )
      // 非 2xx 已由 useApiFetch 统一提示; 这里只判业务层 ok
      if (!data) return
      if (!data.ok) {
        toast(apiErrorText(data, t('models.civitai.settings.save_failed')), 'error')
        return
      }
      toast(data.civitai_key_set ? t('models.civitai.settings.saved') : t('models.civitai.settings.cleared'), 'success')
    }
    await loadAll()
    emit('saved')
    emit('update:modelValue', false)
  } finally {
    civitaiSaving.value = false
  }
}

// ── 关闭守卫: 取消 / Esc / 遮罩 / 关闭按钮统一经过未保存检查 ──
const requestClose = useModalCloseGuard({
  dirty: () => keyDirty.value || nsfwDirty.value,
  saving: () => civitaiSaving.value,
  texts: {
    title: () => t('models.civitai.settings.discard_title'),
    message: () => t('models.civitai.settings.discard_message'),
    discard: () => t('models.civitai.settings.discard_button'),
    cancel: () => t('common.btn.cancel'),
  },
  onClose: () => emit('update:modelValue', false),
})
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('models.civitai.settings.title')"
    icon="tune"
    width="600px"
    :close-on-overlay="!civitaiSaving"
    :close-on-esc="!civitaiSaving"
    @update:model-value="requestClose()"
  >
    <div v-if="loading" class="settings-skeleton" aria-hidden="true">
      <div v-for="i in 2" :key="i" class="settings-skeleton__row">
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
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('models.civitai.settings.key_title') }}</div>
          <div class="settings-row__desc">
            <i18n-t keypath="models.civitai.settings.key_desc" tag="span">
              <template #link>
                <a href="https://civitai.com/user/account" target="_blank" class="link">{{ t('models.civitai.settings.key_link') }}</a>
              </template>
            </i18n-t>
          </div>
        </div>
        <div class="settings-row__control">
          <SecretInput
            v-model="civitaiKey"
            :placeholder="t('models.civitai.settings.placeholder')"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('models.civitai.settings.nsfw.level_label') }}
            <HelpTip :text="t('models.civitai.settings.nsfw.help')" />
          </div>
          <div class="settings-row__desc">{{ t('models.civitai.settings.nsfw.level_desc') }}</div>
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
        :label="t('models.civitai.settings.nsfw.blur')"
        :desc="t('models.civitai.settings.nsfw.blur_desc')"
        v-model="nsfwBlurDraft"
      />
    </div>

    <template #footer>
      <BaseButton :disabled="civitaiSaving" @click="requestClose()">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="(!keyDirty && !nsfwDirty) || loading || loadError"
        :loading="civitaiSaving"
        @click="onSave"
      >{{ t('common.btn.save') }}</BaseButton>
    </template>
  </BaseModal>
</template>