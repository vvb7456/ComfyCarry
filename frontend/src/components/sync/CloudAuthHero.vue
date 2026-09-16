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
 *      - 状态行「授权完成」+ 链接「更换账号」(重开会话)
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
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
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
import Spinner from '@/components/ui/Spinner.vue'
import FormField from '@/components/form/FormField.vue'
import PathBrowserModal from '@/components/sync/PathBrowserModal.vue'
import { remoteBrand } from '@/config/remote-logos'
import { OAUTH_TYPES } from '@/config/cloud-providers'
import type {
  ApiOkResponse, BrowseResponse, DrivesResponse, OAuthDriveItem, OAuthPhase,
  OAuthSessionResponse, OAuthStatusResponse, RemoteTypeDef, StagedCreds,
} from '@/types/sync'

defineOptions({ name: 'CloudAuthHero' })

const POLL_MS = 2000
const MAX_POLL_FAILURES = 3

const props = withDefaults(defineProps<{
  /** 选中的 remote 类型 key (drive, onedrive, dropbox, s3, sftp, webdav) */
  type: string
  /** 是否以弹窗内紧凑模式渲染 (modal 42px 图标, 默认 false 为 48px) */
  modal?: boolean
  /** 是否处于激活态 (false 时触发 cancelSession 避免背景泄露) */
  active?: boolean
  /** 远端类型定义表 (OAuth 高级凭据 / 非 OAuth 凭据字段都从这里取) */
  types?: Record<string, RemoteTypeDef>
  /** done 态在卡片内展示存储名称 + 驱动器/存储桶 + 同步文件夹 (向导/dashboard 单卡模式) */
  identity?: boolean
  /** 恢复态: 跳过登录/凭据直接落 done 屏 (凭据已在服务端草稿, 无需会话)。
   *  用于向导 step3 回退重进 —— 名称等由父组件经 v-model 恢复,
   *  「更换账号 / 修改连接信息」仍可回到第一屏 */
  restored?: boolean
  /** 恢复态已有的非敏感 OAuth 参数 (如 drive_id/team_drive/drive_type)。 */
  restoredParams?: Record<string, string>
  /** 目录浏览的 staged 凭据覆盖 (wizard 恢复态草稿 {wizard:true}); 缺省按类型自算 */
  staged?: StagedCreds
  /** dashboard 嵌入模式: 卡片无边框无内边距; 授权/校验/连接全部由父流程
   *  (弹窗底部「下一步」) 承担 —— 隐藏内嵌主按钮、粘贴确认键与
   *  「更换账号 / 修改连接信息」链接 (职责归父流程的「上一步」)。 */
  embedded?: boolean
}>(), {
  modal: false,
  active: true,
  identity: false,
  restored: false,
  restoredParams: () => ({}),
  types: () => ({}),
  staged: undefined,
  embedded: false,
})

/** 存储名称 (done 屏由卡片内输入框管理) */
const name = defineModel<string>('name', { default: '' })
/** 非 OAuth 凭据字段值 (REMOTE_TYPE_DEFS.fields), 由父组件持有时便于统计指纹 */
const fields = defineModel<Record<string, string>>('fields', { default: () => ({}) })
/** 与这份存储绑定的同步文件夹 (预设规则路径锚点) */
const rootDir = defineModel<string>('rootDir', { default: '' })
/** S3 存储桶 (rclone s3 路径首段; 非 S3 不用) */
const bucket = defineModel<string>('bucket', { default: '' })

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

// ── 类型判定 ──
/** OAuth 类型走授权会话; 其余走凭据表单 (同一 done 屏收尾) */
const isOAuth = computed(() =>
  !!(props.types[props.type]?.oauth ?? OAUTH_TYPES.includes(props.type)),
)
/** 非 OAuth 的凭据字段定义 (按后端 REMOTE_TYPE_DEFS) */
const credFields = computed(() => props.types[props.type]?.fields || [])
const isS3 = computed(() => props.type === 's3')

// ── 会话状态 ──

