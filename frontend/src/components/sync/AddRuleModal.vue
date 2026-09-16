<script setup lang="ts">
/**
 * AddRuleModal — dashboard「添加规则」弹窗 (三步式引导)。
 *
 * 流程 (参考「添加存储」的首屏交互):
 * - step=1 选择存储: 首屏居中 BaseSelect (非全宽), 选定后点「下一步」
 * - step=2 选择规则: 6 个预设卡 + 1 个「自定义规则」卡 (点击单选, 右上角
 *   角标指示; 不再点击卡片直接跳转), 底部 上一步/下一步
 * - step=3 分两态:
 *   - 预设: 该规则详情只读清单 (名称/方向/方式/触发 + 每条子规则的实际
 *     remote/路径, 占位符按所选存储展开), 上一步/保存
 *   - 自定义: RuleFields 完整表单 (remote 锁定为所选存储), 上一步/保存
 *
 * 保存即追加 (POST rules/save, 现有规则 + 新规则)。预设远程路径 = 存储同步
 * 文件夹 (root_dir) + 相对路径, s3 再前置 bucket 首段; 自定义规则按用户填写。
 * wizard 不复用本组件 (其 step4 是勾选式预设网格, 样式独立)。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { apiErrorText } from '@/utils/apiError'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import PresetRuleCard from '@/components/sync/PresetRuleCard.vue'
import RuleFields from '@/components/sync/RuleFields.vue'
import PathBrowserModal from '@/components/sync/PathBrowserModal.vue'
import { joinRemotePath, localPathError } from '@/utils/syncPath'
import { remoteBrand } from '@/config/remote-logos'
import type { Remote, SyncRule, SyncTemplate, RulesSaveResponse } from '@/types/sync'

defineOptions({ name: 'AddRuleModal' })

const props = withDefaults(defineProps<{
  modelValue?: boolean
  presets: SyncTemplate[]
  remotes: Remote[]
  /** 追加保存的现有规则 */
  existingRules: SyncRule[]
  /** 打开时预选的存储名 (存储卡「创建同步规则」入口, 直接跳过存储选择) */
  presetRemote?: string
}>(), {
  modelValue: false,
  presetRemote: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [rules: SyncRule[]]
}>()

const { t, te } = useI18n({ useScope: 'global' })
const { post } = useApiFetch()
const { toast } = useToast()

function tr(key: string | undefined, fallback: string): string {
  return key && te(key) ? t(key) : fallback
}

// ── 流程状态 (step: 1=选存储 → 2=选规则 → 3=详情/表单) ──
type Choice = { kind: 'preset'; tpl: SyncTemplate } | { kind: 'custom' }
type Step = 1 | 2 | 3
const step = ref<Step>(1)
/** 二屏单选: null=未选 */
const choice = ref<Choice | null>(null)
const saving = ref(false)

/** 当前选定的存储 (第一步确定, 全程不变) */
const selectedRemote = ref('')

// 自定义态表单
const customForm = ref<Partial<SyncRule>>({})

function brandOf(r: Remote) {
  return remoteBrand(r.type, r.params?.provider)
}

function defaultRemote(): string {
  return props.presetRemote || props.remotes[0]?.name || ''
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  choice.value = null
  customForm.value = { direction: 'pull', method: 'copy', trigger: 'manual', enabled: true, remote: defaultRemote() }
  // 存储卡「创建同步规则」入口: 预选存储并直接进入规则选择
  if (props.presetRemote) {
    selectedRemote.value = props.presetRemote
    step.value = 2
  } else {
    selectedRemote.value = ''
    step.value = 1
  }
})

// ── 第一步: 存储下拉 ──
const remoteOptions = computed(() =>
  props.remotes.map(r => {
    const brand = brandOf(r)
    return { value: r.name, label: r.display_name || r.name, hint: r.name, logo: brand.logo, icon: brand.icon }
  }),
)

