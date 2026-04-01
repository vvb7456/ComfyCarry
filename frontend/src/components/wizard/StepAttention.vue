<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import WizardStepLayout from './WizardStepLayout.vue'
import OptionCard from '@/components/ui/OptionCard.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

const { t } = useI18n({ useScope: 'global' })
const { config, prebuiltInfo, nextStep, prevStep } = useWizardState()

/** FA2 is locked (pre-installed) on prebuilt images */
const fa2Locked = computed(() => !!prebuiltInfo.value?.fa2)
const fa2Selected = computed(() => fa2Locked.value || config.install_fa2)

const nextLabel = computed(() =>
  (fa2Selected.value || config.install_sa2) ? t('wizard.btn.next') : t('wizard.btn.skip'),
)

const hintKey = computed(() => {
  if (fa2Selected.value && config.install_sa2) return 'wizard.step8.hint_both'
  if (fa2Selected.value) return 'wizard.step8.hint_fa2'
  if (config.install_sa2) return 'wizard.step8.hint_sa2'
  return 'wizard.step8.hint_none'
})

const hintIcon = computed(() => {
  if (fa2Selected.value && config.install_sa2) return 'lightbulb'
  if (fa2Selected.value) return 'local_fire_department'
  if (config.install_sa2) return 'eco'
  return 'info'
})

watch(fa2Locked, (locked) => {
  if (locked) config.install_fa2 = true
}, { immediate: true })

function toggleFa2() {
  if (fa2Locked.value) return
  config.install_fa2 = !config.install_fa2
}

function toggleSa2() {
  config.install_sa2 = !config.install_sa2
}

function onNext() { nextStep() }
function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step8.title')"
    icon="bolt"
    icon-color="#fbbf24"
    :description="t('wizard.step8.desc')"
    :next-label="nextLabel"
    @prev="onPrev"
    @next="onNext"
  >
    <template #description>
      <span class="step-attn__desc-text">{{ t('wizard.step8.desc') }}</span>
      <HelpTip :text="t('wizard.step8.attn_help')" />
    </template>

    <div class="step-attn__cards">
      <OptionCard
        class="step-attn__card"
        icon="local_fire_department"
        icon-color="#fb923c"
        title="FlashAttention-2"
        :description="fa2Locked ? t('wizard.step8.fa2_preinstalled') : t('wizard.step8.fa2_desc')"
        :selected="fa2Selected"
        :locked="fa2Locked"
        @toggle="toggleFa2"
      >
        <div class="step-attn__param">{{ t('wizard.step8.fa2_param') }}</div>
      </OptionCard>

      <OptionCard
        class="step-attn__card"
        icon="eco"
        icon-color="#34d399"
        title="SageAttention-2"
        :description="t('wizard.step8.sa2_desc')"
        :selected="config.install_sa2"
        @toggle="toggleSa2"
      >
        <div class="step-attn__param">{{ t('wizard.step8.sa2_param') }}</div>
      </OptionCard>
    </div>

    <AlertBanner tone="info" dense :icon="hintIcon">
      {{ t(hintKey) }}
    </AlertBanner>
  </WizardStepLayout>
</template>

<style scoped>
.step-attn__desc-text {
  display: inline;
}

.step-attn__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.step-attn__cards :deep(.option-card--locked) {
  opacity: .7;
}

.step-attn__param {
  font-size: .72rem;
  color: var(--t3);
  margin-top: 6px;
}
</style>
