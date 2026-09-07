<script setup lang="ts">
/**
 * OAuthWizard — 网盘「登录授权」向导 (Add Remote modal 选中 oauth 类型的内容替换)。
 *
 * 对齐后端 OAuthSessionManager 状态机 (docs/SETTINGS_V2_OAUTH_SSH_SPEC.md §2.2):
 *   idle → starting → url_ready → exchanging → done, 失败/会话丢失 → error
 * 前端三步: 1 准备 (drive 可选 client_id/secret + 折叠的手动 Token 回退)
 *           2 授权 (轮询 status 2s → 打开授权页 → 粘贴 localhost 回调 URL)
 *           3 完成 (创建存储, create {oauth:true}, 后端取 token 并做 lsf 测试)
 *
 * 设计要点:
 * - 名称/类型输入仍由 SyncPage 渲染 (本组件只读 props), 向导只负责 OAuth 流程;
 * - 请求走私有 oauthFetch 而非 useApiFetch: 弹窗开着时 toast 是错误的落点
 *   (PathBrowserModal 同款结论)、2s 轮询失败会 toast 轰炸、且 409/400 需要
 *   按状态码分支 —— 错误一律就地展示;
 * - 会话清理铁律 (spec §2.2): modal 关闭 / 取消按钮 / 组件卸载时, 会话非 idle
 *   必须 POST cancel (fire-and-forget), 后端另有 10 分钟硬超时兜底;
 * - 轮询用 setTimeout 链式调度 + 代数计数: 不重叠、done/error/idle/关闭即停。
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { apiErrorText } from '@/utils/apiError'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import FormField from '@/components/form/FormField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import Spinner from '@/components/ui/Spinner.vue'
import type {
  ApiOkResponse, OAuthPhase, OAuthSessionResponse, OAuthStatusResponse,
  RemoteCreateRequest, RemoteField, RemoteTypeDef,
} from '@/types/sync'

defineOptions({ name: 'OAuthWizard' })

const POLL_MS = 2000
/** 连续失败阈值: 超过则停轮询降级为 error (面板重启 / 网络故障), 避免 2s 一次地空转 */
const MAX_POLL_FAILURES = 3

const props = defineProps<{
  /** modal 开关 (SyncPage 的 addRemoteModal) — 变 false 时停轮询并 cancel 会话 */
  modelValue: boolean
  /** /api/sync/remote/types 的类型表 (取字段定义) */
  types: Record<string, RemoteTypeDef>
  /** 远程存储名称 (SyncPage 表单, 创建时随 create 提交) */
  name: string
  /** 选中的 remote 类型 key */
  type: string
}>()

