<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardRclone } from '@/composables/useWizardRclone'
import WizardStepLayout from './WizardStepLayout.vue'
import SyncRuleCard from './SyncRuleCard.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

const { t } = useI18n({ useScope: 'global' })
const { config, nextStep, prevStep } = useWizardState()
const {
  allRemoteNames, pullTemplates, pushTemplates,
  isRuleSelected, toggleRule, updateRuleRemote, updateRulePath,
  defaultRemoteName,
} = useWizardRclone()

const selectedCount = computed(() => config.wizard_sync_rules.length)

const pullSelectedCount = computed(() =>
  pullTemplates.value.filter(t => isRuleSelected(t.id)).length,
)

const pushSelectedCount = computed(() =>
  pushTemplates.value.filter(t => isRuleSelected(t.id)).length,
)

// Local overrides for unselected cards (not yet in wizard_sync_rules)
const remoteOverrides = reactive<Record<string, string>>({})
const pathOverrides = reactive<Record<string, string>>({})

function getRuleRemote(templateId: string): string {
  const rule = config.wizard_sync_rules.find(r => r.template_id === templateId)
  return rule?.remote || remoteOverrides[templateId] || defaultRemoteName.value
}

function getRulePath(templateId: string, defaultPath: string): string {
  const rule = config.wizard_sync_rules.find(r => r.template_id === templateId)
  return rule?.remote_path || pathOverrides[templateId] || defaultPath
}

function onToggle(templateId: string) {
  const remote = remoteOverrides[templateId] || defaultRemoteName.value
  const path = pathOverrides[templateId] || ''
  toggleRule(templateId, remote, path)
}

/** Apply remote change — store override for unselected, update rule for selected */
function onUpdateRemote(templateId: string, remote: string) {
  if (isRuleSelected(templateId)) {
    updateRuleRemote(templateId, remote)
  } else {
    remoteOverrides[templateId] = remote
  }
}

/** Apply path change — store override for unselected, update rule for selected */
function onUpdatePath(templateId: string, path: string) {
  if (isRuleSelected(templateId)) {
    updateRulePath(templateId, path)
  } else {
    pathOverrides[templateId] = path
  }
}

function onNext() { nextStep() }
function onPrev() { prevStep() }

// ── Drag-to-scroll for horizontal card rows ──────────────────
const pullRowRef = ref<HTMLElement | null>(null)
const pushRowRef = ref<HTMLElement | null>(null)

function useDragScroll(el: HTMLElement) {
  let isDown = false
  let startX = 0
  let scrollLeft = 0

  function onMouseDown(e: MouseEvent) {
    // Ignore clicks on interactive elements inside cards
    const target = e.target as HTMLElement
    if (target.closest('input, select, .base-select, button')) return
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
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step4.title')"
    icon="sync"
    icon-color="#34d399"
    :description="t('wizard.step4.desc')"
    :next-label="selectedCount > 0 ? t('wizard.btn.next') : t('wizard.btn.skip')"
    @prev="onPrev"
    @next="onNext"
  >
    <!-- Default remote selector -->
    <FormField>
      <template #label>
        {{ t('wizard.step4.default_remote') }}
        <HelpTip :text="t('wizard.step4.default_remote_hint')" />
      </template>
      <BaseSelect
        v-model="defaultRemoteName"
        :options="allRemoteNames"
        :placeholder="t('wizard.step4.no_remote')"
        fit
      />
    </FormField>

    <!-- Pull rules -->
    <div class="step-sync__panel">
      <h4 class="step-sync__panel-title">
        <MsIcon name="cloud_download" size="sm" style="color: #60a5fa" />
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
          :remote="getRuleRemote(tpl.id)"
          :remote-path="getRulePath(tpl.id, tpl.remote_path)"
          :remote-options="allRemoteNames"
          @toggle="onToggle(tpl.id)"
          @update:remote="onUpdateRemote(tpl.id, $event)"
          @update:remote-path="onUpdatePath(tpl.id, $event)"
        />
      </div>
    </div>

    <!-- Push rules -->
    <div class="step-sync__panel">
      <h4 class="step-sync__panel-title">
        <MsIcon name="cloud_upload" size="sm" style="color: #34d399" />
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
          :remote="getRuleRemote(tpl.id)"
          :remote-path="getRulePath(tpl.id, tpl.remote_path)"
          :remote-options="allRemoteNames"
          @toggle="onToggle(tpl.id)"
          @update:remote="onUpdateRemote(tpl.id, $event)"
          @update:remote-path="onUpdatePath(tpl.id, $event)"
        />
      </div>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
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
