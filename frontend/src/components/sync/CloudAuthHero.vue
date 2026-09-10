<script setup lang="ts">
/**
 * CloudAuthHero — v3 风格云存储 OAuth 授权卡片。
 *
 * 契约规范 (docs/CLOUD_SYNC_OAUTH_V3_IMPLEMENTATION_PLAN.md §4.1):
 * - 四态:
 *   1. 初始 (idle): 居中 48px 图标底座 (modal 42px) + 品牌 logo + 标题「连接 {provider}」
 *      + 说明「在浏览器中完成登录」+ 唯一主按钮「使用 {provider} 登录」
 *      + drive 自建 client_id/secret 收进「高级：自建 Client ID」折叠 (仅初始态显示)
 *   2. 等待 (starting / url_ready / exchanging):
 *      - 说明行「已在浏览器中打开授权页面 [重新打开]」(行内链接，无独立按钮)
 *      - 旋转 loader 胶囊「等待授权完成」/「正在换取令牌…」
 *      - 粘贴提示「完成授权后浏览器会跳转到一个打不开的 localhost 页面。请复制浏览器地址栏的完整 URL 粘贴到下方。」
 *      - 无标题粘贴输入框 (校验随父组件点击「继续」触发，本组件提供 validatePaste() 供父调用)
 *   3. 完成 (done):
 *      - 状态行「✓ 授权完成」+ 链接「更换账号」(重开会话)
 *   4. 失败 (error):
 *      - 就地错误展示 + 主按钮「重新登录」
 * - 逻辑完全对齐 OAuthWizard.vue:
 *   - POLL_MS (2000ms), 代数计数 pollGen, 连续失败阈值 (3 次)
 *   - 会话清理铁律: 组件卸载 / cancel / 返回时非 idle 会话 POST /oauth/cancel
 *   - 并发 409 恢复: 检查同类型会话对齐
 *   - 错误码 oauthErrText 提取与 fallback
 * - 暴露接口 (defineExpose):
 *   - validatePaste(): Promise<boolean>
 *   - cancel(): void
 *   - startAuth(): Promise<void>
 *   - reconnect(): void
 *   - getParams(): Record<string, string>
 *   - retryDrives(): Promise<void>
 *   - phase: Ref<OAuthPhase>
 *   - isDone: ComputedRef<boolean>
 *   - drivesReady: ComputedRef<boolean>
 *   - readyForCreate: ComputedRef<boolean>
 *
 * identity 模式 (向导 step3 的「下方单卡」): 授权不需要存储名称 —— token 经
 * 服务端会话保管, 名称只在最终创建 remote 时使用。开启后 done 态在卡片内
 * 展示「存储名称 + 驱动器选择」, getParams() 合并 drive_id/team_drive 等参数,
 * dashboard 弹窗流程 (名称在外部表单/目录态) 不受影响。
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { redirectToLogin } from '@/composables/useApiFetch'
import { apiErrorText } from '@/utils/apiError'
import MsIcon from '@/components/ui/MsIcon.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect, { type SelectOption } from '@/components/form/BaseSelect.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import FormField from '@/components/form/FormField.vue'
import { remoteBrand } from '@/config/remote-logos'
import type {
  ApiOkResponse, DrivesResponse, OAuthDriveItem, OAuthPhase, OAuthSessionResponse,
  OAuthStatusResponse, RemoteTypeDef,
} from '@/types/sync'

defineOptions({ name: 'CloudAuthHero' })

const POLL_MS = 2000
const MAX_POLL_FAILURES = 3

const props = withDefaults(defineProps<{
  /** 选中的 remote 类型 key (drive, onedrive, dropbox) */
  type: string
  /** 是否以弹窗内紧凑模式渲染 (modal 42px 图标, 默认 false 为 48px) */
  modal?: boolean
  /** 是否处于激活态 (false 时触发 cancelSession 避免背景泄露) */
  active?: boolean
  /** 远端类型定义表 (取字段定义, 如 drive 的 client_id/client_secret) */
  types?: Record<string, RemoteTypeDef>
  /** done 态在卡片内展示存储名称 + 驱动器选择 (向导单卡模式) */
  identity?: boolean
  /** 恢复态: 跳过登录/等待直接落 done 屏 (凭据已在服务端草稿, 无需会话)。
   *  用于向导 step3 回退重进 —— 名称由父组件恢复, 「更换账号」仍可重授权 */
  restored?: boolean
  /** 恢复态已有的非敏感 OAuth 参数 (如 drive_id/team_drive/drive_type)。 */
  restoredParams?: Record<string, string>
}>(), {
  modal: false,
  active: true,
  identity: false,
  restored: false,
  restoredParams: () => ({}),
  types: () => ({}),
})

