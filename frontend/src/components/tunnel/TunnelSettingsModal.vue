<script setup lang="ts">
/**
 * TunnelSettingsModal — Tunnel 页内设置弹窗 (C04)。
 *
 * 由原「设置页 → 连接与同步 → 隧道」域完整迁入:
 * 模式 (关闭/公共/自定义) + 子域名前缀 / 根域名 / API Token / 传输协议,
 * 保留原有加载、校验、保存与模式切换的 confirm/teardown 流程。
 *
 * 与设置页域的差异:
 *   - 外层改为 BaseModal (宽 600px), 底部「取消 / 保存」取代模块头保存按钮;
 *   - 关闭 (取消 / Esc / 遮罩 / 关闭按钮) 统一经过未保存检查;
 *   - 打开时可由 Hero 首次配置入口预选模式 (presetMode)。
 *
 * 三模式恒显全部行, 按模式 disable 不可操作列 (高度稳定不跳变);
 * 公共模式根域名固定为产品内置域名。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { startSwitch, TunnelSwitchError } from '@/composables/useTunnelSwitch'
import { apiErrorText } from '@/utils/apiError'
import type { TunnelConfigResponse, TunnelActionResponse, TunnelSubdomainResponse } from '@/types/tunnel'

defineOptions({ name: 'TunnelSettingsModal' })

type TunnelMode = 'off' | 'public' | 'custom'

/** 公共模式固定内置域名 (产品配置) */
const PUBLIC_DOMAIN = 'erocraft.org'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** 打开时预选模式: Hero「连接公共节点 / 使用自定义隧道」入口传入 */
  presetMode?: TunnelMode | null
}>(), {
  presetMode: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功: 页面刷新状态与列表 */
  saved: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

/**
 * 统一判定动作结果并提示。
 *
 * 非 2xx (含 error_key) 已由 useApiFetch 统一提示 —— 这里拿到 null 直接当失败
 * 返回, **不再**用自己的 fallback 文案补一条, 否则同一次失败会弹两条。
 * 只有 HTTP 200 + ok:false 这种"业务层失败"才由本组件出文案。
 */
function actionFailed(d: TunnelActionResponse | null, fallbackKey: string): boolean {
  if (!d) return true
  if (!d.ok) {
    toast(apiErrorText(d, t(fallbackKey)), 'error')
    return true
  }
  return false
}

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
/** 服务端已生效的子域名 (公共/自定义各存一处), 用于判断是否需要重新注册 */
const serverSubdomain = ref('')
/** 服务端已生效的传输协议, 用于判断是否需要重启 cloudflared */
const serverProtocol = ref('auto')
/** 服务端已生效的自定义隧道域名/token, 用于无变化特判 */
const serverDomain = ref('')
const serverToken = ref('')

/** 应用配置失败时在弹窗内就地展示的错误文本 */
const cfgError = ref('')

const loading = ref(false)
const loadError = ref(false)

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

/** 自定义模式缺少子域名: 禁用保存并在行内提示 */
const subdomainMissing = computed(() => mode.value === 'custom' && !cfgSubdomain.value.trim())

/** 根域名展示值: 公共模式固定内置域名 (不可改), 其余显示用户配置 */
const domainDisplay = computed(() => (mode.value === 'public' ? PUBLIC_DOMAIN : cfgDomain.value))

const modeOptions = computed(() => [
  { value: 'off', label: t('tunnel.settings.mode.off') },
  { value: 'public', label: t('tunnel.settings.mode.public') },
  { value: 'custom', label: t('tunnel.settings.mode.custom') },
])

// ── 加载: 打开弹窗时拉取服务端状态与配置 ──
async function loadConfig(preset: TunnelMode | null): Promise<void> {
  const status = await get<{ tunnel_mode?: string; configured?: boolean; cf_protocol?: string; subdomain?: string; domain?: string }>('/api/tunnel/status')
  const cfg = await get<TunnelConfigResponse>('/api/tunnel/config')
  if (!status || !cfg) {
    loadError.value = true
    return
  }
  let next: TunnelMode = 'off'
  if (status.tunnel_mode === 'public') next = 'public'
  else if (status.configured) next = 'custom'
  // 子域名按当前模式读取: 公共模式存于 public_tunnel_subdomain,
  // 不在 /api/tunnel/config 的 cf_subdomain 中 (后者是自定义隧道专用)。
  let subdomain = cfg.subdomain || ''
  if (next === 'public') {
    const pub = await get<TunnelSubdomainResponse>('/api/tunnel/public/subdomain')
    if (!pub) {
      loadError.value = true
      return
    }
    subdomain = pub.subdomain || ''
  }
  loadError.value = false
  serverMode.value = next
  mode.value = next
  cfgProtocol.value = status.cf_protocol || 'auto'
  cfgSubdomain.value = subdomain
  serverSubdomain.value = subdomain
  serverProtocol.value = cfgProtocol.value
  cfgDomain.value = next === 'public' ? '' : (cfg.domain || '')
  cfgToken.value = next === 'custom' ? (cfg.api_token || '') : ''
  serverDomain.value = cfgDomain.value
  serverToken.value = cfgToken.value
  cfgLoaded.value = true
  // 基线取服务端状态; 预选模式落在基线之后, 使其立即进入 dirty (可直接保存)
  cfgSnapshot.value = snapshot()
  if (preset && preset !== next) mode.value = preset
}

async function loadAll(preset: TunnelMode | null = null): Promise<void> {
  loading.value = true
  cfgLoaded.value = false
  cfgValidResult.value = null
  cfgError.value = ''
  await loadConfig(preset)
  loading.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) void loadAll(props.presetMode)
})

