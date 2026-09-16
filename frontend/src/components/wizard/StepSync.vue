<script setup lang="ts">
/**
 * Step 4 同步规则 —— 预设卡网格 (2×2)。
 *
 * - 预设卡 (PresetRuleCard): 整卡勾选启用, 路径不可改 (部署时按 entry +
 *   同步文件夹/bucket 重算); 上传输出是 移动/复制 两张互斥预设卡
 * - 仅提供部署时/监控触发的预设; 手动触发的备份预设与自定义规则不在向导
 *   提供 (dashboard「添加规则」才有) —— 部署向导未完成时相关 API 有守卫
 * - 布局: 2×2 网格
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardRclone } from '@/composables/useWizardRclone'
import WizardStepLayout from './WizardStepLayout.vue'
import PresetRuleCard from '@/components/sync/PresetRuleCard.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import { remoteBrand } from '@/config/remote-logos'

defineOptions({ name: 'StepSync' })

const { t } = useI18n({ useScope: 'global' })
const { config, nextStep, prevStep } = useWizardState()
const {
  presetTemplates,
  isRuleSelected, toggleRule,
  currentRemote,
} = useWizardRclone()

/** 向导只提供部署时/监控触发的预设; 手动触发的备份预设部署完成后在 dashboard 添加 */
const wizardTemplates = computed(() =>
  presetTemplates.value.filter(tpl => tpl.entries[0]?.trigger !== 'manual'),
)

const selectedCount = computed(() => config.wizard_sync_rules.length)

const brandOf = (type: string) => remoteBrand(type)

// 上传输出的两种方式拆成两张互斥卡 (选中一张自动取消另一张)
const OUTPUT_MOVE = 'tpl-push-output'
const OUTPUT_COPY = 'tpl-push-output-copy'

function onPresetClick(tplId: string) {
  if (!isRuleSelected(tplId)) {
    const opposite = tplId === OUTPUT_MOVE ? OUTPUT_COPY
      : tplId === OUTPUT_COPY ? OUTPUT_MOVE : null
    if (opposite && isRuleSelected(opposite)) toggleRule(opposite)
  }
  toggleRule(tplId)
}

const onNext = () => nextStep()
function onPrev() { prevStep() }
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

    <!-- 预设规则 (单一分组, 网格布局) -->
    <div class="step-sync__panel">
      <h4 class="step-sync__panel-title">
        <MsIcon name="sync" size="sm" />
        {{ t('wizard.step4.rules_title') }}
        <HelpTip :text="t('wizard.step4.rules_help')" />
        <span v-if="selectedCount > 0" class="step-sync__section-count">{{ t('wizard.step4.selected_n', { n: selectedCount }) }}</span>
      </h4>

      <div class="step-sync__grid">
        <PresetRuleCard
          v-for="tpl in wizardTemplates"
          :key="tpl.id"
          :preset="tpl"
          :selected="isRuleSelected(tpl.id)"
          @toggle="onPresetClick(tpl.id)"
        />
      </div>
    </div>
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

/* 卡片网格: 2×2 */
.step-sync__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 640px) {
  .step-sync__grid { grid-template-columns: 1fr; }
}
</style>