/** 存储名称 (identity 模式在 done 态由卡片内输入框管理) */
const name = defineModel<string>('name', { default: '' })

const emit = defineEmits<{
  /** 授权完成 (phase === 'done'), 附带可选的自建凭据参数 */
  authorized: [params: Record<string, string>]
  /** 状态机流转通知 */
  'update:phase': [phase: OAuthPhase]
  /** 用户点击「更换账号」重置 */
  reset: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

// ── 会话状态 ──

const phase = ref<OAuthPhase>(props.restored ? 'done' : 'idle')
const providerUrl = ref('')
const statusError = ref('')
const pasteUrl = ref('')
const pasteError = ref('')
const starting = ref(false)
const pasting = ref(false)
const hasOpenedWindow = ref(false)

/** 动态字段参数 (drive 的 client_id/client_secret) */
const params = ref<Record<string, string>>({})

// ── 驱动器 (identity 模式, done 态选择) ──

const drives = ref<OAuthDriveItem[]>([])
const selectedDrive = ref(
  props.restored
    ? (props.type === 'onedrive' ? props.restoredParams.drive_id : props.restoredParams.team_drive) || ''
    : '',
)
const drivesLoading = ref(false)
const drivesError = ref('')
const drivesFetched = ref(false)
let drivesPromise: Promise<void> | null = null
let drivesGeneration = 0

/** 支持驱动器选择的类型 (done 态 select 恒占位, 选项延迟加载, 避免布局跳动) */
const hasDrives = computed(() => props.type === 'onedrive' || props.type === 'drive')

/** 恢复态不再持有 OAuth session, 只能使用父组件传入的非敏感参数。 */
const restoredDriveReady = computed(() => {
  if (!props.restored || !props.identity || !hasDrives.value) return false
  if (props.type === 'onedrive') {
    return !!props.restoredParams.drive_id && !!props.restoredParams.drive_type
  }
  return props.type === 'drive'
})

if (props.restored && hasDrives.value && !restoredDriveReady.value && props.type === 'onedrive') {
  drivesError.value = t('sync.oauth.drives_required')
}

/** 驱动器下拉: 伪条目 id 恒为空串 → 显示「我的云端硬盘」;
 *  拉取失败/未返回时保持空列表, 由错误提示和重试按钮处理。 */
const driveOptions = computed<SelectOption[]>(() => {
  if (drives.value.length) {
    return drives.value.map(d => ({ value: d.id, label: d.id === '' ? t('sync.oauth.my_drive') : d.name }))
  }
  // 恢复态只拿到 ID 时仍显示当前值, 但不伪造一个默认主盘选项。
  if (props.restored && selectedDrive.value) {
    return [{ value: selectedDrive.value, label: selectedDrive.value }]
  }
  if (props.restored && props.type === 'drive') {
    return [{ value: '', label: t('sync.oauth.my_drive') }]
  }
  return []
})

/** done 态拉取驱动器列表 (依赖服务端 oauth session, 须在创建 remote 前调用);
 *  拉取失败阻断创建并在卡片内提供重试。 */
async function fetchDrives() {
  if (!props.identity || drivesFetched.value || !hasDrives.value || restoredDriveReady.value) return
  const generation = drivesGeneration
  drivesFetched.value = true
  drivesLoading.value = true
  drivesError.value = ''
  const { status, data } = await oauthFetch<DrivesResponse>('/api/sync/remote/oauth/drives')
  if (generation !== drivesGeneration) return
  drivesLoading.value = false
  if (status === 200 && data?.drives?.length) {
    drives.value = data.drives
    selectedDrive.value = data.drives[0]?.id || ''
    drivesError.value = ''
    return
  }
  drives.value = []
  selectedDrive.value = ''
  drivesError.value = apiErrorText(data, t('sync.oauth.drives_failed'))
}

/** 复用 done 态已有的请求, 让调用方不会在驱动器列表返回前继续创建。 */
function ensureDrivesLoaded(): Promise<void> {
  if (!props.identity || !hasDrives.value || restoredDriveReady.value || drivesReady.value) {
    return Promise.resolve()
  }
  if (!drivesPromise) {
    const request = fetchDrives()
    drivesPromise = request
    request.finally(() => {
      if (drivesPromise === request) drivesPromise = null
    })
  }
  return drivesPromise
}

function resetDrives() {
  drivesGeneration += 1
  drivesPromise = null
  drivesFetched.value = false
  drivesLoading.value = false
  drives.value = []
  selectedDrive.value = ''
  drivesError.value = ''
}

/** 驱动器加载失败时由 done 屏上的重试按钮调用。 */
async function retryDrives() {
  drivesGeneration += 1
  drivesPromise = null
  drivesFetched.value = false
  await ensureDrivesLoaded()
}

const brand = computed(() => remoteBrand(props.type))

const providerName = computed(() => {
  const map: Record<string, string> = {
    drive: 'Google Drive',
    onedrive: 'OneDrive',
    dropbox: 'Dropbox',
  }
  return map[props.type] || props.type
})

const isDone = computed(() => phase.value === 'done')
const isWaiting = computed(() => phase.value === 'starting' || phase.value === 'url_ready' || phase.value === 'exchanging')

/** 驱动器列表是创建 drive/onedrive remote 的前置条件, 失败时禁止静默回落主盘。 */
const drivesReady = computed(() =>
  !props.identity || !hasDrives.value
  || restoredDriveReady.value
  || (!drivesLoading.value && !drivesError.value && drives.value.length > 0),
)

/** 只有 done 且驱动器上下文完整时才允许父流程落盘创建。 */
const readyForCreate = computed(() => {
  if (!isDone.value || !drivesReady.value) return false
  if (!props.identity || props.type !== 'onedrive') return true
  const p = getParams()
  return !!p.drive_id && !!p.drive_type
})

/** 登录按钮文案: 按 provider 用「xx 账号登录」措辞 (标题仍用品牌名) */
const startLabel = computed(() => {
  const keys: Record<string, string> = {
    drive: 'sync.oauth.start_drive',
    onedrive: 'sync.oauth.start_onedrive',
    dropbox: 'sync.oauth.start_dropbox',
  }
  return keys[props.type] ? t(keys[props.type]) : t('sync.oauth.start_with_provider', { provider: providerName.value })
})

/** 是否在初始态显示 drive 的自建 client_id 折叠 */
const showDriveAdvanced = computed(() =>
  props.type === 'drive' && phase.value !== 'starting' && phase.value !== 'url_ready' && phase.value !== 'exchanging' && phase.value !== 'done'
)

// ── 请求封装 ──

interface OAuthFetchResult<T> { status: number; data: T | null }

async function oauthFetch<T = ApiOkResponse>(url: string, body?: unknown): Promise<OAuthFetchResult<T>> {
  try {
    const res = await fetch(url, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      redirectToLogin()
      return { status: 401, data: null }
    }
    let data: T | null = null
    try { data = await res.json() as T } catch { /* 空响应体 */ }
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null }
  }
}

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
      emit('update:phase', 'starting')
      break
    case 'url_ready':
      phase.value = 'url_ready'
      emit('update:phase', 'url_ready')
      if (d.provider_url) {
        providerUrl.value = d.provider_url
        if (!hasOpenedWindow.value) {
          hasOpenedWindow.value = true
          try {
            window.open(d.provider_url, '_blank')
          } catch {
            // 被拦截时由说明行的「重新打开」按钮兜底
          }
        }
      }
      break
    case 'exchanging':
      phase.value = 'exchanging'
      emit('update:phase', 'exchanging')
      break
    case 'done':
      phase.value = 'done'
      stopPolling()
      emit('authorized', getParams())
      emit('update:phase', 'done')
      // identity 模式: 授权完成即拉驱动器 (session 仍在, 创建 remote 后即清)
      void ensureDrivesLoaded()
      break
    case 'error':
      phase.value = 'error'
      statusError.value = d.error || t('sync.oauth.error_unknown')
      stopPolling()
      emit('update:phase', 'error')
      break
    case 'idle':
    default:
      phase.value = 'error'
      statusError.value = t('sync.oauth.session_lost')
      stopPolling()
      emit('update:phase', 'error')
      break
  }
}