const emit = defineEmits<{
  /** 创建成功 — SyncPage 负责关 modal + 刷新列表 */
  created: []
  /** 用户点取消 — SyncPage 关闭 modal, 会话清理由 modelValue watcher 统一处理 */
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

// ── 会话状态 ──

const phase = ref<OAuthPhase>('idle')
const providerUrl = ref('')
/** 步骤 2 的错误展示 (start 失败 / 轮询 error / 会话丢失) */
const statusError = ref('')
const pasteUrl = ref('')
/** 粘贴回调格式错误的就地提示 (400 invalid_callback 停留在步骤 2) */
const pasteError = ref('')
/** 创建失败的就地提示 (oauth create / 手动 Token create 共用) */
const createError = ref('')
const starting = ref(false)
const pasting = ref(false)
const creating = ref(false)
const manualCreating = ref(false)

/** 动态字段参数 (drive 的 client_id/client_secret + 手动模式的 token 等) */
const params = ref<Record<string, string>>({})

const def = computed(() => props.types[props.type] || null)

/** 向导步骤: idle=1 准备 · starting/url_ready/exchanging/error=2 授权 · done=3 创建 */
const step = computed(() => (phase.value === 'idle' ? 1 : phase.value === 'done' ? 3 : 2))

const stepLabels = computed(() => [
  t('sync.oauth.step_prepare'),
  t('sync.oauth.step_authorize'),
  t('sync.oauth.step_create'),
])

/**
 * 向导主区直接渲染的凭据字段 (drive 的 client_id/client_secret)。
 * 以后端类型表下发为准; 类型表尚未带上时的 drive 兜底保证功能可用。
 */
const credentialFields = computed<RemoteField[]>(() => {
  const fields = def.value?.fields || []
  const creds = fields.filter(f => f.key === 'client_id' || f.key === 'client_secret')
  if (creds.length || props.type !== 'drive') return creds
  return [
    { key: 'client_id', label: 'Client ID', type: 'text' },
    { key: 'client_secret', label: 'Client Secret', type: 'password' },
  ]
})

/** 折叠「高级：手动粘贴 Token」里的动态字段 (凭据字段已在主区渲染, 去重) */
const manualFields = computed<RemoteField[]>(() =>
  (def.value?.fields || []).filter(f => f.key !== 'client_id' && f.key !== 'client_secret')
)

function resetParams() {
  const next: Record<string, string> = {}
  for (const f of [...credentialFields.value, ...manualFields.value]) {
    if (f.default !== undefined) next[f.key] = f.default
  }
  params.value = next
}
resetParams()

// ── 请求封装 ──

interface OAuthFetchResult<T> { status: number; data: T | null }

/**
 * OAuth 端点专用请求。不用 useApiFetch 的原因见文件头: 错误不 toast (轮询防轰炸 /
 * 弹窗内就地展示), 保留状态码给调用方按契约分支 (409 session_active / 400 invalid_callback)。
 */
async function oauthFetch<T = ApiOkResponse>(url: string, body?: unknown): Promise<OAuthFetchResult<T>> {
  try {
    const res = await fetch(url, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      window.location.href = '/login'
      return { status: 401, data: null }
    }
    let data: T | null = null
    try { data = await res.json() as T } catch { /* 空响应体 */ }
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null }
  }
}

/**
 * OAuth 端点错误 → 展示文案。后端 error_key 若未进前端 locale, apiErrorText 会
 * 原样吐 key (或裸错误码如 invalid_callback) —— 此时落回 UI 兜底文案;
 * detail (rclone 原始报错) 追加在后面, 纯 snake_case 错误码不当 detail 展示。
 */
function oauthErrText(data: ApiOkResponse | null, fallback: string): string {
  let text = apiErrorText(data, '')
  if (!text || /^[a-z0-9_.-]+$/.test(text)) text = fallback
  const p = data?.error_params as Record<string, unknown> | undefined
  const detail = (p?.detail ?? data?.error ?? data?.message ?? '') as unknown
  const d = typeof detail === 'string' && detail && !/^[a-z0-9_]+$/.test(detail) ? detail : ''
  return d ? `${text}：${d}` : text
}

// ── 状态机流转 ──

function applyPhase(d: Partial<OAuthStatusResponse>) {
  switch (d.phase) {
    case 'starting':
      phase.value = 'starting'
      break
    case 'url_ready':
      phase.value = 'url_ready'
      if (d.provider_url) providerUrl.value = d.provider_url
      break
    case 'exchanging':
      phase.value = 'exchanging'
      break
    case 'done':
      phase.value = 'done'
      stopPolling()
      break
    case 'error':
      phase.value = 'error'
      statusError.value = d.error || t('sync.oauth.error_unknown')
      stopPolling()
      break
    case 'idle':
    default:
      // 会话丢失 (如面板重启, spec §2.4): 引导重新开始
      phase.value = 'error'
      statusError.value = t('sync.oauth.session_lost')
      stopPolling()
      break
  }
}

function resetFlowState() {
  stopPolling()
  phase.value = 'idle'
  providerUrl.value = ''
  statusError.value = ''
  pasteUrl.value = ''
  pasteError.value = ''
  createError.value = ''
}

// ── 轮询 (setTimeout 链式调度 + 代数计数, 不重叠) ──

let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollGen = 0
let pollFailures = 0