// ── 应用 (弹窗级): 按模式差异应用变更, 含 confirm/teardown/switch 流程 ──

/** 目标参数是否与服务端当前生效值一致 (模式相同才调用) */
function isTargetUnchanged(sub: string): boolean {
  if (mode.value !== serverMode.value) return false
  if (mode.value === 'off') return true
  if (mode.value === 'public') return sub === serverSubdomain.value
  return cfgDomain.value.trim() === serverDomain.value
    && sub === serverSubdomain.value
    && cfgToken.value === serverToken.value
}

function validatePublicSubdomain(sub: string): boolean {
  if (sub && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(sub)) {
    toast(t('tunnel.settings.subdomain_error'), 'warning')
    return false
  }
  return true
}

/** 发起蓝绿切换; 非 202 的失败在弹窗内就地渲染, 不弹 overlay。 */
async function startSwitchOrReport(payload: {
  mode: 'custom' | 'public'
  api_token?: string
  domain?: string
  subdomain?: string
}): Promise<boolean> {
  try {
    await startSwitch(payload)
    return true
  } catch (e) {
    if (e instanceof TunnelSwitchError) {
      cfgError.value = apiErrorText(e.body, t('tunnel.err.switch_failed'))
    } else {
      cfgError.value = (e as Error)?.message || t('tunnel.err.switch_failed')
    }
    return false
  }
}