// ── 轮询 (setTimeout 链式调度 + 代数计数) ──

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
    emit('update:phase', 'error')
    return
  }
  if (phase.value === 'starting' || phase.value === 'url_ready' || phase.value === 'exchanging') {
    pollTimer = setTimeout(() => void pollTick(gen), POLL_MS)
  }
}

// ── 会话清理 ──

function cancelSession() {
  void oauthFetch('/api/sync/remote/oauth/cancel', {})
  stopPolling()
  phase.value = 'idle'
  providerUrl.value = ''
  statusError.value = ''
  pasteUrl.value = ''
  pasteError.value = ''
  hasOpenedWindow.value = false
  resetDrives()
  emit('update:phase', 'idle')
}

onUnmounted(() => {
  // done 会话持有待 remote/create 消费的 token (create 发生在卸载后的目录态),
  // 不能 cancel; 只清理 pending 态 (starting/url_ready/exchanging)。
  if (phase.value !== 'idle' && phase.value !== 'done') {
    void oauthFetch('/api/sync/remote/oauth/cancel', {})
  }
  stopPolling()
})

watch(() => props.active, (active) => {
  if (!active && phase.value !== 'idle') {
    cancelSession()
  }
})

watch(() => props.type, () => {
  cancelSession()
  params.value = {}
  resetDrives()
})

