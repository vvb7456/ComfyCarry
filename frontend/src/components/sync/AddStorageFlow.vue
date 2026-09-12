<script setup lang="ts">
/**
 * AddStorageFlow — 添加存储流 (类型 → 连接) 的流程主体,
 * dashboard「添加存储」弹窗的内容 (外壳见 AddStorageModal)。
 *
 * 与 wizard 的关系: wizard step3 将本流程原生化为向导 step (StepRclone),
 * 本组件仅服务 dashboard; wizard 场景刷新即放弃, 不复用本组件。
 *
 * - 提交: 点「完成」才 POST /api/sync/remote/create 落盘 (此前凭据零落盘,
 *   关闭弹窗即丢弃, 无放弃守卫); 勾选「创建同步规则」时经 created 事件通知
 *   父组件打开规则弹窗并预填本存储
 * - 错误一律就地展示 (AlertBanner); 底部动作条 (返回/完成 + checkbox) 由本组件渲染
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useApiFetch } from '@/composables/useApiFetch'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText } from '@/utils/apiError'
import BaseButton from '@/components/ui/BaseButton.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import OptionCard from '@/components/ui/OptionCard.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import CloudAuthHero from '@/components/sync/CloudAuthHero.vue'
import { CLOUD_PROVIDERS, OAUTH_TYPES, type CloudProvider } from '@/config/cloud-providers'
import { remoteBrand } from '@/config/remote-logos'
import type {
  ApiOkResponse, OAuthPhase,
  RemoteField, RemoteTypeDef, StagedCreds,
} from '@/types/sync'

defineOptions({ name: 'AddStorageFlow' })

const props = withDefaults(defineProps<{
  /** 现有存储列表 (查重 / 覆盖确认) */
  existingRemotes?: Array<{ name: string; type: string }>
  /** 远端类型定义表 (非 oauth 凭据表单按 fields 动态渲染) */
  remoteTypes?: Record<string, RemoteTypeDef>
  /** 重连预填: 打开时自动选中对应 provider 并填 name */
  preset?: { type?: string; name?: string }
}>(), {
  existingRemotes: () => [],
  remoteTypes: () => ({}),
})

