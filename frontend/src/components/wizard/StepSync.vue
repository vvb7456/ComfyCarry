<script setup lang="ts">
/**
 * Step 4 同步规则 —— 经典卡片布局 (水平卡片行 + 拖拽滚动)。
 *
 * 调整 (相对引入 OAuth 前的版本):
 * - 不再有默认远程选择器 —— 单存储语义, remote 隐式取计划第一条;
 *   顶部改为存储信息条 (logo/名称/类型/bucket)
 * - 目录经 PathBrowserModal 选择 (staged: 凭据在服务端草稿, env 注入浏览)
 * - 上传输出的 移动/保留本地 互斥 (选一自动取消另一), 移动需删除确认
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardRclone } from '@/composables/useWizardRclone'
import WizardStepLayout from './WizardStepLayout.vue'
import SyncRuleCard from './SyncRuleCard.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import PathBrowserModal from '@/components/sync/PathBrowserModal.vue'
import { remoteBrand } from '@/config/remote-logos'
import type { SyncTemplate } from '@/types/wizard'

defineOptions({ name: 'StepSync' })

const OUTPUT_MOVE = 'tpl-push-output'
const OUTPUT_COPY = 'tpl-push-output-copy'

const { t } = useI18n({ useScope: 'global' })
const { config, nextStep, prevStep } = useWizardState()
const {
  pullTemplates, pushTemplates,
  isRuleSelected, toggleRule, updateRulePath,
  currentRemote, ruleRemoteName, defaultPathFor,
  pathOverrides,
} = useWizardRclone()

const selectedCount = computed(() => config.wizard_sync_rules.length)

const pullSelectedCount = computed(() =>
  pullTemplates.value.filter(x => isRuleSelected(x.id)).length,
)

const pushSelectedCount = computed(() =>
  pushTemplates.value.filter(x => isRuleSelected(x.id)).length,
)

function getRulePath(tpl: { id: string; remote_path: string }): string {
  const rule = config.wizard_sync_rules.find(r => r.template_id === tpl.id)
  return rule?.remote_path || pathOverrides.value[tpl.id] || defaultPathFor(tpl)
}

function isOppositeOutput(id: string): string | null {
  if (id === OUTPUT_MOVE) return OUTPUT_COPY
  if (id === OUTPUT_COPY) return OUTPUT_MOVE
  return null
}

function onToggle(tpl: SyncTemplate) {
  // 移动/保留本地互斥: 选其一时自动取消另一条
  if (!isRuleSelected(tpl.id)) {
    const opposite = isOppositeOutput(tpl.id)
    if (opposite && isRuleSelected(opposite)) toggleRule(opposite, '')
  }
  toggleRule(tpl.id, pathOverrides.value[tpl.id] || defaultPathFor(tpl))
}

/** 未勾选规则上的目录改动存 overrides (勾选后改动直接写规则) */
function onPathInput(tplId: string, path: string) {
  if (isRuleSelected(tplId)) {
    updateRulePath(tplId, path)
  } else {
    pathOverrides.value[tplId] = path
  }
}

// ── 目录浏览器 (staged: 凭据在服务端草稿, env 注入浏览, 不落盘) ──

const browserTplId = ref('')
const browserOpen = ref(false)

function openBrowser(tplId: string) {
  browserTplId.value = tplId
  browserOpen.value = true
}

function onBrowserSelect(path: string) {
  const tplId = browserTplId.value
  if (!tplId) return
  // 远程路径原样保留用户写法的前导 "/" —— sftp 上 "remote:/path" 是服务器
  // 绝对路径、"remote:path" 是 home 相对, 语义不同 (见 PathBrowserModal 头注释);
  // 仅空串兜底为 "." (SFTP home 相对根), 绝对根仍由浏览器返回 "/"。
  onPathInput(tplId, path || '.')
}

const onNext = () => nextStep()

function onPrev() { prevStep() }

// ── 拖拽横滚卡片行 ──────────────────────────────────────────
const pullRowRef = ref<HTMLElement | null>(null)
const pushRowRef = ref<HTMLElement | null>(null)

function useDragScroll(el: HTMLElement) {
  let isDown = false
  let startX = 0
  let scrollLeft = 0

  function onMouseDown(e: MouseEvent) {
    // 卡片内的交互元素不触发拖拽
    const target = e.target as HTMLElement
    if (target.closest('input, select, .base-select, button, label')) return
    isDown = true
    el.classList.add('step-sync__rule-row--dragging')
    startX = e.pageX - el.offsetLeft
    scrollLeft = el.scrollLeft
  }

  function onMouseLeave() {
    isDown = false
    el.classList.remove('step-sync__rule-row--dragging')
  }

  function onMouseUp() {
    isDown = false
    el.classList.remove('step-sync__rule-row--dragging')
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDown) return
    e.preventDefault()
    const x = e.pageX - el.offsetLeft
    const walk = (x - startX) * 1.5
    el.scrollLeft = scrollLeft - walk
  }

  el.addEventListener('mousedown', onMouseDown)
  el.addEventListener('mouseleave', onMouseLeave)
  el.addEventListener('mouseup', onMouseUp)
  el.addEventListener('mousemove', onMouseMove)

  return () => {
    el.removeEventListener('mousedown', onMouseDown)
    el.removeEventListener('mouseleave', onMouseLeave)
    el.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('mousemove', onMouseMove)
  }
}

