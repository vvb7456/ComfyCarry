<script setup lang="ts">
/**
 * SyncSettingsModal — 云同步页内设置弹窗 (C07)。
 *
 * 由原「设置页 → 连接与同步 → 云同步」域迁入: 同步延迟 (min_age) 与
 * 检查间隔 (watch_interval), 沿用 GET/POST /api/sync/settings。
 *
 * 与设置页域的差异:
 *   - 外层改为 BaseModal (宽 600px), 底部「取消 / 保存」取代模块头保存按钮;
 *   - 关闭 (取消 / Esc / 遮罩 / 关闭按钮) 统一经过未保存检查。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'SyncSettingsModal' })

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功: 页面刷新事实 (检查间隔) */
  saved: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const minAge = ref(60)
const watchInterval = ref(60)
const saving = ref(false)
const loaded = ref(false)
const snapshot = ref('')

const loading = ref(false)
const loadError = ref(false)

function currentSnapshot(): string {
  return JSON.stringify({ min_age: minAge.value, watch_interval: watchInterval.value })
}

const dirty = computed(() => loaded.value && currentSnapshot() !== snapshot.value)

async function loadConfig(): Promise<void> {
  const d = await get<{ min_age?: number; watch_interval?: number }>('/api/sync/settings')
  if (!d) {
    loadError.value = true
    return
  }
  loadError.value = false
  minAge.value = d.min_age ?? 60
  watchInterval.value = d.watch_interval ?? 60
  loaded.value = true
  snapshot.value = currentSnapshot()
}

async function loadAll(): Promise<void> {
  loading.value = true
  loaded.value = false
  await loadConfig()
  loading.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) void loadAll()
})

async function onSave(): Promise<void> {
  saving.value = true
  try {
    const d = await post<{ ok?: boolean; error_key?: string; error?: string }>('/api/sync/settings', {
      min_age: minAge.value,
      watch_interval: watchInterval.value,
    })
    if (!d?.ok) {
      toast(apiErrorText(d, t('sync.config.save_failed')), 'error')
      return
    }
    toast(t('sync.config.saved'), 'success')
    snapshot.value = currentSnapshot()
    emit('saved')
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}

/** 关闭守卫: 取消 / Esc / 遮罩 / 关闭按钮统一经过未保存检查 */
async function requestClose(): Promise<void> {
  if (saving.value) return
  if (dirty.value) {
    const r = await confirm({
      message: t('sync.config.discard_confirm'),
      variant: 'danger',
      confirmText: t('sync.config.discard'),
      cancelText: t('common.btn.cancel'),
    })
    if (r !== true) return
  }
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('sync.config.title')"
    width="600px"
    :close-on-overlay="!saving"
    :close-on-esc="!saving"
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
    <EmptyState v-else-if="loadError" icon="cloud_off" :message="t('common.load_failed')">
      <BaseButton size="sm" @click="loadAll">{{ t('common.btn.retry') }}</BaseButton>
    </EmptyState>

    <div v-else class="settings-lines">
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('sync.config.min_age.label') }}</div>
          <div class="settings-row__desc">{{ t('sync.config.min_age.desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input v-model.number="minAge" type="number" min="0" class="form-number">
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('sync.config.watch_interval.label') }}</div>
          <div class="settings-row__desc">{{ t('sync.config.watch_interval.desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input v-model.number="watchInterval" type="number" min="5" class="form-number">
        </div>
      </div>
    </div>

    <template #footer>
      <BaseButton size="sm" :disabled="saving" @click="requestClose()">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton
        variant="primary"
        size="sm"
        :disabled="!dirty || loading || loadError"
        :loading="saving"
        @click="onSave"
      >
        {{ t('common.btn.save') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
