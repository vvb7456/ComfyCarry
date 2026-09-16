<script setup lang="ts">
/**
 * AddStorageFlow — 添加存储流 (类型 → 连接 → done) 的流程主体,
 * dashboard「添加存储」弹窗的内容 (外壳见 AddStorageModal)。
 *
 * 与 wizard 的关系: wizard step3 将本流程原生化为向导 step (StepRclone),
 * 本组件仅服务 dashboard; wizard 场景刷新即放弃, 不复用本组件。
 *
 * - 类型屏: provider 六卡选择; 底部 取消/下一步
 * - 连接屏: 全类型统一 CloudAuthHero (embedded 模式 —— 无内嵌按钮/边框)。
 *   - OAuth: 「使用 xx 登录」留在 hero 内 (此时底部「下一步」disable);
 *     登录后进入等待态, 粘贴回调后由底部「下一步」验证并自动进入 done 屏
 *   - 非 OAuth: 填完凭据点底部「下一步」= 连接 (校验+进 done 屏)
 *   - done 屏 (最后一步): 名称 + 挂载根 + 同步文件夹; 底部 上一步/保存并创建规则
 * - 提交: 点「保存并创建规则」才 POST /api/sync/remote/create 落盘 (此前凭据
 *   零落盘, 关闭弹窗即丢弃); 成功后经 created 通知父组件关闭弹窗
 * - 错误一律就地展示 (AlertBanner); 底部动作条由本组件渲染
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useApiFetch } from '@/composables/useApiFetch'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText } from '@/utils/apiError'
import BaseButton from '@/components/ui/BaseButton.vue'
import OptionCard from '@/components/ui/OptionCard.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import CloudAuthHero from '@/components/sync/CloudAuthHero.vue'
import { CLOUD_PROVIDERS, OAUTH_TYPES, type CloudProvider } from '@/config/cloud-providers'
import { remoteBrand } from '@/config/remote-logos'
import type {
  ApiOkResponse, OAuthPhase, RemoteTypeDef,
} from '@/types/sync'

defineOptions({ name: 'AddStorageFlow' })

const props = withDefaults(defineProps<{
  /** 现有存储列表 (查重 / 覆盖确认) */
  existingRemotes?: Array<{ name: string; type: string }>
  /** 远端类型定义表 (OAuth 高级凭据 / 非 OAuth 凭据字段) */
  remoteTypes?: Record<string, RemoteTypeDef>
  /** 重连预填: 打开时自动选中对应 provider 并恢复名称/同步文件夹/存储桶 */
  preset?: { type?: string; name?: string; root_dir?: string; bucket?: string }
}>(), {
  existingRemotes: () => [],
  remoteTypes: () => ({}),
})

