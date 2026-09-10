<script setup lang="ts">
/**
 * Step 3 连接云存储 —— wizard step 语义的原生化版本。
 *
 * 两区域: 上方 provider 六卡选择区, 下方单卡承载当前 provider 的连接过程:
 * - OAuth: CloudAuthHero identity 模式 (登录 → 粘贴回调+确认 → done 展示
 *   存储名称+驱动器)。授权不需要名称 —— token 在服务端会话, 名称只在
 *   创建 remote (下一步) 时使用
 * - 非 OAuth: 名称 + S3 bucket + 凭据表单同卡展示
 *
 * 单存储语义: 向导只配置一个存储, 剩余的在 dashboard 处理; 重复创建会
 * 替换旧条目 (见 useWizardRclone.ensureCreated)。
 * 推进/跳过统一由 WizardStepLayout 底部导航承担; 未选 provider 且无已有
 * remote (导入 conf) → 「跳过」(nextStep 内部跳过 step 4)。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardRclone } from '@/composables/useWizardRclone'
import WizardStepLayout from './WizardStepLayout.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import OptionCard from '@/components/ui/OptionCard.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import CloudAuthHero from '@/components/sync/CloudAuthHero.vue'
import type { CloudProvider } from '@/config/cloud-providers'
import { remoteBrand } from '@/config/remote-logos'
import type { OAuthPhase } from '@/types/sync'

defineOptions({ name: 'StepRclone' })

const { t } = useI18n({ useScope: 'global' })
const { config, remoteTypeDefs, nextStep, prevStep } = useWizardState()
const {
  storageType, storageName, storageFields, storageBucket,
  storageError, storageOauthParams,
  currentFields, isOAuthType, cloudProviders,
  selectProvider, validateName, validateFields, ensureCreated, invalidateCreatedRemote,
} = useWizardRclone()

const cloudAuthHeroRef = ref<InstanceType<typeof CloudAuthHero> | null>(null)
const oAuthPhase = ref<OAuthPhase>('idle')
const creating = ref(false)

/** 本会话已连接 (服务端草稿里有计划): 镜像第一条 */
const connected = computed(() => config.wizard_remotes[0] || null)

/** 恢复标记: 进入 step3 时已有连接 (回退重进)。一次性 —— 用于让
 *  CloudAuthHero mount 时直接落 done 第三屏 (凭据在服务端草稿, 无需会话);
 *  用户点「更换账号」重授权后此标记作废, 走正常流程。
 *  连接后返回本步的场景 (storageType 已有值) 同样是恢复态: 单例里的
 *  storage* 是本会话状态, 服务端草稿里的凭据仍在, 直接落 done 屏。 */
const restoredOnce = ref(false)
const restoredFingerprint = ref('')
/** 失败会话恢复时前端没有旧凭据字段, 允许 source_name 复用服务端草稿。 */
const restoredFieldsAvailable = ref(false)

function sortedParams(params: Record<string, string> | undefined): Array<[string, string]> {
  return Object.keys(params || {}).sort().map(key => [key, params?.[key] || ''])
}

function storageFingerprint(): string {
  return JSON.stringify({
    type: storageType.value,
    name: storageName.value,
    bucket: storageBucket.value,
    fields: sortedParams(storageFields.value),
    oauth: sortedParams(storageOauthParams.value),
  })
}

/** 后端安全投影中的 OAuth 驱动器元数据, 只用于恢复显示/选择。 */
const restoredParams = computed<Record<string, string>>(() => {
  const remote = connected.value as (Record<string, unknown> | null)
  const type = storageType.value || (typeof remote?.type === 'string' ? remote.type : '')
  const result: Record<string, string> = {}
  const keys = type === 'onedrive'
    ? ['drive_id', 'drive_type']
    : type === 'drive' ? ['team_drive'] : []
  for (const key of keys) {
    const value = remote?.[key]
    if (typeof value === 'string' && value) result[key] = value
  }
  return result
})

if (connected.value
    && (!storageType.value
      || (storageType.value === connected.value.type
        && storageName.value === connected.value.name))) {
  restoredOnce.value = true
  restoredFieldsAvailable.value = Object.keys(storageFields.value).length > 0
  storageType.value = connected.value.type
  storageName.value = connected.value.name
  if (connected.value.type === 's3' && connected.value.bucket !== undefined) {
    storageBucket.value = connected.value.bucket
  }
  restoredFingerprint.value = storageFingerprint()
}

const restoredDirty = computed(() =>
  restoredOnce.value && storageFingerprint() !== restoredFingerprint.value,
)