const phase = ref<OAuthPhase>(props.restored ? 'done' : 'idle')
const providerUrl = ref('')
const statusError = ref('')
const pasteUrl = ref('')
const pasteError = ref('')
const starting = ref(false)
const pasting = ref(false)
/** 拿到授权页 URL 后延迟自动跳转: 停几秒展示「正在跳转到 xx…」,
 *  让用户先看清小字说明 (之后要粘贴回调地址), 直接 window.open 会把人搞蒙 */
const redirecting = ref(false)
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
  await ensureSelectLoaded()
}

// ── S3 存储桶 (done 屏选择, bucket 是这份存储的根) ──

const buckets = ref<string[]>([])
const bucketsLoading = ref(false)
const bucketsError = ref('')
const bucketsFetched = ref(false)
let bucketsPromise: Promise<void> | null = null
let bucketsGeneration = 0

const bucketOptions = computed<SelectOption[]>(() =>
  buckets.value.map(b => ({ value: b, label: b })),
)

/** 目录浏览/列桶用的 staged 凭据: 父级覆盖优先 (wizard 恢复态草稿),
 *  否则 OAuth 走服务端会话 (并入驱动器参数), 非 OAuth 表单直传。
 *  用户点过「修改连接信息」后以表单里的新凭据为准, 不再复用服务端草稿 ——
 *  否则改完凭据, 列桶/浏览仍走旧凭据。 */
function stagedCreds(): StagedCreds {
  if (props.staged && !credsEdited.value) return props.staged
  if (isOAuth.value) return { oauth: true, params: getParams() }
  return { type: props.type, params: { ...fields.value } }
}

async function fetchBuckets() {
  if (!props.identity || !isS3.value || bucketsFetched.value || !name.value.trim()) return
  const generation = bucketsGeneration
  bucketsFetched.value = true
  bucketsLoading.value = true
  bucketsError.value = ''
  const { status, data } = await oauthFetch<BrowseResponse>('/api/sync/remote/browse', {
    remote: name.value.trim(), path: '', staged: stagedCreds(),
  })
  if (generation !== bucketsGeneration) return
  bucketsLoading.value = false
  if (status === 200 && data?.ok && data.dirs?.length) {
    buckets.value = data.dirs
    if (!buckets.value.includes(bucket.value)) bucket.value = buckets.value[0] || ''
    return
  }
  buckets.value = []
  bucket.value = ''
  bucketsError.value = apiErrorText(data, t('sync.dir.bucket_failed'))
}

function ensureBucketsLoaded(): Promise<void> {
  if (!props.identity || !isS3.value || bucketsFetched.value) return Promise.resolve()
  if (!bucketsPromise) {
    const request = fetchBuckets()
    bucketsPromise = request
    request.finally(() => {
      if (bucketsPromise === request) bucketsPromise = null
    })
  }
  return bucketsPromise
}

function resetBuckets() {
  bucketsGeneration += 1
  bucketsPromise = null
  bucketsFetched.value = false
  bucketsLoading.value = false
  buckets.value = []
  bucketsError.value = ''
}

async function retryBuckets() {
  bucketsGeneration += 1
  bucketsPromise = null
  bucketsFetched.value = false
  await ensureBucketsLoaded()
}

/** 进入 done 后按类型加载「挂载根」列表: 驱动器 (OAuth) 或存储桶 (S3)。
 *  能列出目录即代表存储真实连通, 失败就地报错并可重试。 */
function ensureSelectLoaded(): Promise<void> {
  if (hasDrives.value) return ensureDrivesLoaded()
  if (isS3.value) return ensureBucketsLoaded()
  return Promise.resolve()
}

// ── 非 OAuth: 凭据屏 → done ──

const credError = ref('')
/** 用户是否点过「修改连接信息」: 之后 staged 浏览改用表单里的新凭据 */
const credsEdited = ref(false)