const cleanups: (() => void)[] = []

onMounted(() => {
  if (pullRowRef.value) cleanups.push(useDragScroll(pullRowRef.value))
  if (pushRowRef.value) cleanups.push(useDragScroll(pushRowRef.value))
})

onBeforeUnmount(() => {
  cleanups.forEach(fn => fn())
})

const brandOf = (type: string) => remoteBrand(type)
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step4.title')"
    icon="sync"
    :description="t('wizard.step4.desc')"
    :next-label="selectedCount > 0 ? t('wizard.btn.next') : t('wizard.btn.skip')"
    @prev="onPrev"
    @next="onNext"
  >
    <!-- 当前存储 (单存储语义: 所有规则隐式指向它) -->
    <div v-if="currentRemote" class="step-sync__storage">
      <span class="step-sync__storage-logo">
        <img v-if="brandOf(currentRemote.type).logo" :src="brandOf(currentRemote.type).logo" alt="">
        <MsIcon v-else :name="brandOf(currentRemote.type).icon" size="sm" />
      </span>
      <strong class="step-sync__storage-name">{{ currentRemote.name }}</strong>
      <span class="step-sync__storage-type">{{ currentRemote.type }}</span>
      <code v-if="currentRemote.bucket" class="step-sync__storage-bucket">{{ currentRemote.bucket }}</code>
    </div>

    <!-- Pull rules -->
    <div class="step-sync__panel">
      <h4 class="step-sync__panel-title">
        <MsIcon name="cloud_download" size="sm" style="color: var(--blue)" />
        {{ t('wizard.step4.pull_title') }}
        <HelpTip :text="t('wizard.step4.pull_help')" />
        <span v-if="pullSelectedCount > 0" class="step-sync__section-count">{{ t('wizard.step4.selected_n', { n: pullSelectedCount }) }}</span>
      </h4>
      <div ref="pullRowRef" class="step-sync__rule-row">
        <SyncRuleCard
          v-for="tpl in pullTemplates"
          :key="tpl.id"
          :template="tpl"
          :selected="isRuleSelected(tpl.id)"
          :remote="ruleRemoteName"
          :remote-path="getRulePath(tpl)"
          :remote-options="[]"
          browsable
          @toggle="onToggle(tpl)"
          @update:remote-path="onPathInput(tpl.id, $event)"
          @browse="openBrowser(tpl.id)"
        />
      </div>
    </div>

    <!-- Push rules -->
    <div class="step-sync__panel">
      <h4 class="step-sync__panel-title">
        <MsIcon name="cloud_upload" size="sm" style="color: var(--green)" />
        {{ t('wizard.step4.push_title') }}
        <HelpTip :text="t('wizard.step4.push_help')" />
        <span v-if="pushSelectedCount > 0" class="step-sync__section-count">{{ t('wizard.step4.selected_n', { n: pushSelectedCount }) }}</span>
      </h4>
      <div ref="pushRowRef" class="step-sync__rule-row">
        <SyncRuleCard
          v-for="tpl in pushTemplates"
          :key="tpl.id"
          :template="tpl"
          :selected="isRuleSelected(tpl.id)"
          :remote="ruleRemoteName"
          :remote-path="getRulePath(tpl)"
          :remote-options="[]"
          browsable
          @toggle="onToggle(tpl)"
          @update:remote-path="onPathInput(tpl.id, $event)"
          @browse="openBrowser(tpl.id)"
        />
      </div>
    </div>

    <!-- 目录浏览器: staged (wizard 计划); 打开即根目录, 不预填 -->
    <PathBrowserModal
      v-model="browserOpen"
      mode="remote"
      :remote="ruleRemoteName"
      :staged="{ wizard: true }"
      @select="onBrowserSelect"
    />
  </WizardStepLayout>
</template>

<style scoped>
/* 存储条 */
.step-sync__storage {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  margin-bottom: var(--sp-4);
}

.step-sync__storage-logo {
  width: var(--sp-5);
  height: var(--sp-5);
  flex: none;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--ac) 8%, transparent);
  display: grid;
  place-items: center;
}

.step-sync__storage-logo img {
  width: var(--sp-4);
  height: var(--sp-4);
  object-fit: contain;
}

.step-sync__storage-name { font-size: .88rem; }

.step-sync__storage-type {
  color: var(--t3);
  font-size: .78rem;
}

.step-sync__storage-bucket {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: .75rem;
  color: var(--t2);
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  padding: 1px 8px;
}

.step-sync__panel {
  margin-bottom: 18px;
}

.step-sync__panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .95rem;
  font-weight: 600;
  margin-bottom: 10px;
}

.step-sync__section-count {
  margin-left: auto;
  font-size: .72rem;
  font-weight: 400;
  color: var(--t3);
}

.step-sync__rule-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  cursor: grab;
}

.step-sync__rule-row--dragging {
  cursor: grabbing;
  user-select: none;
}
</style>