function goNext() {
  if (step.value === 1) {
    if (!selectedRemote.value) return
    customForm.value = { ...customForm.value, remote: selectedRemote.value }
    step.value = 2
    return
  }
  if (step.value === 2 && choice.value) step.value = 3
}

// ── 第二步: 规则单选卡 ──
const isChoiceSelected = (c: Choice): boolean => {
  if (!choice.value || choice.value.kind !== c.kind) return false
  return c.kind !== 'preset' || (choice.value as { kind: 'preset'; tpl: SyncTemplate }).tpl.id === c.tpl.id
}

function selectChoice(c: Choice) {
  choice.value = c
  if (c.kind === 'custom') {
    // 换存储后回到自定义表单时重置 remote
    customForm.value = { ...customForm.value, remote: selectedRemote.value }
  }
}

const canGoDetail = computed(() => !!choice.value)

// ── 第三步: 预设详情 (只读) / 自定义表单 ──
const currentPreset = computed(() =>
  choice.value?.kind === 'preset' ? choice.value.tpl : null,
)

// 弹窗标题即步骤名称 (选择存储 → 选择规则 → 确认规则/自定义规则)
const modalTitle = computed(() => {
  if (step.value === 1) return t('sync.rule.remote_select_title')
  if (step.value === 2) return t('sync.rule.choose_rule')
  return currentPreset.value ? t('sync.rule.confirm_title') : t('sync.rule.custom_title')
})

// ── 预设路径前缀: 同步文件夹 (与存储绑定, 在连接存储时选定) 之后的相对路径;
//    s3 再前置 bucket 作为首段 (rclone s3 路径首段即 bucket)。自定义规则原样。
//    拼接走 joinRemotePath, 与后端 config.join_remote_path 同一语义 (保留绝对
//    路径的前导 "/", 不把 sftp 的服务器绝对路径误改成 home 相对)。 ──
function entryRemotePath(remoteName: string, remotePath: string): string {
  const remote = props.remotes.find(r => r.name === remoteName)
  const rootDir = remote?.root_dir || ''
  const bucket = remote?.type === 's3' ? (remote.params?.bucket || '') : ''
  return joinRemotePath(bucket, rootDir, remotePath)
}

/** 预设 → 待创建规则 (规则名以当前语言固化; deploy 在 dashboard 落成 manual) */
function buildPresetRules(): SyncRule[] {
  const tpl = currentPreset.value
  if (!tpl) return []
  const remote = selectedRemote.value
  const ts = Date.now()
  return tpl.entries.map((e, i) => ({
    id: `rule_${ts}_${i}`,
    name: tr(e.name_key, e.name),
    direction: tpl.direction,
    remote,
    remote_path: entryRemotePath(remote, e.remote_path),
    local_path: e.local_path,
    method: e.method,
    trigger: e.trigger === 'deploy' ? 'manual' : e.trigger,
    enabled: true,
    filters: [...(e.filters || [])],
  }))
}

// ── 预设详情行 (只读信息列表, 占位符已按所选存储展开) ──
const presetName = computed(() => {
  const tpl = currentPreset.value
  return tpl ? tr(tpl.name_key, tpl.name) : ''
})

const triggerLabels: Record<string, string> = { deploy: 'sync.rules.deploy', watch: 'sync.rules.watch', manual: 'sync.rules.manual' }
const methodLabels: Record<string, string> = { copy: 'sync.rules.method_short.copy', sync: 'sync.rules.method_short.sync', move: 'sync.rules.method_short.move' }

interface PresetEntryRow {
  /** 条目名 (e.g. 模型 / 工作流) */
  name: string
  direction: string
  remote: string
  remotePath: string
  localPath: string
  method: string
  trigger: string
  filters: string[]
}