const emit = defineEmits<{
  /** 存储已创建 (点「完成」落盘成功; openRuleModal = 勾选了「创建同步规则」) */
  created: [remote: { name: string; type: string; openRuleModal: boolean }]
  /** flow=0 时请求关闭 (无数据) */
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const { post } = useApiFetch()
const { confirm } = useConfirm()

// ── 流程状态 (flow: 0=类型, 1=连接; 规则在弹窗外配置) ──
const flow = ref(0)
const type = ref('')
const name = ref('')
const fields = ref<Record<string, string>>({})
const bucket = ref('comfy-assets')

const error = ref('')
const submitting = ref(false)
/** 完成时勾选「创建同步规则」: 创建成功关闭弹窗后由父组件打开规则弹窗并预填本存储 */
const createRulesChecked = ref(false)

// OAuth 授权阶段 (经 CloudAuthHero 的 update:phase 同步, 用于下一步按钮 disable)
const oAuthPhase = ref<OAuthPhase>('idle')

const cloudAuthHeroRef = ref<InstanceType<typeof CloudAuthHero> | null>(null)

// ── 提供商 (共享常量, wizard StepRclone 复用) ──

const providers = CLOUD_PROVIDERS
const currentProvider = computed(() => providers.find(p => p.id === type.value) || null)
const isOAuthType = computed(() =>
  !!type.value && (props.remoteTypes[type.value]?.oauth ?? OAUTH_TYPES.includes(type.value)),
)
const currentFields = computed<RemoteField[]>(() =>
  type.value ? (props.remoteTypes[type.value]?.fields || []) : [],
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

/** 非 oauth 必填项校验: 按 field.required 收集缺失字段 label */
function validateFields(): boolean {
  const missing = currentFields.value
    .filter(f => f.required && !(fields.value[f.key] || '').trim())
    .map(f => f.label)
  if (missing.length > 0) {
    error.value = t('sync.remote.missing_fields', { fields: missing.join(', ') })
    return false
  }
  return true
}

// ── 阶段推进 (0=类型 → 1=连接; 「完成」时才落盘) ──
async function next() {
  error.value = ''
  if (flow.value === 0) {
    flow.value = 1
    return
  }
  await submitCreate()
}

function back() {
  error.value = ''
  if (flow.value === 1) {
    cloudAuthHeroRef.value?.cancel()
    flow.value = 0
  }
}

const primaryLabel = computed(() =>
  flow.value === 0 ? t('sync.flow.next') : t('common.btn.done'),
)

// ── staged 浏览 (目录选择器): 凭据经 env 注入跑 rclone, 不落盘。
//    OAuth 走会话 (token 永不出后端), 非 OAuth 表单直传 (与最终 create 同参) ──
const stagedCreds = computed<StagedCreds>(() => {
  if (isOAuthType.value) return { oauth: true }
  return { type: type.value, params: { ...fields.value } }
})

/**
 * 完成: 真实创建 remote (此前凭据仅留内存, 零落盘)。
 * 查重: 同名同类型 → 覆盖确认 (后端原地替换凭据, 规则不受影响); 同名不同类型 → 报错
 */
async function submitCreate() {
  if (!validateName()) return
  if (!isOAuthType.value && !validateFields()) return

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

  // 粘贴回调主路径下用户可能不点卡片内「确认」直接点「完成」:
  // 先吃粘贴框里的 URL 换取令牌。首次点击只推进到 done/驱动器确认屏,
  // 必须等用户确认名称/驱动器并再次点击才允许落盘创建。
  if (isOAuthType.value) {
    const wasDone = !!cloudAuthHeroRef.value?.isDone
    if (!(await cloudAuthHeroRef.value?.validatePaste())) {
      submitting.value = false
      error.value = t('sync.oauth.not_done_yet')
      return
    }
    if (!wasDone || !cloudAuthHeroRef.value?.readyForCreate) {
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
    name: target, type: type.value, oauth: isOAuthType.value, params, overwrite,
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
  emit('created', { name: target, type: type.value, openRuleModal: createRulesChecked.value })
}

function onOAuthPhase(phase: OAuthPhase) {
  oAuthPhase.value = phase
  // 驱动器列表由 CloudAuthHero (identity 模式) 在 done 态自行拉取
}

/** 主按钮 disable: 各态的前置条件不满足时置灰, 而不是点了才报错 */
const nextDisabled = computed(() => {
  if (submitting.value) return true
  if (flow.value === 0) return !type.value
  // OAuth 连接态: 未开始授权 / 上次授权失败需重登不可前进; 等待态允许
  // 底部「完成」先完成粘贴回调, done 后则必须等驱动器确认数据就绪。
  if (flow.value === 1 && isOAuthType.value) {
    if (oAuthPhase.value === 'idle' || oAuthPhase.value === 'error') return true
    if (oAuthPhase.value === 'done') return !cloudAuthHeroRef.value?.readyForCreate
    return false
  }
  return false
})

// ── 重置与重连预填 ──
function resetFlow() {
  flow.value = 0
  type.value = ''
  name.value = ''
  fields.value = {}
  bucket.value = 'comfy-assets'
  error.value = ''
  createRulesChecked.value = false
  oAuthPhase.value = 'idle'
  applyPreset()
}

/** preset (重连入口): 自动选中对应 provider 并填 name */
function applyPreset() {
  const p = props.preset
  if (!p?.type) return
  const provider = providers.find(x => x.id === p.type)
  if (!provider) return
  selectProvider(provider)
  if (p.name) name.value = p.name
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

    <!-- 态 1: 连接 (drive/bucket 也在此确定 —— 它们是 remote 的属性) -->
    <div v-else-if="flow === 1" class="flow-stack">
      <div class="flow-context">
        <span class="flow-context-logo">
          <img v-if="brandOf(type).logo" :src="brandOf(type).logo" alt="" class="flow-logo-sm">
          <MsIcon v-else :name="brandOf(type).icon" size="sm" />
        </span>
        <strong>{{ currentProvider?.name }}</strong>
        <span>/ {{ t('sync.steps.connect') }}</span>
      </div>
      <!-- 非 OAuth: 名称 + 凭据同屏; OAuth 名称在授权完成屏填写 -->
      <FormField v-if="!isOAuthType" :label="t('sync.remote.name')" density="compact">
        <input v-model="name" type="text" class="form-input" :placeholder="t('sync.remote.name_placeholder')" autocomplete="off">
      </FormField>

      <!-- OAuth 模式: 名称在授权完成屏填写 (identity, 对齐 wizard step3) -->
      <CloudAuthHero
        v-if="isOAuthType"
        ref="cloudAuthHeroRef"
        :type="type" v-model:name="name" :modal="true" :types="remoteTypes" identity
        @update:phase="onOAuthPhase"
      />

      <!-- S3 存储桶 (rclone s3 路径首段) -->
      <FormField v-if="type === 's3'" :label="t('sync.dir.bucket_label')" density="compact">
        <input v-model="bucket" type="text" class="form-input" placeholder="comfy-assets" autocomplete="off">
      </FormField>

      <!-- 非 OAuth: 凭据表单按后端 REMOTE_TYPE_DEFS 动态渲染 -->
      <template v-if="!isOAuthType">
        <FormField v-for="field in currentFields" :key="field.key" :label="field.label" density="compact">
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
            <p class="flow-field-help" v-html="field.help" />
          </template>
        </FormField>
      </template>
    </div>

    <!-- 错误就地提示 -->
    <AlertBanner v-if="error" tone="danger" dense>{{ error }}</AlertBanner>

    <!-- 底部动作条: 返回/取消 + checkbox(创建同步规则) + 完成 -->
    <div class="flow-footer">
      <label class="flow-create-rules">
        <input v-model="createRulesChecked" type="checkbox">
        <span>{{ t('sync.flow.create_rules') }}</span>
      </label>
      <span class="flow-footer-spacer" />
      <BaseButton :disabled="submitting" @click="flow === 0 ? emit('cancel') : back()">
        {{ flow === 0 ? t('common.btn.cancel') : t('sync.oauth.back') }}
      </BaseButton>
      <BaseButton variant="primary" :loading="submitting" :disabled="nextDisabled" @click="next">
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
.flow-logo-sm { width: var(--sp-4); height: var(--sp-4); object-fit: contain; }
.flow-context-logo {
  width: var(--sp-6); height: var(--sp-6); flex: none;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--ac) 8%, transparent);
  display: grid; place-items: center;
}
.flow-context { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-base); color: var(--t2); }
.flow-context strong { font-weight: 600; color: var(--t1); }

.flow-field-help { margin: 0; font-size: var(--text-xs); color: var(--t3); line-height: 1.4; overflow-wrap: anywhere; }

/* 底部动作条: checkbox 左对齐, 按钮靠右 */
.flow-create-rules {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: .82rem; color: var(--t3);
  cursor: pointer; user-select: none;
}
.flow-create-rules input { accent-color: var(--ac); }
.flow-footer-spacer { flex: 1; }
.flow-footer { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-2); }
</style>