// ── 启动授权 ──

async function startAuth() {
  starting.value = true
  statusError.value = ''
  pasteError.value = ''
  hasOpenedWindow.value = false

  const body: Record<string, unknown> = { type: props.type }
  const clientId = params.value.client_id?.trim()
  const clientSecret = params.value.client_secret?.trim()
  if (clientId) body.client_id = clientId
  if (clientSecret) body.client_secret = clientSecret

  const { status, data } = await oauthFetch<OAuthSessionResponse>('/api/sync/remote/oauth/start', body)
  starting.value = false

  if (status === 409) {
    const st = await oauthFetch<OAuthStatusResponse>('/api/sync/remote/oauth/status')
    const d = st.data
    if (st.status === 200 && d?.phase && !['idle', 'error'].includes(d.phase)) {
      if (d.remote_type && d.remote_type !== props.type) {
        toast(t('sync.oauth.session_active_other', { type: d.remote_type }), 'warning')
      } else {
        toast(t('sync.oauth.session_active'), 'info')
        applyPhase(d)
        if (d.phase !== 'done') startPolling()
      }
    } else {
      toast(t('sync.oauth.session_active'), 'warning')
    }
    return
  }

  if (status !== 200 || !data?.ok) {
    phase.value = 'error'
    statusError.value = oauthErrText(data, t('sync.oauth.start_failed'))
    emit('update:phase', 'error')
    return
  }

  applyPhase({ phase: data.phase || 'starting' })
  startPolling()
}

/** 重新打开授权页面 (若尚未获取到 url 则重新 startAuth) */
function reopenAuth() {
  if (providerUrl.value) {
    window.open(providerUrl.value, '_blank')
  } else {
    void startAuth()
  }
}

/** 更换账号: 重置会话回到初始卡片 */
function reconnect() {
  cancelSession()
  emit('reset')
}