async function applyConfig(): Promise<boolean> {
  cfgSaving.value = true
  cfgError.value = ''
  try {
    const sub = cfgSubdomain.value.trim().toLowerCase()
    const modeChanged = mode.value !== serverMode.value
    const protocolChanged = cfgProtocol.value !== serverProtocol.value
    const targetUnchanged = isTargetUnchanged(sub)

    // 无变化特判: 模式与目标参数均未变化 (仅协议变化不算无变化) → 不发起切换
    if (!modeChanged && targetUnchanged && !protocolChanged) {
      toast(t('tunnel.switch.no_change'), 'info')
      return true
    }

    // 自定义模式子域名必填
    if (mode.value === 'custom' && !sub) {
      toast(t('tunnel.err.subdomain_required'), 'warning')
      return false
    }

    // 协议变更先落盘; 生效由后续 restart (仅协议变) 或切换时的新进程完成
    if (protocolChanged && !await post('/api/tunnel/protocol', { protocol: cfgProtocol.value })) return false

    // ── 模式未变 ──
    if (!modeChanged) {
      if (mode.value === 'off') return done()
      // 仅协议变化: 重启 cloudflared 生效, 不发起切换
      if (targetUnchanged) {
        const d = await post<TunnelActionResponse>('/api/tunnel/restart')
        if (actionFailed(d, 'tunnel.settings.save_failed')) return false
        return done()
      }
      if (mode.value === 'public') {
        if (!validatePublicSubdomain(sub)) return false
        const auto = t('tunnel.confirm.change_public_subdomain.auto')
        if (!await confirm({
          title: t('tunnel.confirm.change_public_subdomain.title'),
          message: t('tunnel.confirm.change_public_subdomain.message', {
            old: serverSubdomain.value || auto,
            new: sub || auto,
          }),
          confirmText: t('tunnel.confirm.change_public_subdomain.button'),
          variant: 'danger',
        })) return false
        return startSwitchOrReport({ mode: 'public', subdomain: sub })
      }
      // custom 目标参数更新
      if (!validateCustom()) return false
      if (!await confirm({
        title: t('tunnel.confirm.apply_config.title'),
        message: t('tunnel.confirm.apply_config.message'),
        confirmText: t('tunnel.confirm.apply_config.button'),
        variant: 'danger',
      })) return false
      return startSwitchOrReport({
        mode: 'custom', api_token: cfgToken.value, domain: cfgDomain.value.trim(), subdomain: sub,
      })
    }

    // ── 模式切换 ──
    if (mode.value === 'off') {
      // 关闭 = 销毁 (应用即意图, 再加一道 confirm; 不跳转)
      if (!await confirm({
        title: t('tunnel.confirm.off.title'),
        message: t('tunnel.confirm.off.message'),
        confirmText: t('tunnel.confirm.off.button'),
        variant: 'danger',
      })) return false
      if (serverMode.value === 'public') {
        if (!await post('/api/tunnel/public/disable')) return false
      } else if (serverMode.value === 'custom') {
        if (!await teardownCustom()) return false
      }
      return done()
    }

    if (mode.value === 'public') {
      if (serverMode.value === 'custom' && !await confirm({
        title: t('tunnel.confirm.to_public.title'),
        message: t('tunnel.confirm.to_public.message'),
        confirmText: t('tunnel.confirm.to_public.button'),
        variant: 'danger',
      })) return false
      if (!validatePublicSubdomain(sub)) return false
      return startSwitchOrReport({ mode: 'public', subdomain: sub })
    }

    // → custom
    if (!validateCustom()) return false
    if (serverMode.value === 'public' && !await confirm({
      title: t('tunnel.confirm.to_custom.title'),
      message: t('tunnel.confirm.to_custom.message'),
      confirmText: t('tunnel.confirm.to_custom.button'),
      variant: 'danger',
    })) return false
    return startSwitchOrReport({
      mode: 'custom', api_token: cfgToken.value, domain: cfgDomain.value.trim(), subdomain: sub,
    })
  } finally {
    cfgSaving.value = false
  }
}

function validateCustom(): boolean {
  if (!cfgToken.value || !cfgDomain.value.trim()) {
    toast(t('tunnel.settings.need_token_domain'), 'warning')
    return false
  }
  if (!cfgSubdomain.value.trim()) {
    toast(t('tunnel.err.subdomain_required'), 'warning')
    return false
  }
  return true
}

/** 销毁自定义隧道: 后端 teardown 失败时仍回 200 + {ok:false}, 必须按响应体判断 */
async function teardownCustom(): Promise<boolean> {
  const d = await post<TunnelActionResponse>('/api/tunnel/teardown')
  if (actionFailed(d, 'tunnel.settings.save_failed')) return false
  return true
}

/** 成功收尾: 不阻塞保存结果, 异步刷新基线 */
function done(): boolean {
  toast(t('tunnel.settings.applied'), 'success')
  loadConfig(null).finally(() => { cfgSnapshot.value = snapshot() })
  return true
}

async function validateToken() {
  if (!cfgToken.value || !cfgDomain.value) {
    cfgValidResult.value = { ok: false, message: t('tunnel.settings.need_token_domain') }
    return
  }
  cfgValidating.value = true
  cfgValidResult.value = { ok: true, message: t('tunnel.settings.validating') + '...' }
  const d = await post<{ ok?: boolean; account_name?: string; zone_status?: string; error?: string }>('/api/tunnel/validate', { api_token: cfgToken.value, domain: cfgDomain.value })
  cfgValidating.value = false
  if (d?.ok) cfgValidResult.value = { ok: true, message: `${d.account_name} · ${d.zone_status}` }
  else cfgValidResult.value = { ok: false, message: apiErrorText(d, t('tunnel.settings.validate_failed')) }
}

// ── 保存并关闭: 成功后通知页面刷新 ──
async function onSave(): Promise<void> {
  if (!await applyConfig()) return
  emit('saved')
  emit('update:modelValue', false)
}