function startPolling() {
  stopPolling()
  pollFailures = 0
  const gen = ++pollGen
  void pollTick(gen)
}

function stopPolling() {
  pollGen++
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

async function pollTick(gen: number) {
  if (gen !== pollGen) return
  const { status, data } = await oauthFetch<OAuthStatusResponse>('/api/sync/remote/oauth/status')
  if (gen !== pollGen) return
  if (status === 200 && data) {
    pollFailures = 0
    applyPhase(data)
  } else {
    pollFailures++
  }
  if (pollFailures >= MAX_POLL_FAILURES) {
    stopPolling()
    phase.value = 'error'
    statusError.value = t('sync.oauth.poll_failed')
    return
  }
  // done / error 已在 applyPhase 里停轮询; 进行中的阶段才安排下一轮
  if (phase.value === 'starting' || phase.value === 'url_ready' || phase.value === 'exchanging') {
    pollTimer = setTimeout(() => void pollTick(gen), POLL_MS)
  }
}

// ── 会话清理 (spec §2.2 铁律) ──

/** fire-and-forget: 后端 kill 进程 → idle; 失败无从补救 (10 分钟硬超时兜底) */
function cancelSession() {
  void oauthFetch('/api/sync/remote/oauth/cancel', {})
}

function cleanup() {
  if (phase.value !== 'idle') cancelSession()
  resetFlowState()
}

watch(() => props.modelValue, (open) => {
  if (!open) cleanup()
})
onUnmounted(cleanup)

// ── 步骤 1 → 2: 启动授权 ──

function validateName(): boolean {
  const name = props.name.trim()
  if (!name) {
    toast(t('sync.remote.fill_required'), 'warning')
    return false
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    toast(t('sync.remote.invalid_name'), 'warning')
    return false
  }
  return true
}

async function startAuth() {
  if (!validateName()) return
  starting.value = true
  statusError.value = ''
  pasteError.value = ''
  createError.value = ''
  const body: Record<string, unknown> = { type: props.type }
  const clientId = params.value.client_id?.trim()
  const clientSecret = params.value.client_secret?.trim()
  if (clientId) body.client_id = clientId
  if (clientSecret) body.client_secret = clientSecret
  const { status, data } = await oauthFetch<OAuthSessionResponse>('/api/sync/remote/oauth/start', body)
  starting.value = false
  if (status === 409) {
    // 并发冲突: 后端单例会话 —— 拉一次 status 直接恢复到对应步骤 (同类型时)
    const st = await oauthFetch<OAuthStatusResponse>('/api/sync/remote/oauth/status')
    const d = st.data
    if (st.status === 200 && d?.phase && !['idle', 'error'].includes(d.phase)) {
      if (d.remote_type && d.remote_type !== props.type) {
        toast(t('sync.oauth.session_active_other', { type: d.remote_type }), 'warning')
      } else {
        toast(t('sync.oauth.session_active'), 'info')
        applyPhase(d)
        if (step.value === 2) startPolling()
      }
    } else {
      toast(t('sync.oauth.session_active'), 'warning')
    }
    return
  }
  if (status !== 200 || !data?.ok) {
    phase.value = 'error'
    statusError.value = oauthErrText(data, t('sync.oauth.start_failed'))
    return
  }
  applyPhase({ phase: data.phase || 'starting' })
  startPolling()
}

// ── 步骤 2: 粘贴回调 URL ──

async function submitPaste() {
  const url = pasteUrl.value.trim()
  if (!url) {
    pasteError.value = t('sync.oauth.paste_required')
    return
  }
  pasteError.value = ''
  pasting.value = true
  const { status, data } = await oauthFetch<OAuthSessionResponse>('/api/sync/remote/oauth/paste', { url })
  pasting.value = false
  if (status === 200 && data?.ok) {
    pasteUrl.value = ''
    applyPhase({ phase: data.phase || 'exchanging' })
    startPolling()
    return
  }
  if (status === 400) {
    // 格式错误: 停留在步骤 2, 就地提示
    pasteError.value = oauthErrText(data, t('sync.oauth.invalid_callback'))
    return
  }
  if (status === 409) {
    // 阶段不符 (UI 与会话脱节): 拉一次 status 对齐
    const st = await oauthFetch<OAuthStatusResponse>('/api/sync/remote/oauth/status')
    if (st.status === 200 && st.data) {
      applyPhase(st.data)
      if (step.value === 2) startPolling()
      return
    }
  }
  pasteError.value = oauthErrText(data, t('sync.oauth.paste_failed'))
}

// ── 创建存储 (步骤 3 oauth 路径 / 步骤 1 手动 Token 路径) ──

/**
 * OneDrive 企业版/团队盘兜底 (spec §2.4): lsf 连通性测试失败时 rclone 报
 * drive_id / SharePoint 关键字 —— 追加提示, 避免用户误判为 token 错误反复重试。
 */
function buildCreateError(data: ApiOkResponse | null): string {
  const text = apiErrorText(data, t('sync.remote.create_failed'))
  return /drive_id|sharepoint/i.test(JSON.stringify(data || {}))
    ? `${text}\n${t('sync.oauth.onedrive_enterprise_hint')}`
    : text
}

async function createOauth() {
  if (!validateName()) return
  creating.value = true
  createError.value = ''
  const cred: Record<string, string> = {}
  for (const f of credentialFields.value) {
    const v = params.value[f.key]?.trim()
    if (v) cred[f.key] = v
  }
  const body: RemoteCreateRequest = { name: props.name.trim(), type: props.type, oauth: true, params: cred }
  const { status, data } = await oauthFetch<ApiOkResponse>('/api/sync/remote/create', body)
  creating.value = false
  if (status === 200 && data?.ok) {
    emit('created')
    return
  }
  createError.value = buildCreateError(data)
}

/** 折叠的回退路径: 本地 rclone authorize 拿 token 粘贴, 走普通 create (无 oauth 标记) */
async function manualCreate() {
  if (!validateName()) return
  const missing = manualFields.value.filter(f => f.required && !params.value[f.key]?.trim())
  if (missing.length) {
    toast(t('sync.remote.missing_fields', { fields: missing.map(f => f.label).join(', ') }), 'warning')
    return
  }
  manualCreating.value = true
  createError.value = ''
  const body: RemoteCreateRequest = { name: props.name.trim(), type: props.type, params: { ...params.value } }
  const { status, data } = await oauthFetch<ApiOkResponse>('/api/sync/remote/create', body)
  manualCreating.value = false
  if (status === 200 && data?.ok) {
    emit('created')
    return
  }
  createError.value = buildCreateError(data)
}

// ── 返回 / 切换类型 ──

/** 从步骤 2/3 回到步骤 1: 当前会话作废 */
function backToPrepare() {
  if (phase.value !== 'idle') cancelSession()
  resetFlowState()
}

/** 切换类型: 参数重置; 若有进行中的会话一并作废 */
watch(() => props.type, () => {
  resetParams()
  if (phase.value !== 'idle') cancelSession()
  resetFlowState()
})
</script>

<template>
  <div class="oauth-wizard">
    <!-- 步骤指示 -->
    <div class="oauth-steps">
      <span
        v-for="(label, i) in stepLabels"
        :key="label"
        class="oauth-step"
        :class="{ active: step === i + 1 }"
      >
        <span class="oauth-step-num">{{ i + 1 }}</span>{{ label }}
      </span>
    </div>

    <!-- ── 步骤 1: 准备 ── -->
    <template v-if="step === 1">
      <!-- drive 自带 client_id (rclone 共享 client_id 2026 退役, spec §2.1-7) -->
      <template v-if="credentialFields.length">
        <FormField
          v-for="f in credentialFields"
          :key="f.key"
          density="compact"
          :hint="f.key === 'client_secret' ? undefined : (f.help || undefined)"
        >
          <template #label>{{ f.label }}</template>
          <SecretInput
            v-if="f.type === 'password' || f.key === 'client_secret'"
            v-model="params[f.key]"
            :is-password="true"
            :placeholder="f.placeholder || ''"
          />
          <input
            v-else
            v-model="params[f.key]"
            type="text"
            class="form-input"
            :placeholder="f.placeholder || ''"
            autocomplete="off"
          >
        </FormField>
        <p class="oauth-hint">
          {{ t('sync.oauth.drive_client_hint') }}
          <a
            class="oauth-link"
            href="https://rclone.org/drive/#making-your-own-client_id"
            target="_blank"
            rel="noopener"
          >{{ t('sync.oauth.drive_client_link') }}</a>
        </p>
      </template>

      <!-- 回退路径: 本地 rclone authorize 手动粘 token (默认收起) -->
      <details v-if="manualFields.length" class="oauth-advanced">
        <summary>{{ t('sync.oauth.advanced_manual') }}</summary>
        <div class="oauth-advanced-body">
          <p class="oauth-hint">{{ t('sync.remote.oauth_token_tooltip', { type }) }}</p>
          <FormField
            v-for="f in manualFields"
            :key="f.key"
            density="compact"
            :hint="f.key === 'token' ? undefined : (f.help || undefined)"
          >
            <template #label>
              {{ f.label }}<template v-if="f.required && f.key !== 'token'"> *</template>
              <HelpTip v-if="f.key === 'token'" :text="t('sync.remote.oauth_token_tooltip', { type })" />
            </template>
            <textarea v-if="f.type === 'textarea'" v-model="params[f.key]" rows="3" class="form-textarea" :placeholder="f.placeholder || ''"></textarea>
            <BaseSelect v-else-if="f.type === 'select'" v-model="params[f.key]" :options="f.options || []" teleport />
            <input v-else v-model="params[f.key]" :type="f.type === 'password' ? 'password' : 'text'" class="form-input" :placeholder="f.placeholder || ''" autocomplete="off">
          </FormField>
          <div class="oauth-actions">
            <BaseButton variant="primary" size="sm" :loading="manualCreating" @click="manualCreate">
              {{ t('sync.oauth.manual_create') }}
            </BaseButton>
          </div>
        </div>
      </details>
    </template>

    <!-- ── 步骤 2: 授权 ── -->
    <template v-else-if="step === 2">
      <!-- starting / exchanging: loading 态 -->
      <div v-if="phase === 'starting' || phase === 'exchanging'" class="oauth-loading">
        <Spinner size="sm" />
        <span>{{ phase === 'starting' ? t('sync.oauth.starting') : t('sync.oauth.exchanging') }}</span>
      </div>

      <!-- url_ready: 打开授权页 + 粘贴回调 URL -->
      <template v-else-if="phase === 'url_ready'">
        <!-- rel=noopener 走 Vue attribute fallthrough 落到渲染出的 <a> 上 -->
        <BaseButton
          variant="primary"
          size="lg"
          class="oauth-open-btn"
          :href="providerUrl"
          target="_blank"
          rel="noopener"
          :disabled="!providerUrl"
        >
          <MsIcon name="open_in_new" />
          {{ t('sync.oauth.open_auth_page') }}
        </BaseButton>
        <p class="oauth-hint oauth-hint--warn">{{ t('sync.oauth.localhost_hint') }}</p>
        <p class="oauth-hint">{{ t('sync.oauth.google_unverified_hint') }}</p>
        <FormField :label="t('sync.oauth.paste_label')" density="compact" :error="pasteError || undefined">
          <div class="oauth-paste-row">
            <input
              v-model="pasteUrl"
              type="text"
              class="form-input"
              :placeholder="t('sync.oauth.paste_placeholder')"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter="submitPaste"
            >
            <BaseButton variant="primary" :loading="pasting" @click="submitPaste">{{ t('sync.oauth.paste_submit') }}</BaseButton>
          </div>
        </FormField>
      </template>
    </template>

    <!-- ── 步骤 3: 完成 ── -->
    <template v-else>
      <div class="oauth-done">
        <MsIcon name="check_circle" class="oauth-done-icon" />
        <div>
          <div class="oauth-done-title">{{ t('sync.oauth.done_title') }}</div>
          <p class="oauth-hint">{{ t('sync.oauth.done_hint') }}</p>
        </div>
      </div>
    </template>

    <!-- 错误就地展示 (弹窗开着时 toast 是错的落点) -->
    <p v-if="step === 2 && phase === 'error'" class="oauth-error">{{ statusError }}</p>
    <p v-if="createError" class="oauth-error">{{ createError }}</p>

    <!-- 底部动作区 -->
    <div class="oauth-actions">
      <template v-if="step === 1">
        <BaseButton size="sm" variant="ghost" @click="emit('cancel')">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton size="sm" variant="primary" :loading="starting" @click="startAuth">{{ t('sync.oauth.start') }}</BaseButton>
      </template>
      <template v-else-if="step === 2">
        <template v-if="phase === 'error'">
          <BaseButton size="sm" variant="ghost" @click="backToPrepare">{{ t('sync.oauth.back') }}</BaseButton>
          <BaseButton size="sm" variant="primary" :loading="starting" @click="startAuth">{{ t('common.btn.retry') }}</BaseButton>
        </template>
        <template v-else>
          <BaseButton size="sm" variant="ghost" @click="emit('cancel')">{{ t('common.btn.cancel') }}</BaseButton>
        </template>
      </template>
      <template v-else>
        <BaseButton size="sm" variant="ghost" @click="backToPrepare">{{ t('sync.oauth.back') }}</BaseButton>
        <BaseButton size="sm" variant="primary" :loading="creating" @click="createOauth">{{ t('sync.oauth.create') }}</BaseButton>
      </template>
    </div>
  </div>
</template>

<style scoped>
.oauth-wizard { display: flex; flex-direction: column; }

/* ── 步骤指示 ── */
.oauth-steps { display: flex; gap: 12px; margin-bottom: 12px; }
.oauth-step { display: inline-flex; align-items: center; gap: 5px; font-size: .72rem; color: var(--t3); }
.oauth-step.active { color: var(--t1); font-weight: 600; }
.oauth-step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--bg2); border: 1px solid var(--bd); font-size: .62rem;
}
.oauth-step.active .oauth-step-num {
  background: color-mix(in srgb, var(--ac) 65%, var(--bg3));
  border-color: transparent; color: #fff;
}