/** 驱动器选择是 CloudAuthHero 内部状态, 在点击下一步时读取一次确认是否变化。 */
function restoredOAuthSelectionChanged(): boolean {
  if (!restoredOnce.value || !isOAuthType.value || !cloudAuthHeroRef.value) return false
  const type = storageType.value
  const keys = type === 'onedrive' ? ['drive_id', 'drive_type'] : type === 'drive' ? ['team_drive'] : []
  if (!keys.length) return false
  const current = cloudAuthHeroRef.value.getParams()
  return JSON.stringify(sortedParams(Object.fromEntries(keys.map(key => [key, current[key] || '']))))
    !== JSON.stringify(sortedParams(Object.fromEntries(keys.map(key => [key, restoredParams.value[key] || '']))))
}

function mergeOAuthParams(currentParams: Record<string, string>): Record<string, string> {
  const merged = { ...storageOauthParams.value, ...currentParams }
  if (!restoredOnce.value) return merged

  // 恢复态切回 Google 主盘时，不能因合并旧参数又带回已清除的共享盘。
  // 空值作为显式清除标记交给 source_name 合并逻辑;
  // 非驱动器参数 (如自建 client) 仍可复用。
  const selectionKeys = storageType.value === 'onedrive'
    ? ['drive_id', 'drive_type']
    : storageType.value === 'drive' ? ['team_drive'] : []
  for (const key of selectionKeys) delete merged[key]
  for (const key of selectionKeys) {
    merged[key] = currentParams[key] || ''
  }
  return merged
}

/** OAuth 授权完成且驱动器信息就绪后才允许下一步。
 *  驱动器列表拉取中同样置灰 —— 缺 drive_id 的 remote 在目录浏览时
 *  会报 unable to get drive_id and drive_type */
const nextDisabled = computed(() =>
  !!storageType.value && isOAuthType.value
  && !cloudAuthHeroRef.value?.readyForCreate,
)

/** 已有 remote (本会话创建/失败会话恢复) 时不选 provider 也可直接进 step 4 */
const hasAnyRemote = computed(() => config.wizard_remotes.length > 0)

const nextLabel = computed(() =>
  (storageType.value || hasAnyRemote.value) ? t('wizard.btn.next') : t('wizard.btn.skip'),
)

const currentProviderName = computed(() =>
  cloudProviders.find(p => p.id === storageType.value)?.name || storageType.value,
)

function onOAuthPhase(phase: OAuthPhase) {
  oAuthPhase.value = phase
}

function clearRestoredState() {
  restoredOnce.value = false
  restoredFingerprint.value = ''
  restoredFieldsAvailable.value = false
  invalidateCreatedRemote()
}

function onSelectProvider(p: CloudProvider) {
  // 先终止旧 provider 的 done 会话, 否则切换后新 provider 可能收到旧会话 409。
  // 点已选卡片取消 provider 时也要清掉会话, 避免稍后重新选择仍复用旧账号。
  cloudAuthHeroRef.value?.cancel()
  clearRestoredState()
  selectProvider(p)
}

function onOAuthReset() {
  clearRestoredState()
  storageOauthParams.value = {}
}

async function onNext() {
  if (!storageType.value) {
    nextStep()
    return
  }
  if (creating.value || nextDisabled.value) return
  if (!validateName()) return
  const target = storageName.value.trim()
  const restoringSameType = restoredOnce.value && connected.value?.type === storageType.value
  const sourceName = restoringSameType ? connected.value?.name : undefined
  // 恢复态: 凭据原样在服务端草稿, 名称未动 → 无需重建直接进 step4;
  // 改名、字段、bucket 或驱动器选择 → 走 ensureCreated 保存真实变更。
  if (restoredOnce.value
      && !restoredDirty.value
      && !restoredOAuthSelectionChanged()
      && connected.value?.type === storageType.value
      && connected.value?.name === target) {
    nextStep()
    return
  }
  if (isOAuthType.value) {
    // exchanging 期间直接点下一步: 先吃粘贴框里的 URL (保底, 主路径是卡片内确认)
    if (!(await cloudAuthHeroRef.value?.validatePaste())) return
    if (!restoredOnce.value && oAuthPhase.value !== 'done') return
    // 最终参数 (自建凭据 + drive_id 等) 以保存时点的 getParams 为准
    const currentParams = cloudAuthHeroRef.value?.getParams() || {}
    storageOauthParams.value = mergeOAuthParams(currentParams)
  } else if ((!restoringSameType || restoredFieldsAvailable.value) && !validateFields()) {
    return
  }

  creating.value = true
  const ok = await ensureCreated(sourceName)
  creating.value = false
  if (ok) nextStep()
}

function onPrev() { prevStep() }

