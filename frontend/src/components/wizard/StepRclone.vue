<script setup lang="ts">
/**
 * Step 3 连接云存储 —— wizard step 语义的原生化版本。
 *
 * 两区域: 上方 provider 六卡选择区, 下方单卡承载当前 provider 的连接过程。
 * 全部类型统一走 CloudAuthHero (identity):
 * - OAuth: 登录 → 粘贴回调+确认 → done
 * - 非 OAuth: 凭据表单 + 「连接」→ done
 * done 屏统一设置 存储名称 + 挂载根 (驱动器/存储桶) + 同步文件夹 ——
 * 名称等不再出现在凭据屏; 同步文件夹是预设规则路径的锚点。
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
import CloudAuthHero from '@/components/sync/CloudAuthHero.vue'
import type { CloudProvider } from '@/config/cloud-providers'
import { remoteBrand } from '@/config/remote-logos'
import type { OAuthPhase } from '@/types/sync'

defineOptions({ name: 'StepRclone' })

const { t } = useI18n({ useScope: 'global' })
const { config, remoteTypeDefs, nextStep, prevStep } = useWizardState()
const {
  storageType, storageName, storageFields, storageBucket, storageRootDir,
  storageError, storageOauthParams,
  isOAuthType, cloudProviders,
  selectProvider, validateName, validateFields, ensureCreated, invalidateCreatedRemote,
} = useWizardRclone()

const cloudAuthHeroRef = ref<InstanceType<typeof CloudAuthHero> | null>(null)
const oAuthPhase = ref<OAuthPhase>('idle')
const creating = ref(false)

/** 本会话已连接 (服务端草稿里有计划): 镜像第一条 */
const connected = computed(() => config.wizard_remotes[0] || null)

/** 恢复标记: 进入 step3 时已有连接 (回退重进)。一次性 —— 用于让
 *  CloudAuthHero mount 时直接落 done 第三屏 (凭据在服务端草稿, 无需会话);
 *  用户点「更换账号 / 修改连接信息」后此标记作废, 走正常流程。
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
    root_dir: storageRootDir.value,
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
  storageRootDir.value = connected.value.root_dir || ''
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

/** 已选 provider 时, 完成 (done) 屏的名称/挂载根/同步文件夹全部就绪才可前进。
 *  凭据屏的「连接/登录」是 CloudAuthHero 卡片内的主按钮, 与底部导航无关。 */
const nextDisabled = computed(() =>
  !!storageType.value && !cloudAuthHeroRef.value?.readyForCreate,
)

/** 已有 remote (本会话创建/失败会话恢复) 时不选 provider 也可直接进 step 4 */
const hasAnyRemote = computed(() => config.wizard_remotes.length > 0)

const nextLabel = computed(() =>
  (storageType.value || hasAnyRemote.value) ? t('wizard.btn.next') : t('wizard.btn.skip'),
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
  // 改名、字段、bucket、同步文件夹或驱动器选择 → 走 ensureCreated 保存真实变更。
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
  } else if (!restoringSameType || restoredFieldsAvailable.value) {
    // 非 OAuth 的必填校验在卡片内「连接」按钮已做, 这里兜底再验一次
    if (!validateFields()) return
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
    <!-- 全类型统一 CloudAuthHero: OAuth 登录 / 非 OAuth 凭据 → done 屏
         (名称 + 驱动器/存储桶 + 同步文件夹); 恢复态直接落 done, 凭据在服务端草稿,
         目录浏览走 {wizard:true} staged -->
    <CloudAuthHero
      v-if="storageType"
      :key="storageType"
      ref="cloudAuthHeroRef"
      v-model:name="storageName"
      v-model:fields="storageFields"
      v-model:root-dir="storageRootDir"
      v-model:bucket="storageBucket"
      :type="storageType"
      :types="remoteTypeDefs"
      identity
      :restored="restoredOnce"
      :restored-params="restoredParams"
      :staged="restoredOnce ? { wizard: true } : undefined"
      @update:phase="onOAuthPhase"
      @reset="onOAuthReset"
    />

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
</style>