function getParams(): Record<string, string> {
  // 恢复态可带回上次创建时的非 token 参数; 新授权不继承旧选择。
  const res: Record<string, string> = props.restored ? { ...props.restoredParams } : {}
  if (params.value.client_id?.trim()) res.client_id = params.value.client_id.trim()
  if (params.value.client_secret?.trim()) res.client_secret = params.value.client_secret.trim()
  // identity 模式: 驱动器选择并入最终参数 (保存时机由父组件调用)
  if (props.identity && hasDrives.value) {
    if (props.type === 'onedrive') {
      // 列表加载完成后, 当前选择是唯一事实源; 加载中恢复态则保留旧参数。
      if (drives.value.length && !drivesError.value) {
        delete res.drive_id
        delete res.drive_type
        if (selectedDrive.value) res.drive_id = selectedDrive.value
        const found = drives.value.find(d => d.id === selectedDrive.value)
        if (found?.type) res.drive_type = found.type
      }
    } else if (props.type === 'drive') {
      // rclone drive 后端的合法键是 team_drive (drive_id 不是配置项);
      // 空串 = 主盘, 不提交该键
      if (drives.value.length && !drivesError.value) {
        delete res.team_drive
        if (selectedDrive.value) res.team_drive = selectedDrive.value
      }
      res.scope = 'drive'
    }
  }
  return res
}

// ── 校验 / 换取令牌 (主路径: 卡片内「确认」按钮; 父组件在「下一步」时调用是保底。
//    idle/error 相位已被父组件的下一步按钮 disable 挡住, 输入框仅在等待态渲染,
//    故此处只会遇到等待/完成态) ──

async function validatePaste(): Promise<boolean> {
  if (phase.value === 'done') return true

  const url = pasteUrl.value.trim()
  if (!url) {
    pasteError.value = t('sync.oauth.paste_required')
    return false
  }

  pasteError.value = ''
  // pasting 覆盖 paste 请求 + 令牌交换等待全程: 按钮持续 spinner,
  // 输入框保持内容且禁用, 成功后才清空 —— 中途不跳空态
  pasting.value = true
  try {
    const { status, data } = await oauthFetch<OAuthSessionResponse>('/api/sync/remote/oauth/paste', { url })

    if (status === 200 && data?.ok) {
      applyPhase({ phase: data.phase || 'exchanging' })
      if ((phase.value as OAuthPhase) === 'done') {
        await ensureDrivesLoaded()
        pasteUrl.value = ''
        emit('authorized', getParams())
        return true
      }
      // 等待交换完成
      const ok = await waitForDone(12000)
      if (ok) pasteUrl.value = ''
      return ok
    }

    if (status === 400) {
      pasteError.value = oauthErrText(data, t('sync.oauth.invalid_callback'))
      return false
    }

    if (status === 409) {
      const st = await oauthFetch<OAuthStatusResponse>('/api/sync/remote/oauth/status')
      if (st.status === 200 && st.data) {
        applyPhase(st.data)
        if ((phase.value as OAuthPhase) === 'done') {
          await ensureDrivesLoaded()
          pasteUrl.value = ''
          emit('authorized', getParams())
          return true
        }
        // 对齐后仍在等待态: 恢复轮询推进到 done, 否则 exchanging 会永远卡在等待
        if (isWaiting.value) startPolling()
      }
      return false
    }

    pasteError.value = oauthErrText(data, t('sync.oauth.paste_failed'))
    return false
  } finally {
    pasting.value = false
  }
}

async function waitForDone(timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 600))
    const { status, data } = await oauthFetch<OAuthStatusResponse>('/api/sync/remote/oauth/status')
    if (status === 200 && data) {
      applyPhase(data)
      if (data.phase === 'done') {
        await ensureDrivesLoaded()
        emit('authorized', getParams())
        return true
      }
      if (data.phase === 'error') {
        return false
      }
    }
  }
  pasteError.value = t('sync.oauth.poll_failed')
  return false
}

defineExpose({
  validatePaste,
  cancel: cancelSession,
  startAuth,
  reconnect,
  getParams,
  retryDrives,
  phase,
  isDone,
  drivesLoading,
  drivesError,
  drivesReady,
  readyForCreate,
})
</script>

