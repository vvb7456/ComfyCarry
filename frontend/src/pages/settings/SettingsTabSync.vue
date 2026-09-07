<script setup lang="ts">
/**
 * 设置 tab: 云同步 — 同步参数 (min_age / watch_interval)。
 * 守卫式表单: dirty → shell banner / 路由拦截, 无保存按钮。
 * rclone 配置编辑已移除 (后续另想它法)。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useSettingsGuard } from '@/composables/useSettingsGuard'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'SettingsTabSync' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()

const cfgMinAge = ref(60)
const cfgWatchInterval = ref(60)
const cfgSaving = ref(false)
const cfgLoaded = ref(false)
const cfgSnapshot = ref('')

function snapshotCfg(): string {
  return JSON.stringify({ min_age: cfgMinAge.value, watch_interval: cfgWatchInterval.value })
}

const cfgDirty = computed(() => cfgLoaded.value && snapshotCfg() !== cfgSnapshot.value)

async function loadConfig(): Promise<void> {
  const d = await get<{ min_age?: number; watch_interval?: number }>('/api/sync/settings')
  if (!d) {
    loadError.value = true
    return
  }
  loadError.value = false
  cfgMinAge.value = d.min_age ?? 60
  cfgWatchInterval.value = d.watch_interval ?? 60
  cfgLoaded.value = true
  cfgSnapshot.value = snapshotCfg()
}

async function saveConfig(): Promise<boolean> {
  cfgSaving.value = true
  try {
    const d = await post<{ ok?: boolean; error?: string }>('/api/sync/settings', {
      min_age: cfgMinAge.value,
      watch_interval: cfgWatchInterval.value,
    })
    if (!d?.ok) {
      toast(apiErrorText(d, t('sync.config.save_failed')), 'error')
      return false
    }
    toast(t('sync.config.saved'), 'success')
    cfgSnapshot.value = snapshotCfg()
    return true
  } finally {
    cfgSaving.value = false
  }
}

// ── 守卫注册 ──
const guardHub = useSettingsGuard()
const provider = {
  isDirty: () => cfgDirty.value,
  isSaving: () => cfgSaving.value,
  save: saveConfig,
  discard: async () => {
    // 无论 loadConfig 成败都同步快照: 失败时表单保持原样, 快照对齐后不再误报 dirty
    try { await loadConfig() } finally { cfgSnapshot.value = snapshotCfg() }
  },
}

// ── 加载失败态 (async setup 由 Suspense 门控首渲, 失败显示错误+重试) ──
const loadError = ref(false)

async function retryLoad(): Promise<void> {
  await loadConfig()
}

// async setup: 数据就绪后才挂载渲染
await loadConfig()
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

    <SettingsGroup
      v-else
      icon="cloud_sync"
      :title="t('settings.sync.title')"
      :help="t('settings.sync.help')"
    >
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('sync.config.min_age.label') }}</div>
          <div class="settings-row__desc">{{ t('sync.config.min_age.desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input v-model.number="cfgMinAge" type="number" min="0" class="form-number">
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('sync.config.watch_interval.label') }}</div>
          <div class="settings-row__desc">{{ t('sync.config.watch_interval.desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input v-model.number="cfgWatchInterval" type="number" min="10" class="form-number">
        </div>
      </div>
    </SettingsGroup>
  </div>
</template>