/** 非 OAuth 凭据必填校验 (错误就地展示, 不前进) */
function connect() {
  credError.value = ''
  const missing = credFields.value
    .filter(f => f.required && !(fields.value[f.key] || '').trim())
    .map(f => f.label)
  if (missing.length) {
    credError.value = t('sync.remote.missing_fields', { fields: missing.join(', ') })
    return
  }
  // 凭据可能已改, 挂载根列表必须重列 —— 否则改了 endpoint 仍显示旧桶/旧错误
  resetDrives()
  resetBuckets()
  phase.value = 'done'
  emit('update:phase', 'done')
  emit('authorized', getParams())
  void ensureSelectLoaded()
}

/** 非 OAuth done 屏「修改连接信息」: 回到凭据屏 (字段值保留) */
function editCreds() {
  credError.value = ''
  credsEdited.value = true
  phase.value = 'idle'
  emit('update:phase', 'idle')
}

// ── 同步文件夹 (done 屏输入 + 远程目录浏览器) ──
// 非空校验不就地报错 —— 未填时父流程的下一步/完成按钮保持置灰, 已是明确提示

const browseOpen = ref(false)

const rootDirValid = computed(() => {
  const v = rootDir.value.trim()
  return !!v && v !== '/' && v !== '.' && v !== './'
})
/** S3: 浏览器以已选存储桶为根 (锁定在桶内); 其余以存储根为根 */
const browseRootPath = computed(() => (isS3.value ? bucket.value.trim() : ''))

function openBrowse() {
  browseOpen.value = true
}

function onBrowseSelect(path: string) {
  // S3 时 select 返回的就是桶内相对路径 (桶为浏览器根), 其余为完整路径;
  // 两者都直接作为同步文件夹存入, 桶内根 (空) 已被 forbidRoot 挡住
  rootDir.value = path
}

/** 挂载根字段 (驱动器 / 存储桶) 的统一标签与错误/重试, done 屏共用一套呈现 */
const selectLabel = computed(() =>
  hasDrives.value
    ? (props.type === 'drive' ? t('sync.dir.drive_label') : t('sync.dir.onedrive_label'))
    : t('sync.dir.bucket_label'),
)
const selectError = computed(() => (hasDrives.value ? drivesError.value : bucketsError.value))
const selectLoading = computed(() => (hasDrives.value ? drivesLoading.value : bucketsLoading.value))

async function retrySelect() {
  if (hasDrives.value) return retryDrives()
  if (isS3.value) return retryBuckets()
}

const brand = computed(() => remoteBrand(props.type))

const providerName = computed(() => {
  const map: Record<string, string> = {
    drive: 'Google Drive',
    onedrive: 'OneDrive',
    dropbox: 'Dropbox',
  }
  return props.types[props.type]?.label || map[props.type] || props.type
})

const isDone = computed(() => phase.value === 'done')
const isWaiting = computed(() => phase.value === 'starting' || phase.value === 'url_ready' || phase.value === 'exchanging')

/** 等待态粘贴框是否已有内容 (embedded 模式下父流程据此启用/禁用「下一步」) */
const hasPaste = computed(() => !!pasteUrl.value.trim())

/** 驱动器列表是创建 drive/onedrive remote 的前置条件, 失败时禁止静默回落主盘。 */
const drivesReady = computed(() =>
  !props.identity || !hasDrives.value
  || restoredDriveReady.value
  || (!drivesLoading.value && !drivesError.value && drives.value.length > 0),
)

/** 挂载根选择 (驱动器 / 存储桶) 是否就绪 —— 列不出目录即视为未连通。 */
const selectReady = computed(() => {
  if (!props.identity) return true
  if (hasDrives.value) return drivesReady.value
  if (isS3.value) return !bucketsLoading.value && !bucketsError.value && !!bucket.value.trim()
  return true
})