/** 三屏详情: 概要字段 + 每条子规则的实际路径 (remote 前缀替换占位) */
const presetInfoRows = computed(() => {
  const tpl = currentPreset.value
  if (!tpl) return []
  const remote = props.remotes.find(r => r.name === selectedRemote.value)
  const remoteLabel = remote?.display_name || selectedRemote.value
  const flow = tpl.direction === 'push' ? t('sync.rule.push') : t('sync.rule.pull')
  const rows: PresetEntryRow[] = []
  for (const e of tpl.entries) {
    rows.push({
      name: tr(e.name_key, e.name),
      direction: flow,
      remote: remoteLabel,
      remotePath: entryRemotePath(selectedRemote.value, e.remote_path),
      localPath: e.local_path,
      method: t(methodLabels[e.method] || e.method),
      trigger: t(triggerLabels[e.trigger] || e.trigger),
      filters: [...(e.filters || [])],
    })
  }
  return rows
})

async function savePreset(runAfter = false) {
  const newRules = buildPresetRules()
  if (!newRules.length || !newRules[0].remote) {
    toast(t('sync.rule.fill_required'), 'warning')
    return
  }
  await saveRules(newRules, runAfter)
}

async function saveCustom(runAfter = false) {
  const f = customForm.value
  if (!f.name?.trim() || !f.remote || !f.local_path?.trim() || !f.remote_path?.trim()) {
    toast(t('sync.rule.fill_required'), 'warning')
    return
  }
  const perr = localPathError(f.local_path)
  if (perr) {
    toast(t(`sync.err.${perr.key}`, perr.params || {}), 'warning')
    return
  }
  const filters = typeof f.filters === 'string'
    ? f.filters.split('\n').filter(Boolean)
    : (f.filters || [])
  await saveRules([{ ...(f as SyncRule), filters, enabled: true, id: `rule_${Date.now()}` }], runAfter)
}

async function saveRules(newRules: SyncRule[], runAfter = false) {
  saving.value = true
  try {
    const d = await post<RulesSaveResponse>('/api/sync/rules/save', {
      rules: [...props.existingRules, ...newRules],
    })
    if (d?.ok || d?.rules) {
      const saved = d.rules || [...props.existingRules, ...newRules]
      toast(t('sync.rule.saved'), 'success')
      emit('saved', saved)
      emit('update:modelValue', false)
      // 「保存并立即执行」: 保存成功后按新规则 id 逐条触发 (后端一次一个 job)
      if (runAfter) {
        for (const r of newRules) {
          await post('/api/sync/rules/run', { rule_id: r.id })
        }
        toast(t('sync.rule.run_ok'), 'info')
      }
    } else if (d) {
      toast(apiErrorText(d, t('sync.rule.save_failed')), 'error')
    }
  } finally {
    saving.value = false
  }
}

// ── 「保存并立即执行」: 仅手动触发规则提供 (dashboard 语境 deploy 落成
//    manual, 同样可立即执行; 监控规则不该被手动跑) ──
const isManualPreset = computed(() =>
  currentPreset.value?.entries.every(e => e.trigger === 'manual' || e.trigger === 'deploy') ?? false,
)

const isManualCustom = computed(() => customForm.value.trigger === 'manual')

// ── 步进 ──
function back() {
  if (step.value === 3) {
    step.value = 2
    return
  }
  // step=2 → 回存储选择 (保留单选, 返回后仍可见)
  step.value = 1
}

// ── 路径浏览 (自定义表单) ──
const browseModal = ref(false)
const browseMode = ref<'local' | 'remote'>('remote')
const browseTargetField = ref<'remote_path' | 'local_path'>('remote_path')

function onBrowse(mode: 'local' | 'remote', field: 'remote_path' | 'local_path') {
  browseMode.value = mode
  browseTargetField.value = field
  browseModal.value = true
}

