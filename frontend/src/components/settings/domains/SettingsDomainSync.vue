<script setup lang="ts">
/**
 * 设置模块: 云同步 — 同步参数 (min_age / watch_interval)。
 * 单页 v3: 模块头 (SettingsModule) dirty 时浮现保存, 无放弃按钮
 * (放弃走离开守卫); onMounted 加载 + 本地 skeleton/错误重试;
 * dirty 经 useSettingsGuard 只读登记, 离开守卫由 SettingsPage 统一处理。
 * rclone 配置编辑已移除 (oauth 向导替代, 见 sync 设置)。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsModule from '@/components/settings/SettingsModule.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useSettingsGuard } from '@/composables'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'SettingsDomainSync' })

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

// ── 保存 (卡片级) ──
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

// ── 放弃: 走离开守卫「放弃并离开」(组件卸载即丢), 域内不提供按钮 ──

// ── onMounted 加载 (替代 async setup; skeleton 门控首渲防默认值跳变) ──
const loading = ref(true)
const loadError = ref(false)

async function loadAll(): Promise<void> {
  loading.value = true
  await loadConfig()
  loading.value = false
}

// ── dirty 登记 (只读) ──
const guardHub = useSettingsGuard()
const dirtyEntry = {
  id: 'sync',
  label: () => t('settings.domains.sync'),
  isDirty: () => cfgDirty.value,
}

onMounted(() => {
  guardHub.register(dirtyEntry)
  void loadAll()
})
onUnmounted(() => guardHub.unregister(dirtyEntry))
</script>

<template>
  <SettingsModule
    id="settings-focus-sync"
    :title="t('settings.domains.sync')"
    :dirty="cfgDirty"
    :saving="cfgSaving"
    :disabled="loading || loadError"
    @save="saveConfig"
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
      <EmptyState icon="cloud_off" :message="t('common.load_failed')">
        <BaseButton size="sm" @click="loadAll">{{ t('common.btn.retry') }}</BaseButton>
      </EmptyState>
    </div>

    <div v-else class="settings-lines">
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
    </div>
  </SettingsModule>
</template>