<template>
  <div class="cloud-auth-hero" :class="{ 'is-modal': modal }">
    <!-- 状态 3: 授权完成 (非 identity: 紧凑状态行, dashboard 弹窗用) -->
    <div v-if="isDone && !identity" class="v-panel v-status">
      <span class="v-good">
        <MsIcon name="check_circle" />
        {{ t('sync.oauth.done_status') }}
      </span>
      <button type="button" class="v-link" @click="reconnect">
        {{ t('sync.oauth.reconnect') }}
      </button>
    </div>

    <!-- 状态 3: 授权完成 (identity: hero 居中语言, 与登录/等待页一致) -->
    <div v-else-if="isDone" class="v-panel v-hero">
      <span class="v-hero-logo v-hero-logo--done">
        <img v-if="brand.logo" :src="brand.logo" alt="" class="v-hero-logo-img">
        <MsIcon v-else :name="brand.icon" />
        <span class="v-hero-check">
          <MsIcon name="check_circle" />
        </span>
      </span>
      <h3>{{ t('sync.oauth.done_status') }}</h3>

      <div class="v-identity">
        <FormField :label="t('sync.remote.name')" density="compact">
          <input
            v-model="name"
            type="text"
            class="form-input"
            :placeholder="t('sync.remote.name_placeholder')"
            autocomplete="off"
          >
        </FormField>

        <!-- 驱动器 select 恒占位 (支持的类型), 选项延迟加载, 避免布局跳动 -->
        <FormField
          v-if="hasDrives"
          :label="type === 'drive' ? t('sync.dir.drive_label') : t('sync.dir.onedrive_label')"
          density="compact"
        >
          <BaseSelect
            v-model="selectedDrive"
            :options="driveOptions"
            :disabled="drivesLoading || !!drivesError"
            :placeholder="drivesLoading ? t('common.loading') : ''"
            teleport
          />
        </FormField>

        <AlertBanner v-if="drivesError" role="alert" tone="danger" dense class="v-alert">
          {{ drivesError }}
        </AlertBanner>
        <BaseButton
          v-if="drivesError"
          variant="ghost"
          size="sm"
          :loading="drivesLoading"
          @click="retryDrives"
        >
          {{ t('common.btn.retry') }}
        </BaseButton>

        <button type="button" class="v-link v-identity-reconnect" @click="reconnect">
          {{ t('sync.oauth.reconnect') }}
        </button>
      </div>
    </div>

    <!-- 状态 1 / 2 / 4: 初始 Hero / 等待+粘贴 / 失败 -->
    <div v-else class="v-panel v-hero">
      <!-- 品牌 Logo 底座 (48px / modal 42px) -->
      <span class="v-hero-logo">
        <img v-if="brand.logo" :src="brand.logo" alt="" class="v-hero-logo-img">
        <MsIcon v-else :name="brand.icon" />
      </span>

      <!-- 标题 -->
      <h3>{{ t('sync.oauth.connect_provider', { provider: providerName }) }}</h3>

      <!-- 说明行: 等待态展示「已在浏览器中打开授权页面 [重新打开]」行内链接 -->
      <p>
        <template v-if="isWaiting">
          {{ t('sync.oauth.page_opened') }}
          <button type="button" class="v-link" @click="reopenAuth">
            {{ t('sync.oauth.reopen') }}
          </button>
        </template>
        <template v-else>
          {{ t('sync.oauth.sign_in_browser') }}
        </template>
      </p>

      <!-- 等待态: 粘贴说明 + 无标题粘贴输入框 (粘贴回调为主路径, 不再展示等待胶囊) -->
      <template v-if="isWaiting">
        <p class="v-paste-hint">
          {{ t('sync.oauth.localhost_hint') }}
        </p>

        <input
          v-model="pasteUrl"
          type="text"
          class="form-input form-input--mono v-paste-input"
          :placeholder="t('sync.oauth.paste_placeholder')"
          :disabled="pasting"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="validatePaste"
        >
        <BaseButton
          class="v-paste-btn"
          variant="primary"
          :loading="pasting"
          :disabled="pasting"
          @click="validatePaste"
        >
          {{ t('common.btn.confirm') }}
        </BaseButton>
        <AlertBanner v-if="pasteError" role="alert" tone="danger" dense class="v-alert">
          {{ pasteError }}
        </AlertBanner>
      </template>

      <!-- 初始态 / 失败态: 主按钮「使用 {provider} 登录」/「重新登录」 -->
      <template v-else>
        <BaseButton
          class="v-auth-btn"
          variant="primary"
          size="lg"
          :loading="starting"
          @click="startAuth"
        >
          {{ phase === 'error' ? t('common.btn.retry') : startLabel }}
        </BaseButton>

        <AlertBanner v-if="statusError" role="alert" tone="danger" dense class="v-alert">
          {{ statusError }}
        </AlertBanner>
      </template>

      <!-- Drive 高级自建 Client ID 折叠 (仅在初始态显示) -->
      <CollapsibleGroup
        v-if="showDriveAdvanced"
        class="v-advanced"
        :title="t('sync.oauth.drive_advanced')"
        :default-open="false"
      >
        <div class="v-advanced-stack">
          <FormField density="compact">
            <template #label>Client ID</template>
            <input
              v-model="params.client_id"
              type="text"
              class="form-input"
              placeholder="Google Cloud Client ID"
              autocomplete="off"
            >
          </FormField>

          <FormField density="compact">
            <template #label>Client Secret</template>
            <SecretInput
              v-model="params.client_secret"
              :is-password="true"
              placeholder="Google Cloud Client Secret"
            />
          </FormField>
        </div>
      </CollapsibleGroup>
    </div>
  </div>