// ── 关闭守卫: 取消 / Esc / 遮罩 / 关闭按钮统一经过未保存检查 ──
async function requestClose(): Promise<void> {
  if (cfgSaving.value) return
  if (cfgDirty.value) {
    const r = await confirm({
      title: t('tunnel.confirm.discard.title'),
      message: t('tunnel.confirm.discard.message'),
      confirmText: t('tunnel.confirm.discard.button'),
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
    :title="t('tunnel.settings.title')"
    width="600px"
    :close-on-overlay="!cfgSaving"
    :close-on-esc="!cfgSaving"
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
    <EmptyState v-else-if="loadError" icon="error_outline" :message="t('common.load_failed')">
      <BaseButton size="sm" @click="loadAll()">{{ t('common.btn.retry') }}</BaseButton>
    </EmptyState>

    <template v-else>
      <AlertBanner
        v-if="cfgError"
        tone="danger"
        closable
        class="tunnel-settings-error"
        @close="cfgError = ''"
      >
        {{ cfgError }}
      </AlertBanner>

      <div class="settings-lines">
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('tunnel.settings.mode.label') }}</div>
          <div class="settings-row__desc">{{ t('tunnel.settings.mode.desc') }}</div>
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

      <!-- 三模式恒显所有行: disable 不可操作列, 避免 v-if 切换导致高度跳变 -->
      <div class="settings-row" :class="{ 'settings-row--disabled': mode === 'off' }">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('tunnel.settings.subdomain') }}</div>
          <div class="settings-row__desc">{{ mode === 'public' ? t('tunnel.settings.subdomain_desc') : t('tunnel.settings.custom_subdomain_desc') }}</div>
        </div>
        <div
          class="settings-row__control"
          :class="{ 'settings-row__control--stack': mode === 'custom' && !cfgSubdomain.trim() }"
        >
          <input
            v-model="cfgSubdomain"
            type="text"
            class="form-input"
            :disabled="mode === 'off'"
            :placeholder="t('tunnel.settings.subdomain_placeholder')"
          >
          <div
            v-if="mode === 'custom' && !cfgSubdomain.trim()"
            class="settings-row__feedback settings-row__feedback--err"
          >
            {{ t('tunnel.err.subdomain_required') }}
          </div>
        </div>
      </div>

      <div class="settings-row" :class="{ 'settings-row--disabled': mode !== 'custom' }">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('tunnel.settings.root_domain') }}
            <HelpTip :text="t('tunnel.settings.root_domain_help')" />
          </div>
          <div class="settings-row__desc">{{ t('tunnel.settings.root_domain_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input
            :value="domainDisplay"
            type="text"
            class="form-input"
            :disabled="mode !== 'custom'"
            :placeholder="t('tunnel.settings.root_domain_placeholder')"
            @input="cfgDomain = ($event.target as HTMLInputElement).value"
          >
        </div>
      </div>

      <div class="settings-row" :class="{ 'settings-row--disabled': mode !== 'custom' }">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('tunnel.settings.token_label') }}
            <HelpTip :text="t('tunnel.settings.token_help')" />
          </div>
          <div class="settings-row__desc">{{ t('tunnel.settings.token_desc') }}</div>
        </div>
        <div class="settings-row__control settings-row__control--stack">
          <div class="settings-row__control-row">
            <SecretInput
              v-model="cfgToken"
              :disabled="mode !== 'custom'"
              autocomplete="off"
              :placeholder="t('tunnel.settings.token_placeholder')"
            />
            <BaseButton size="sm" :disabled="mode !== 'custom' || cfgValidating" @click="validateToken">{{ t('tunnel.settings.validate') }}</BaseButton>
          </div>
          <div
            v-if="cfgValidResult"
            class="settings-row__feedback"
            :class="cfgValidResult.ok ? 'settings-row__feedback--ok' : 'settings-row__feedback--err'"
          >
            {{ cfgValidResult.message }}
          </div>
        </div>
      </div>

      <div class="settings-row" :class="{ 'settings-row--disabled': mode === 'off' }">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('tunnel.settings.protocol') }}</div>
          <div class="settings-row__desc">{{ t('tunnel.settings.protocol_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="cfgProtocol"
            :disabled="mode === 'off'"
            :options="[
              { value: 'auto', label: t('tunnel.settings.protocol_auto') },
              { value: 'http2', label: 'HTTP/2' },
              { value: 'quic', label: 'QUIC' },
            ]"
          />
        </div>
      </div>
      </div>
    </template>

    <template #footer>
      <BaseButton :disabled="cfgSaving" @click="requestClose()">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton variant="primary" :disabled="!cfgDirty || loading || loadError || subdomainMissing" :loading="cfgSaving" @click="onSave">{{ t('common.btn.save') }}</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.tunnel-settings-error {
  margin-bottom: 12px;
}
</style>