/** 只有 done、挂载根就绪且同步文件夹合法时才允许父流程落盘创建。 */
const readyForCreate = computed(() => {
  if (!isDone.value || !selectReady.value || !rootDirValid.value) return false
  if (hasDrives.value && props.type === 'onedrive') {
    const p = getParams()
    return !!p.drive_id && !!p.drive_type
  }
  return true
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

// ── 授权页跳转 (延迟自动打开, 弹窗拦截由「立即打开」兜底) ──

const REDIRECT_DELAY_MS = 4000
let redirectTimer: ReturnType<typeof setTimeout> | null = null

function openProviderPage() {
  redirecting.value = false
  if (redirectTimer) {
    clearTimeout(redirectTimer)
    redirectTimer = null
  }
  if (!providerUrl.value) return
  try {
    window.open(providerUrl.value, '_blank')
  } catch {
    // 被拦截时由等待态的「立即打开」按钮兜底
  }
}

/** 进入等待态: 先停留几秒展示「正在跳转到 xx…」+ spinner, 再自动跳转 */
function scheduleRedirect() {
  redirecting.value = true
  if (redirectTimer) clearTimeout(redirectTimer)
  redirectTimer = setTimeout(openProviderPage, REDIRECT_DELAY_MS)
}

function cancelRedirect() {
  redirecting.value = false
  if (redirectTimer) {
    clearTimeout(redirectTimer)
    redirectTimer = null
  }
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
          scheduleRedirect()
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
      void ensureSelectLoaded()
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
  cancelRedirect()
  phase.value = 'idle'
  providerUrl.value = ''
  statusError.value = ''
  pasteUrl.value = ''
  pasteError.value = ''
  hasOpenedWindow.value = false
  resetDrives()
  resetBuckets()
  credError.value = ''
  credsEdited.value = false
  emit('update:phase', 'idle')
}

// 恢复态直接落 done: 挂载后按类型补拉挂载根列表 (驱动器/存储桶),
// 能列出目录即代表存储真实连通。
onMounted(() => {
  if (isDone.value) void ensureSelectLoaded()
})

onUnmounted(() => {
  // done 会话持有待 remote/create 消费的 token (create 发生在卸载后的目录态),
  // 不能 cancel; 只清理 pending 态 (starting/url_ready/exchanging)。
  if (phase.value !== 'idle' && phase.value !== 'done') {
    void oauthFetch('/api/sync/remote/oauth/cancel', {})
  }
  stopPolling()
  cancelRedirect()
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
  resetBuckets()
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
    openProviderPage()
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
  // 非 OAuth: 凭据字段直传; S3 把已选存储桶并入 (rclone s3 路径首段)
  if (!isOAuth.value) {
    const res: Record<string, string> = { ...fields.value }
    if (isS3.value && bucket.value.trim()) res.bucket = bucket.value.trim()
    return res
  }
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
        await ensureSelectLoaded()
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
          await ensureSelectLoaded()
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
        await ensureSelectLoaded()
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
  connect,
  editCreds,
  getParams,
  retryDrives,
  retryBuckets,
  phase,
  isDone,
  isOAuth,
  isWaiting,
  hasPaste,
  drivesLoading,
  drivesError,
  drivesReady,
  bucketsLoading,
  bucketsError,
  readyForCreate,
})
</script>

<template>
  <div class="cloud-auth-hero" :class="{ 'is-modal': modal, 'is-embedded': embedded }">
    <!-- 状态 3: 完成 (identity: hero 居中语言, 与登录/等待页一致)
         非 OAuth 也落这一屏: 名称 + 挂载根 (驱动器/存储桶) + 同步文件夹 -->
    <div v-if="isDone" class="v-panel v-hero">
      <span class="v-hero-logo v-hero-logo--done">
        <img v-if="brand.logo" :src="brand.logo" alt="" class="v-hero-logo-img">
        <MsIcon v-else :name="brand.icon" />
        <span class="v-hero-check">
          <MsIcon name="check_circle" />
        </span>
      </span>
      <h3>{{ isOAuth ? t('sync.oauth.done_status') : t('sync.dir.confirm_title') }}</h3>

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

        <!-- 挂载根 select 恒占位 (驱动器/存储桶), 选项延迟加载, 避免布局跳动 -->
        <FormField v-if="hasDrives || isS3" :label="selectLabel" density="compact">
          <BaseSelect
            v-if="hasDrives"
            v-model="selectedDrive"
            :options="driveOptions"
            :disabled="drivesLoading || !!drivesError"
            :placeholder="drivesLoading ? t('common.loading') : ''"
            teleport
          />
          <BaseSelect
            v-else
            v-model="bucket"
            :options="bucketOptions"
            :disabled="bucketsLoading || !!bucketsError"
            :placeholder="bucketsLoading ? t('common.loading') : t('sync.dir.bucket_placeholder')"
            teleport
          />
        </FormField>

        <AlertBanner v-if="selectError" role="alert" tone="danger" dense class="v-alert">
          {{ selectError }}
        </AlertBanner>
        <BaseButton
          v-if="selectError"
          variant="ghost"
          size="sm"
          :loading="selectLoading"
          @click="retrySelect"
        >
          {{ t('common.btn.retry') }}
        </BaseButton>

        <!-- 同步文件夹 (与这份存储绑定): 预设规则路径的锚点, 不能是存储根。
             只读 —— 仅经目录浏览器选择, 预防手输奇怪路径 -->
        <FormField :label="t('sync.dir.root_label')" density="compact">
          <div class="v-root-row">
            <input
              :value="rootDir"
              type="text"
              class="form-input"
              :placeholder="t('sync.dir.root_placeholder')"
              readonly
              disabled
            >
            <BaseButton
              size="sm"
              :disabled="!name.trim() || (isS3 && !bucket.trim())"
              @click="openBrowse"
            >
              <MsIcon name="folder_open" size="xs" color="none" />
              {{ t('sync.dir.root_browse') }}
            </BaseButton>
          </div>
        </FormField>

        <button v-if="!embedded" type="button" class="v-link v-identity-reconnect" @click="isOAuth ? reconnect() : editCreds()">
          {{ isOAuth ? t('sync.oauth.reconnect') : t('sync.dir.edit_creds') }}
        </button>
      </div>
    </div>

    <!-- 非 OAuth: 凭据屏 (名称/同步文件夹在完成屏设置) -->
    <div v-else-if="!isOAuth" class="v-panel v-cred">
      <div class="v-cred-head">
        <span class="v-cred-logo">
          <img v-if="brand.logo" :src="brand.logo" alt="" class="v-hero-logo-img">
          <MsIcon v-else :name="brand.icon" />
        </span>
        <strong>{{ providerName }}</strong>
      </div>

      <FormField v-for="field in credFields" :key="field.key" :label="field.label" density="compact">
        <BaseSelect
          v-if="field.type === 'select'"
          :model-value="fields[field.key] || ''"
          :options="(field.options || []).map(o => ({ value: o, label: o }))"
          teleport
          @update:model-value="(v: string | number | boolean) => fields[field.key] = String(v)"
        />
        <SecretInput v-else-if="field.type === 'password'" v-model="fields[field.key]" :is-password="true" :placeholder="field.placeholder" />
        <textarea v-else-if="field.type === 'textarea'" v-model="fields[field.key]" rows="3" class="form-textarea form-textarea--mono" :placeholder="field.placeholder" />
        <input v-else v-model="fields[field.key]" type="text" class="form-input" :placeholder="field.placeholder" autocomplete="off">
        <template v-if="field.help" #below>
          <p class="v-field-help" v-html="field.help" />
        </template>
      </FormField>

      <AlertBanner v-if="credError" role="alert" tone="danger" dense class="v-alert">
        {{ credError }}
      </AlertBanner>
      <BaseButton v-if="!embedded" class="v-auth-btn" variant="primary" size="lg" @click="connect">
        {{ t('sync.flow.connect') }}
      </BaseButton>
    </div>

    <!-- 状态 1 / 2 / 4: 初始 Hero / 等待+粘贴 / 失败 -->
    <div v-else class="v-panel v-hero">
      <!-- 品牌 Logo 底座 (48px / modal 42px) -->
      <span class="v-hero-logo">
        <img v-if="brand.logo" :src="brand.logo" alt="" class="v-hero-logo-img">
        <MsIcon v-else :name="brand.icon" />
      </span>

      <!-- 标题: 等待态按子相位切换 —— 延迟跳转期「spinner 正在跳转到 xx…」,
           页面已打开后「在浏览器中登录 xx」; 初始/失败态保持「连接 xx」 -->
      <h3 v-if="isWaiting && redirecting" class="v-hero-title">
        <span class="v-redirecting">
          <Spinner size="sm" />
          <span>{{ t('sync.oauth.redirecting', { provider: providerName }) }}</span>
        </span>
      </h3>
      <h3 v-else-if="isWaiting" class="v-hero-title">{{ t('sync.oauth.sign_in_at', { provider: providerName }) }}</h3>
      <h3 v-else>{{ t('sync.oauth.connect_provider', { provider: providerName }) }}</h3>

      <!-- 说明行: 等待态只留一个超链接 (立即打开 / 重新打开), 初始态无副标题;
           第三行 localhost 粘贴提示不受影响 -->
      <p>
        <template v-if="isWaiting && redirecting">
          <button type="button" class="v-link" @click="openProviderPage">
            {{ t('sync.oauth.open_now') }}
          </button>
        </template>
        <template v-else-if="isWaiting">
          <button type="button" class="v-link" @click="reopenAuth">
            {{ t('sync.oauth.reopen') }}
          </button>
        </template>
      </p>

      <!-- 等待态: 粘贴说明 + 无标题粘贴输入框 (粘贴回调为主路径;
           embedded 模式无内嵌确认键, 由父流程「下一步」调 validatePaste) -->
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
          v-if="!embedded"
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

      <!-- 初始态 / 失败态: 主按钮「使用 {provider} 登录」/「重新登录」
           (embedded 模式保留: modal 下一步在初始/失败态 disable,
           登录只能从这里发起; 登录后自动进入等待态) -->
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

    <!-- 同步文件夹的远程目录浏览器 (S3 以已选存储桶为根, 锁定桶内; 不能选根) -->
    <PathBrowserModal
      v-model="browseOpen"
      mode="remote"
      :remote="name.trim()"
      :staged="stagedCreds()"
      :root-path="browseRootPath"
      forbid-root
      @select="onBrowseSelect"
    />
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

/* dashboard 嵌入模式: 外壳由弹窗承担, 卡片去边框去内边距 */
.is-embedded .v-panel {
  border: none;
  background: transparent;
  padding: 0;
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

/* 等待态标题内联 spinner (正在跳转到 xx…) */
.v-hero-title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}

.v-hero p {
  font-size: var(--text-base);
  color: color-mix(in srgb, var(--t2) 55%, var(--t1));
  margin: var(--sp-2) 0 0;
}

/* 副标题为空时不再占位 */
.v-hero p:empty {
  display: none;
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

/* 延迟跳转提示: 标题内联 spinner + 「正在跳转到 xx…」 */
.v-redirecting {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--t1);
  font-weight: 600;
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

/* ── 非 OAuth 凭据屏 ── */
.v-cred {
  display: grid;
  gap: var(--sp-3);
  text-align: left;
}

.v-cred-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.v-cred-logo {
  width: var(--sp-6);
  height: var(--sp-6);
  flex: none;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--ac) 8%, transparent);
  display: grid;
  place-items: center;
}

.v-cred-logo img {
  width: var(--sp-4);
  height: var(--sp-4);
  object-fit: contain;
}

.v-cred-head strong {
  font-weight: 600;
  color: var(--t1);
}

.v-field-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--t3);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* ── done 屏: 同步文件夹 (输入 + 浏览按钮) ── */
.v-root-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.v-root-row .form-input {
  flex: 1;
  min-width: 0;
}

.v-root-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--t3);
  line-height: 1.4;
}
</style>