</template>

<style scoped>
.cloud-auth-hero {
  width: 100%;
}

/* ── v3 Hero 视觉外壳 ── */
.v-panel {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  padding: var(--sp-4);
}

.v-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
}

.v-good {
  color: var(--green);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--text-md);
}

.v-hero {
  display: grid;
  justify-items: center;
  text-align: center;
  padding: var(--sp-6) var(--sp-5) var(--sp-6);
}

.is-modal .v-hero {
  padding: var(--sp-4);
}

.v-hero-logo {
  width: 48px;
  height: 48px;
  border-radius: var(--r);
  background: color-mix(in srgb, var(--ac) 9%, transparent);
  display: grid;
  place-items: center;
  margin-bottom: var(--sp-3);
}

.is-modal .v-hero-logo {
  width: 42px;
  height: 42px;
  border-radius: var(--r);
  margin-bottom: var(--sp-2);
}

.v-hero-logo-img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

/* done 态: 品牌 logo + 右下角对勾角标 */
.v-hero-logo--done {
  position: relative;
}

.v-hero-check {
  position: absolute;
  right: -6px;
  bottom: -4px;
  color: var(--green);
  background: var(--bg3);
  border-radius: 50%;
  display: grid;
  place-items: center;
  line-height: 1;
}

/* identity 表单区: hero 内居中容器 (与登录/等待页的居中语言一致) */
.v-identity {
  width: 100%;
  max-width: 340px;
  display: grid;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
  text-align: left;
}

.v-identity-reconnect {
  justify-self: center;
  font-size: var(--text-sm);
}

.v-hero h3 {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0;
  color: var(--t1);
}

.v-hero p {
  font-size: var(--text-base);
  color: color-mix(in srgb, var(--t2) 55%, var(--t1));
  margin: var(--sp-2) 0 0;
}

.v-link {
  border: 0;
  padding: 0 var(--sp-1);
  background: none;
  color: var(--ac2);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.v-link:hover {
  color: var(--ac);
}

/* ── 主按钮 ── */
.v-auth-btn {
  margin-top: var(--sp-4);
  min-height: 40px;
}

.is-modal .v-auth-btn {
  margin-top: var(--sp-3);
}

/* ── 等待态胶囊 ── */
/* 用双类选择器压过 .v-hero p 的级联, 避免 !important */
.v-hero p.v-paste-hint {
  margin-top: var(--sp-3);
  line-height: 1.5;
  max-width: 480px;
}

/* ── 粘贴输入框 / 确认按钮 / 错误提示 ── */
.v-paste-input {
  margin-top: var(--sp-2);
}

.v-paste-btn {
  margin-top: var(--sp-2);
  min-height: 38px;
}

.v-alert {
  width: 100%;
  margin-top: var(--sp-2);
  text-align: left;
}

/* ── Drive 高级折叠 ── */
.v-advanced {
  width: 100%;
  margin-top: var(--sp-3);
  text-align: left;
}

.v-advanced-stack {
  display: grid;
  gap: var(--sp-2);
  padding: var(--sp-1) 0 var(--sp-2);
  text-align: left;
}

.v-advanced-stack p {
  margin: 0;
}
</style>
