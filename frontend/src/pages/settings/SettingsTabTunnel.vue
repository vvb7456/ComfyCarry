<script setup lang="ts">
/**
 * 设置 tab: Tunnel — 模式 (关闭/公共/自定义) + 参数。
 * 守卫式表单: dirty → shell banner / 路由拦截。
 * 「关闭」与模式/参数变更都在守卫保存时统一生效:
 *   - off:   销毁现有 tunnel (public → release / custom → teardown)
 *   - public: 释放自定义 tunnel (如有) → enable public
 *   - custom: 校验 token → (public 需先 disable) → provision
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useSettingsGuard } from '@/composables/useSettingsGuard'
import { apiErrorText } from '@/utils/apiError'
import type { TunnelConfigResponse, TunnelValidationResponse, TunnelActionResponse } from '@/types/tunnel'

defineOptions({ name: 'SettingsTabTunnel' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

type TunnelMode = 'off' | 'public' | 'custom'

const mode = ref<TunnelMode>('off')
const cfgSubdomain = ref('')
const cfgDomain = ref('')
const cfgToken = ref('')
const cfgProtocol = ref('auto')
const cfgSaving = ref(false)
const cfgLoaded = ref(false)
const cfgValidating = ref(false)
const cfgValidResult = ref<{ ok: boolean; message: string } | null>(null)
const cfgSnapshot = ref('')

/** 服务端当前实际状态 (off/public/custom) */
const serverMode = ref<TunnelMode>('off')

function snapshot(): string {
  return JSON.stringify({
    mode: mode.value,
    subdomain: cfgSubdomain.value,
    domain: cfgDomain.value,
    token: cfgToken.value,
    protocol: cfgProtocol.value,
  })
}

const cfgDirty = computed(() => cfgLoaded.value && snapshot() !== cfgSnapshot.value)

const modeOptions = computed(() => [
  { value: 'off', label: t('settings.tunnel.mode.off') },
  { value: 'public', label: t('settings.tunnel.mode.public') },
  { value: 'custom', label: t('settings.tunnel.mode.custom') },
])

// ── 加载 ──
async function loadConfig(): Promise<void> {
  const status = await get<{ tunnel_mode?: string; configured?: boolean; cf_protocol?: string; subdomain?: string; domain?: string }>('/api/tunnel/status')
  const cfg = await get<TunnelConfigResponse>('/api/tunnel/config')
  if (!status || !cfg) {
    loadError.value = true
    return
  }
  loadError.value = false
  let next: TunnelMode = 'off'
  if (status.tunnel_mode === 'public') next = 'public'
  else if (status.configured) next = 'custom'
  serverMode.value = next
  mode.value = next
  cfgProtocol.value = status.cf_protocol || 'auto'
  cfgSubdomain.value = cfg.subdomain || ''
  cfgDomain.value = next === 'public' ? '' : (cfg.domain || '')
  cfgToken.value = next === 'custom' ? (cfg.api_token || '') : ''
  cfgLoaded.value = true
  cfgSnapshot.value = snapshot()
}

// ── 保存 (守卫调用): 按模式差异应用变更 ──
async function saveConfig(): Promise<boolean> {
  cfgSaving.value = true
  try {
    // 协议始终先保存 (重启 cloudflared 后生效)
    if (!await post('/api/tunnel/protocol', { protocol: cfgProtocol.value })) return false

    // ── 模式未变: 仅参数更新 ──
    if (mode.value === serverMode.value) {
      if (mode.value === 'off') return done()
      if (mode.value === 'public') {
        const sub = cfgSubdomain.value.trim().toLowerCase()
        if (sub && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(sub)) {
          toast(t('settings.tunnel.subdomain_error'), 'warning')
          return false
        }
        if (!await post('/api/tunnel/public/subdomain', { subdomain: sub })) return false
        return done()
      }
      // custom 参数更新: 需完整参数后重新 provision
      if (!validateCustom()) return false
      if (!await confirm({ message: t('settings.tunnel.confirm.update_restart') })) return false
      const d = await post<TunnelActionResponse>('/api/tunnel/provision', {
        api_token: cfgToken.value, domain: cfgDomain.value, subdomain: cfgSubdomain.value,
      })
      if (!d?.ok) { toast(apiErrorText(d, t('settings.tunnel.save_failed')), 'error'); return false }
      return done()
    }

    // ── 模式切换 ──
    if (mode.value === 'off') {
      // 关闭 = 销毁 (守卫保存即意图, 再加一道 confirm)
      if (!await confirm({ message: t('settings.tunnel.confirm.off'), variant: 'danger' })) return false
      if (serverMode.value === 'public') {
        if (!await post('/api/tunnel/public/disable')) return false
      } else if (serverMode.value === 'custom') {
        if (!await post('/api/tunnel/teardown')) return false
      }
      return done()
    }

    if (mode.value === 'public') {
      if (serverMode.value === 'custom' && !await confirm({ message: t('settings.tunnel.confirm.destroy_to_public'), variant: 'danger' })) return false
      if (serverMode.value === 'custom' && !await post('/api/tunnel/teardown')) return false
      const sub = cfgSubdomain.value.trim().toLowerCase()
      if (sub && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(sub)) {
        toast(t('settings.tunnel.subdomain_error'), 'warning')
        return false
      }
      if (!await post('/api/tunnel/public/subdomain', { subdomain: sub })) return false
      toast(t('settings.tunnel.enabling_public'), 'info')
      const d = await post<TunnelActionResponse>('/api/tunnel/public/enable')
      if (!d?.ok) { toast(apiErrorText(d, t('settings.tunnel.enable_failed')), 'error'); return false }
      return done()
    }

    // → custom
    if (!validateCustom()) return false
    if (serverMode.value === 'public' && !await post('/api/tunnel/public/disable')) return false
    toast(t('settings.tunnel.applying'), 'info')
    const d = await post<TunnelActionResponse>('/api/tunnel/provision', {
      api_token: cfgToken.value, domain: cfgDomain.value, subdomain: cfgSubdomain.value,
    })
    if (!d?.ok) { toast(apiErrorText(d, t('settings.tunnel.save_failed')), 'error'); return false }
    return done()
  } finally {
    cfgSaving.value = false
  }
}