// 切 provider 时同步本地 OAuth 相位 (CloudAuthHero 自身 watch type 重置)
watch(storageType, (next, previous) => {
  oAuthPhase.value = 'idle'
  if (previous && next !== previous) clearRestoredState()
})
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step3.title')"
    icon="cloud_sync"
    :next-label="nextLabel"
    :next-disabled="nextDisabled"
    :loading="creating"
    @prev="onPrev"
    @next="onNext"
  >
    <template #description>
      <span>{{ t('wizard.step3.desc') }}</span>
      <HelpTip :text="t('wizard.step3.rclone_help')" />
    </template>

    <!-- 区域 1: provider 选择六卡 -->
    <div class="step-rclone__choices">
      <OptionCard
        v-for="p in cloudProviders"
        :key="p.id"
        variant="bg2"
        :selected="storageType === p.id"
        @toggle="onSelectProvider(p)"
      >
        <template #title>
          <span class="step-rclone__choice-title">
            <img v-if="remoteBrand(p.id).logo" :src="remoteBrand(p.id).logo" alt="" class="step-rclone__logo">
            <MsIcon v-else :name="remoteBrand(p.id).icon" size="sm" />
            {{ p.name }}
          </span>
        </template>
        <template #description>{{ t(p.descKey) }}</template>
      </OptionCard>
    </div>

    <!-- 区域 2: 下方单卡 (选中 provider 后) -->
    <!-- OAuth: CloudAuthHero 单卡承载 登录 → 粘贴确认 → 名称/驱动器;
         恢复态 (回退重进) 直接落第三屏 done: 名称已恢复, 凭据在服务端草稿 -->
    <CloudAuthHero
      v-if="storageType && isOAuthType"
      :key="storageType"
      ref="cloudAuthHeroRef"
      v-model:name="storageName"
      :type="storageType"
      :types="remoteTypeDefs"
      identity
      :restored="restoredOnce"
      :restored-params="restoredParams"
      @update:phase="onOAuthPhase"
      @reset="onOAuthReset"
    />

    <!-- 非 OAuth: 名称 + S3 bucket + 凭据表单 -->
    <div v-else-if="storageType" class="step-rclone__panel">
      <div class="step-rclone__panel-head">
        <span class="step-rclone__panel-logo">
          <img v-if="remoteBrand(storageType).logo" :src="remoteBrand(storageType).logo" alt="">
          <MsIcon v-else :name="remoteBrand(storageType).icon" size="sm" />
        </span>
        <strong>{{ currentProviderName }}</strong>
      </div>

      <FormField :label="t('sync.remote.name')" density="compact">
        <input
          v-model="storageName"
          type="text"
          class="form-input"
          :placeholder="t('sync.remote.name_placeholder')"
          autocomplete="off"
        >
      </FormField>

      <!-- S3 存储桶 (rclone s3 路径首段) -->
      <FormField v-if="storageType === 's3'" :label="t('sync.dir.bucket_label')" density="compact">
        <input v-model="storageBucket" type="text" class="form-input" placeholder="comfy-assets" autocomplete="off">
      </FormField>

      <FormField
        v-for="field in currentFields"
        :key="field.key"
        :label="field.label"
        density="compact"
      >
        <BaseSelect
          v-if="field.type === 'select'"
          :model-value="storageFields[field.key] || ''"
          :options="(field.options || []).map(o => ({ value: o, label: o }))"
          teleport
          @update:model-value="(v: string | number | boolean) => storageFields[field.key] = String(v)"
        />
        <SecretInput v-else-if="field.type === 'password'" v-model="storageFields[field.key]" :is-password="true" :placeholder="field.placeholder" />
        <textarea v-else-if="field.type === 'textarea'" v-model="storageFields[field.key]" rows="3" class="form-textarea form-textarea--mono" :placeholder="field.placeholder" />
        <input v-else v-model="storageFields[field.key]" type="text" class="form-input" :placeholder="field.placeholder" autocomplete="off">
        <template v-if="field.help" #below>
          <p class="step-rclone__field-help" v-html="field.help" />
        </template>
      </FormField>
    </div>

    <!-- 错误就地提示 -->
    <AlertBanner v-if="storageError" tone="danger" dense>{{ storageError }}</AlertBanner>
  </WizardStepLayout>
</template>

<style scoped>
.step-rclone__choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-3);
}

@media (max-width: 640px) {
  .step-rclone__choices { grid-template-columns: 1fr; }
}

.step-rclone__choice-title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.step-rclone__logo {
  width: var(--sp-5);
  height: var(--sp-5);
  object-fit: contain;
  flex: none;
}

/* 下方单卡 (非 OAuth), 与 CloudAuthHero 的 v-panel 视觉一致 */
.step-rclone__panel {
  display: grid;
  gap: var(--sp-3);
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  padding: var(--sp-4);
}

.step-rclone__panel-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--t1);
}

.step-rclone__panel-logo {
  width: var(--sp-6);
  height: var(--sp-6);
  flex: none;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--ac) 8%, transparent);
  display: grid;
  place-items: center;
}

.step-rclone__panel-logo img {
  width: var(--sp-4);
  height: var(--sp-4);
  object-fit: contain;
}

.step-rclone__field-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--t3);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