function onBrowseSelect(path: string) {
  customForm.value[browseTargetField.value] = path
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="modalTitle"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 第一步: 选择存储 (首屏居中 select, 非全宽) -->
    <div v-if="step === 1" class="add-rule-step">
      <div class="add-rule-step__center">
        <div class="add-rule-step__select">
          <BaseSelect
            v-model="selectedRemote"
            :options="remoteOptions"
            :placeholder="t('sync.rule.select_storage_ph')"
            teleport
          />
        </div>
      </div>
      <div class="add-rule-footer">
        <span class="add-rule-footer__spacer" />
        <BaseButton :disabled="saving" @click="emit('update:modelValue', false)">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton variant="primary" :disabled="!selectedRemote" @click="goNext">
          {{ t('sync.flow.next') }}
        </BaseButton>
      </div>
    </div>

    <!-- 第二步: 选择规则 (预设 + 自定义, 点击单选; 按钮右对齐) -->
    <div v-else-if="step === 2" class="add-rule-step">
      <div class="add-rule-grid">
        <PresetRuleCard
          v-for="tpl in presets"
          :key="tpl.id"
          :preset="tpl"
          deploy-as-manual
          hide-check
          :selected="isChoiceSelected({ kind: 'preset', tpl })"
          @toggle="selectChoice({ kind: 'preset', tpl })"
        />
        <button
          type="button"
          class="add-rule-custom-card"
          :class="{ 'is-selected': choice?.kind === 'custom' }"
          @click="selectChoice({ kind: 'custom' })"
        >
          <span class="add-rule-custom-card__icon"><MsIcon name="tune" size="sm" /></span>
          <span class="add-rule-custom-card__title">{{ t('sync.rule.custom_add') }}</span>
          <span class="add-rule-custom-card__desc">{{ t('sync.rule.custom_desc') }}</span>
        </button>
      </div>
      <div class="add-rule-footer">
        <span class="add-rule-footer__spacer" />
        <BaseButton :disabled="saving" @click="back">{{ t('sync.oauth.back') }}</BaseButton>
        <BaseButton variant="primary" :disabled="!canGoDetail" @click="goNext">
          {{ t('sync.flow.next') }}
        </BaseButton>
      </div>
    </div>

    <!-- 第三步 a: 预设详情 (只读信息列表, 路径已按所选存储展开) -->
    <div v-else-if="currentPreset" class="add-rule-step">
      <!-- 概要 -->
      <dl class="add-rule-info">
        <dt class="add-rule-info__label">{{ t('sync.rule.name') }}</dt>
        <dd class="add-rule-info__value">{{ presetName }}</dd>
        <dt class="add-rule-info__label">{{ t('sync.rule.direction') }}</dt>
        <dd class="add-rule-info__value">{{ presetInfoRows[0]?.direction }}</dd>
        <dt class="add-rule-info__label">{{ t('sync.rule.remote') }}</dt>
        <dd class="add-rule-info__value">{{ presetInfoRows[0]?.remote }}</dd>
      </dl>

      <!-- 子规则明细: 每条一张只读块, 路径分两行 -->
      <div v-for="(row, i) in presetInfoRows" :key="i" class="add-rule-entry">
        <div class="add-rule-entry__name">{{ row.name }}</div>
        <dl class="add-rule-info add-rule-info--entry">
          <dt class="add-rule-info__label">{{ t('sync.rule.local_path') }}</dt>
          <dd class="add-rule-info__value mono">{{ row.localPath }}</dd>
          <dt class="add-rule-info__label">{{ t('sync.rule.remote_path') }}</dt>
          <dd class="add-rule-info__value mono">{{ row.remote }}:{{ row.remotePath }}</dd>
          <dt class="add-rule-info__label">{{ t('sync.rule.method') }}</dt>
          <dd class="add-rule-info__value">{{ row.method }}</dd>
          <dt class="add-rule-info__label">{{ t('sync.rule.trigger') }}</dt>
          <dd class="add-rule-info__value">{{ row.trigger }}</dd>
          <template v-if="row.filters.length">
            <dt class="add-rule-info__label">{{ t('sync.rule.filters') }}</dt>
            <dd class="add-rule-info__value mono">{{ row.filters.join('\n') }}</dd>
          </template>
        </dl>
      </div>

      <div class="add-rule-footer">
        <span class="add-rule-footer__spacer" />
        <BaseButton :disabled="saving" @click="back">{{ t('sync.oauth.back') }}</BaseButton>
        <BaseButton
          v-if="isManualPreset"
          variant="primary" :loading="saving" @click="savePreset(true)"
        >{{ t('sync.rule.save_run') }}</BaseButton>
        <BaseButton variant="primary" :loading="saving" @click="savePreset()">
          {{ t('common.btn.save') }}
        </BaseButton>
      </div>
    </div>

    <!-- 第三步 b: 自定义规则表单 (remote 锁定为选定的存储) -->
    <div v-else class="add-rule-step">
      <RuleFields
        :rule="customForm"
        :remote-options="[]"
        :fixed-remote="selectedRemote"
        @browse="onBrowse"
      />
      <div class="add-rule-footer">
        <span class="add-rule-footer__spacer" />
        <BaseButton :disabled="saving" @click="back">{{ t('sync.oauth.back') }}</BaseButton>
        <BaseButton
          v-if="isManualCustom"
          variant="primary" :loading="saving" @click="saveCustom(true)"
        >{{ t('sync.rule.save_run') }}</BaseButton>
        <BaseButton variant="primary" :loading="saving" @click="saveCustom()">
          {{ t('common.btn.save') }}
        </BaseButton>
      </div>
    </div>

    <PathBrowserModal
      v-model="browseModal"
      :mode="browseMode"
      :remote="customForm.remote || ''"
      @select="onBrowseSelect"
    />
  </BaseModal>
</template>

<style scoped>
.add-rule-step { display: grid; gap: 12px; }

/* 步骤名称改由 modal 标题承担, 不再内置 */

/* 首屏: select 居中 (非全宽) */
.add-rule-step__center {
  display: flex;
  justify-content: center;
  padding: 22px 0 10px;
}

.add-rule-step__select {
  width: min(320px, 100%);
}

.add-rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 560px) {
  .add-rule-grid { grid-template-columns: 1fr; }
}