const emit = defineEmits<{
  /** 存储已创建 (openRuleModal = 点了「保存并创建规则」, 请求继续添加规则) */
  created: [remote: { name: string; type: string; openRuleModal: boolean }]
  /** flow=0 时请求关闭 (无数据) */
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const { post } = useApiFetch()
const { confirm } = useConfirm()

// ── 流程状态 (flow: 0=类型, 1=连接, 2=done 最后一步) ──
const flow = ref(0)
const type = ref('')
const name = ref('')
const fields = ref<Record<string, string>>({})
const rootDir = ref('')
const bucket = ref('')

const error = ref('')
const submitting = ref(false)
/** 粘贴回调验证中 (下一步按钮 loading) */
const advancing = ref(false)

// OAuth 授权阶段 (经 CloudAuthHero 的 update:phase 同步, 用于下一步按钮 disable)
const oAuthPhase = ref<OAuthPhase>('idle')

const cloudAuthHeroRef = ref<InstanceType<typeof CloudAuthHero> | null>(null)

// ── 提供商 (共享常量, wizard StepRclone 复用) ──

const providers = CLOUD_PROVIDERS
const isOAuthType = computed(() =>
  !!type.value && (props.remoteTypes[type.value]?.oauth ?? OAUTH_TYPES.includes(type.value)),
)

function brandOf(typeKey: string) {
  return remoteBrand(typeKey)
}

// ── 名称唯一性生成与 provider 选择 ──
function generateUniqueName(base: string): string {
  let res = base
  let n = 2
  const existingNames = props.existingRemotes.map(r => r.name)
  while (existingNames.includes(res)) res = `${base}${n++}`
  return res
}

function selectProvider(p: CloudProvider) {
  type.value = p.id
  name.value = generateUniqueName(p.defaultName)
  // 默认值按后端字段定义填充 (s3 provider / sftp port 等)
  fields.value = {}
  for (const f of props.remoteTypes[p.id]?.fields || []) {
    if (f.default !== undefined) fields.value[f.key] = f.default
  }
  rootDir.value = ''
  bucket.value = ''
  error.value = ''
}

// ── 校验 ──
function validateName(): boolean {
  const n = name.value.trim()
  if (!n) {
    error.value = t('sync.err.remote_name_required')
    return false
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(n)) {
    error.value = t('sync.remote.invalid_name')
    return false
  }
  return true
}

// ── 阶段推进 (0=类型 → 1=连接 → 2=done; done 屏两个保存才落盘) ──
/** done 屏两个保存的语义: 「保存」仅创建; 「保存并创建规则」创建成功后
 *  由父组件打开添加规则弹窗并预填本存储 (承接原 checkbox 职责) */
let nextWantsRules = false

/** 模板点击入口: 主按钮 @click 会传 MouseEvent, 显式无参包装 */
function onNext(wantsRules?: boolean) {
  void next(wantsRules === true)
}

async function next(wantsRules = false) {
  nextWantsRules = wantsRules
  if (flow.value === 0) {
    flow.value = 1
    return
  }
  if (flow.value === 1) {
    error.value = ''
    // 连接屏 → done 屏
    if (isOAuthType.value) {
      // 粘贴回调: 由底部「下一步」验证并推进 (保底路径, 主路径是自动轮询 done)。
      // 错误 (空粘贴/无效回调) 由 CloudAuthHero 就地展示, 不再叠流程级 banner
      advancing.value = true
      const ok = await cloudAuthHeroRef.value?.validatePaste()
      advancing.value = false
      if (!ok) return
      flow.value = 2
    } else {
      // 非 OAuth: 下一步 = 连接 (凭据校验就地报错; 成功后经相位 watch 自动进 done)
      cloudAuthHeroRef.value?.connect()
    }
    return
  }
  await submitCreate()
}

function back() {
  error.value = ''
  if (flow.value === 2) {
    // done 屏点「返回」= 更换账号/修改连接信息: 取消会话回到登录 hero / 凭据屏
    cloudAuthHeroRef.value?.cancel()
    oAuthPhase.value = 'idle'
    flow.value = 1
    return
  }
  if (flow.value === 1) {
    // 连接屏点「返回」回到类型选择; 未完成的 OAuth 会话一并取消
    cloudAuthHeroRef.value?.cancel()
    oAuthPhase.value = 'idle'
    flow.value = 0
  }
}

const primaryLabel = computed(() =>
  flow.value === 2 ? t('common.btn.save') : t('sync.flow.next'),
)

/**
 * 保存并创建规则: 真实创建 remote (此前凭据仅留内存, 零落盘)。
 * 查重: 同名同类型 → 覆盖确认 (后端原地替换凭据, 规则不受影响); 同名不同类型 → 报错
 */
async function submitCreate() {
  if (!validateName()) return
  if (type.value === 's3' && !bucket.value.trim()) {
    error.value = t('sync.err.bucket_required')
    return
  }

  const target = name.value.trim()
  const existing = props.existingRemotes.find(r => r.name === target)
  let overwrite = false
  if (existing) {
    if (existing.type !== type.value) {
      error.value = t('sync.err.remote_exists', { name: target })
      return
    }
    const ok = await confirm({
      title: t('sync.confirm.overwrite.title'),
      message: t('sync.confirm.overwrite.message', { name: target }),
      confirmText: t('sync.confirm.overwrite.button'),
    })
    if (!ok) return
    overwrite = true
  }

  submitting.value = true
  error.value = ''

  // 粘贴回调主路径下用户可能不点「下一步」直接点「保存并创建规则」:
  // 先吃粘贴框里的 URL 换取令牌。错误由 CloudAuthHero 就地展示。
  if (isOAuthType.value) {
    if (!(await cloudAuthHeroRef.value?.validatePaste())) {
      submitting.value = false
      return
    }
  }
  const params: Record<string, string> = {
    ...(cloudAuthHeroRef.value?.getParams?.() || {}),
    ...fields.value,
  }
  if (type.value === 's3' && bucket.value.trim()) params.bucket = bucket.value.trim()

  const d = await post<ApiOkResponse>('/api/sync/remote/create', {
    name: target, type: type.value, root_dir: rootDir.value.trim(),
    oauth: isOAuthType.value, params, overwrite,
  })
  submitting.value = false

  // 非 2xx: body 已被 useApiFetch 吃掉 (并 toast), 就地显示错误并保留表单
  if (!d) {
    error.value = t('sync.remote.create_failed')
    return
  }
  if (!d.ok) {
    error.value = apiErrorText(d, t('sync.remote.create_failed'))
    return
  }

  toast(t('sync.msg.remote_created', { name: target }), 'success')
  emit('created', { name: target, type: type.value, openRuleModal: nextWantsRules })
}

function onOAuthPhase(phase: OAuthPhase) {
  oAuthPhase.value = phase
  // OAuth 授权完成 (粘贴验证成功 / 自动轮询到 done): 自动进入 done 屏,
  // 无需用户再点「下一步」; 非 OAuth 的连接成功 (connect) 也经此翻页。
  if (phase === 'done' && flow.value === 1) flow.value = 2
  // 挂载根列表 (驱动器/存储桶) 由 CloudAuthHero 在 done 态自行拉取
}

/** 主按钮 disable: 各态的前置条件不满足时置灰, 而不是点了才报错。
 *  OAuth 登录/重登按钮在 CloudAuthHero 卡片内, 与底部导航无关。 */
const nextDisabled = computed(() => {
  if (submitting.value || advancing.value) return true
  if (flow.value === 0) return !type.value
  if (flow.value === 2) return !cloudAuthHeroRef.value?.readyForCreate
  // 连接屏:
  // - OAuth 未开始授权 / 授权失败需重登 → 不可前进 (须先在 hero 内登录)
  // - 等待态: 粘贴框为空时不可前进 (点了也只会空报错), 有内容即可验证
  // - 非 OAuth: 凭据必填项齐备即可连接 (缺失时点击就地报错)
  if (isOAuthType.value) {
    if (oAuthPhase.value === 'idle' || oAuthPhase.value === 'error') return true
    if (oAuthPhase.value === 'done') return !cloudAuthHeroRef.value?.readyForCreate
    return !cloudAuthHeroRef.value?.hasPaste
  }
  return false
})

// ── 重置与重连预填 ──
function resetFlow() {
  flow.value = 0
  type.value = ''
  name.value = ''
  fields.value = {}
  rootDir.value = ''
  bucket.value = ''
  error.value = ''
  oAuthPhase.value = 'idle'
  applyPreset()
}

/** preset (重连预填): 打开时自动选中对应 provider 并恢复名称/同步文件夹/存储桶,
 *  直落连接屏 (凭据在 rclone.conf, 重连仅需重授权或改同步文件夹) */
function applyPreset() {
  const p = props.preset
  if (!p?.type) return
  const provider = providers.find(x => x.id === p.type)
  if (!provider) return
  type.value = p.type
  if (p.name) name.value = p.name
  if (p.root_dir) rootDir.value = p.root_dir
  if (p.bucket) bucket.value = p.bucket
  flow.value = 1
}

// dashboard 弹窗每次打开都是全新挂载 (BaseModal v-if), 初始态即重置态;
// preset 在挂载前/后设置都能通过本 watch 生效。
watch(() => props.preset, () => resetFlow(), { immediate: true, deep: true })

// ── 会话清理 (关闭弹窗时取消 pending 的 OAuth 会话) ──
// 凭据全程零落盘, 关闭即丢弃, 无需「放弃」守卫; 只清理未完成的授权会话,
// done 会话持有待 create 消费的 token, 卸载时不能 cancel (会话自然超时回收)。
function cleanupSession() {
  if (oAuthPhase.value !== 'idle' && oAuthPhase.value !== 'done') {
    cloudAuthHeroRef.value?.cancel()
  }
}

defineExpose({
  cleanupSession,
  reset: resetFlow,
})
</script>

<template>
  <div class="add-flow">
    <!-- 态 0: 类型 -->
    <div v-if="flow === 0" class="flow-stack">
      <div class="flow-choices">
        <OptionCard v-for="p in providers" :key="p.id" variant="bg2" :selected="type === p.id" @toggle="selectProvider(p)">
          <template #title>
            <span class="flow-choice-title">
              <img v-if="brandOf(p.id).logo" :src="brandOf(p.id).logo" alt="" class="flow-logo">
              <MsIcon v-else :name="brandOf(p.id).icon" size="sm" />
              {{ p.name }}
            </span>
          </template>
          <template #description>{{ t(p.descKey) }}</template>
        </OptionCard>
      </div>
    </div>

    <!-- 态 1: 连接 / 态 2: done 最后一步 (全类型统一 CloudAuthHero embedded;
         key 只含 type: 1/2 态切换是同一实例内部的相位/屏幕变化, 重新挂载会
         丢掉 OAuth 会话相位导致退回登录 hero) -->
    <div v-else class="flow-stack">
      <CloudAuthHero
        :key="type"
        ref="cloudAuthHeroRef"
        v-model:name="name"
        v-model:fields="fields"
        v-model:root-dir="rootDir"
        v-model:bucket="bucket"
        :type="type"
        :types="remoteTypes"
        :modal="true"
        identity
        embedded
        @update:phase="onOAuthPhase"
      />
    </div>

    <!-- 错误就地提示 -->
    <AlertBanner v-if="error" tone="danger" dense>{{ error }}</AlertBanner>

    <!-- 底部动作条: 取消(第一屏) / 上一步 + 下一步 / 保存并创建规则 -->
    <div class="flow-footer">
      <span class="flow-footer-spacer" />
      <BaseButton v-if="flow === 0" :disabled="submitting" @click="emit('cancel')">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton v-else :disabled="submitting || advancing" @click="back">
        {{ t('sync.oauth.back') }}
      </BaseButton>
      <BaseButton
        v-if="flow === 2"
        variant="primary" :loading="submitting" :disabled="nextDisabled" @click="() => onNext(true)"
      >{{ t('sync.flow.save_create') }}</BaseButton>
      <BaseButton variant="primary" :loading="submitting || advancing" :disabled="nextDisabled" @click="() => onNext()">
        {{ primaryLabel }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.add-flow { display: flex; flex-direction: column; gap: var(--sp-4); width: 100%; }

.flow-stack { display: grid; gap: var(--sp-4); }
.flow-choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-3); }
@media (max-width: 640px) { .flow-choices { grid-template-columns: 1fr; } }

/* 品牌标识 */
.flow-choice-title { display: inline-flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.flow-logo { width: var(--sp-5); height: var(--sp-5); object-fit: contain; flex: none; }

/* 底部动作条: 按钮靠右 */
.flow-footer-spacer { flex: 1; }
.flow-footer { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-2); }
</style>