function validateCustom(): boolean {
  if (!cfgToken.value || !cfgDomain.value) {
    toast(t('settings.tunnel.need_token_domain'), 'warning')
    return false
  }
  return true
}

/** 成功收尾: 刷新基线 + 提示 */
function done(): boolean {
  toast(t('settings.tunnel.applied'), 'success')
  // provision/teardown 后服务端配置已变, 重新拉取; 失败不阻塞保存结果
  loadConfig().finally(() => { cfgSnapshot.value = snapshot() })
  return true
}

async function validateToken() {
  if (!cfgToken.value || !cfgDomain.value) {
    cfgValidResult.value = { ok: false, message: t('settings.tunnel.need_token_domain') }
    return
  }
  cfgValidating.value = true
  cfgValidResult.value = { ok: true, message: t('settings.tunnel.validating') + '...' }
  const d = await post<{ ok?: boolean; account_name?: string; zone_status?: string; error?: string }>('/api/tunnel/validate', { api_token: cfgToken.value, domain: cfgDomain.value })
  cfgValidating.value = false
  if (d?.ok) cfgValidResult.value = { ok: true, message: `${d.account_name} · ${d.zone_status}` }
  else cfgValidResult.value = { ok: false, message: apiErrorText(d, t('settings.tunnel.validate_failed')) }
}

// ── 守卫注册 ──
const guardHub = useSettingsGuard()
const provider = {
  isDirty: () => cfgDirty.value,
  isSaving: () => cfgSaving.value,
  save: saveConfig,
  discard: async () => {
    try { await loadConfig() } finally { cfgSnapshot.value = snapshot() }
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
      icon="language"
      :title="t('settings.tunnel.title')"
      :help="t('settings.tunnel.help')"
    >
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.tunnel.mode.label') }}</div>
          <div class="settings-row__desc">{{ t('settings.tunnel.mode.desc') }}</div>
        </div>
        <div class="settings-row__control">
          <SegmentedControl
            :model-value="mode"
            :options="modeOptions"
            size="md"
            block
            @update:model-value="v => mode = v as TunnelMode"
          />
        </div>
      </div>

      <template v-if="mode === 'public'">
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.tunnel.subdomain') }}</div>
            <div class="settings-row__desc">{{ t('settings.tunnel.subdomain_desc') }}</div>
          </div>
          <div class="settings-row__control">
            <input v-model="cfgSubdomain" type="text" class="form-input" :placeholder="t('settings.tunnel.subdomain_placeholder')">
          </div>
        </div>
      </template>

      <template v-if="mode === 'custom'">
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.tunnel.subdomain') }}</div>
            <div class="settings-row__desc">{{ t('settings.tunnel.custom_subdomain_desc') }}</div>
          </div>
          <div class="settings-row__control">
            <input v-model="cfgSubdomain" type="text" class="form-input" :placeholder="t('settings.tunnel.subdomain_placeholder')">
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.tunnel.root_domain') }}</div>
            <div class="settings-row__desc">{{ t('settings.tunnel.root_domain_desc') }}</div>
          </div>
          <div class="settings-row__control">
            <input v-model="cfgDomain" type="text" class="form-input" :placeholder="t('settings.tunnel.root_domain_placeholder')">
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.tunnel.token_label') }}</div>
            <div class="settings-row__desc">{{ t('settings.tunnel.token_desc') }}</div>
          </div>
          <div class="settings-row__control settings-row__control--stack">
            <div class="settings-row__control-row">
              <SecretInput v-model="cfgToken" autocomplete="off" :placeholder="t('settings.tunnel.token_placeholder')" />
              <BaseButton size="sm" :disabled="cfgValidating" @click="validateToken">{{ t('settings.tunnel.validate') }}</BaseButton>
            </div>
            <div
              v-if="cfgValidResult"
              class="settings-row__feedback"
              :class="cfgValidResult.ok ? 'settings-row__feedback--ok' : 'settings-row__feedback--err'"
            >
              {{ cfgValidResult.ok ? '✓' : '✗' }} {{ cfgValidResult.message }}
            </div>
          </div>
        </div>
      </template>

      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.tunnel.protocol') }}</div>
          <div class="settings-row__desc">{{ t('settings.tunnel.protocol_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect v-model="cfgProtocol" :options="[
            { value: 'auto', label: t('settings.tunnel.protocol_auto') },
            { value: 'http2', label: 'HTTP/2' },
            { value: 'quic', label: 'QUIC' },
          ]" />
        </div>
      </div>
    </SettingsGroup>
  </div>
</template>

<style scoped>
</style>