/* 自定义规则卡: 与 PresetRuleCard (OptionCard) 同构的两行卡, 支持单选 */
.add-rule-custom-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  box-sizing: border-box;
  padding: 12px 14px;
  border: 2px solid transparent;
  border-radius: var(--r);
  background: var(--bg2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .2s;
}

.add-rule-custom-card:hover { border-color: var(--bd-f); }

.add-rule-custom-card.is-selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 8%, var(--bg3));
}

.add-rule-custom-card__icon {
  display: inline-flex;
  color: var(--blue);
}

.add-rule-custom-card__title {
  font-weight: 700;
  font-size: .95rem;
  color: var(--t1);
}

.add-rule-custom-card__desc {
  font-size: .8rem;
  color: var(--t2);
  line-height: 1.5;
}

/* 三屏 a: 预设详情 (键值只读列表, 与编辑表单同构) */
.add-rule-info {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 8px 14px;
  margin: 0;
  font-size: var(--text-sm, .85rem);
}

.add-rule-info__label {
  color: var(--t3);
  white-space: nowrap;
}

.add-rule-info__value {
  margin: 0;
  color: var(--t1);
  overflow-wrap: anywhere;
  align-self: center;
}

.add-rule-info__value.mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs, .78rem);
}

/* 子规则明细块: 只读边框卡, 分隔各条目 */
.add-rule-entry {
  border: 1px solid var(--bd);
  border-radius: var(--rs, 6px);
  background: var(--bg2);
  padding: 10px 14px;
  display: grid;
  gap: 8px;
}

.add-rule-entry__name {
  font-size: var(--text-sm, .85rem);
  font-weight: 600;
  color: var(--t1);
  display: flex;
  align-items: center;
  gap: 6px;
}

.add-rule-entry__name::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ac);
}

.add-rule-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-rule-footer__spacer { flex: 1; }
</style>