/* ── 文案 ── */
.oauth-hint { font-size: .74rem; line-height: 1.5; color: var(--t3); margin: 2px 0 6px; white-space: pre-line; }
.oauth-hint--warn { color: var(--amber); }
.oauth-link { color: var(--ac); text-decoration: none; margin-left: 4px; white-space: nowrap; }
.oauth-link:hover { text-decoration: underline; }
.oauth-error { font-size: .76rem; line-height: 1.5; color: var(--red); margin: 6px 0 0; white-space: pre-line; }

/* ── 步骤 1: 高级手动回退 ── */
.oauth-advanced { border: 1px solid var(--bd); border-radius: var(--rs); padding: 0 10px; margin: 4px 0 8px; }
.oauth-advanced summary { cursor: pointer; font-size: .78rem; color: var(--t2); padding: 8px 0; user-select: none; }
.oauth-advanced-body { padding: 2px 0 10px; }

/* ── 步骤 2 ── */
.oauth-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 20px 0; color: var(--t2); font-size: .85rem; }
.oauth-open-btn { width: 100%; margin-bottom: 4px; }
.oauth-paste-row { display: flex; gap: 6px; width: 100%; }
.oauth-paste-row .form-input { flex: 1; min-width: 0; }

/* ── 步骤 3 ── */
.oauth-done { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0 4px; }
.oauth-done-icon { color: var(--green); font-size: 1.6rem; }
.oauth-done-title { font-weight: 600; }

/* ── 动作区 ── */
.oauth-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
