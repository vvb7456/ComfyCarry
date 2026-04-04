<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { switchLanguage } from '@/i18n/vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import WizardStepper from '@/components/ui/WizardStepper.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import Spinner from '@/components/ui/Spinner.vue'

import StepDeploy from './StepDeploy.vue'
import StepPassword from './StepPassword.vue'
import StepTunnel from './StepTunnel.vue'
import StepRclone from './StepRclone.vue'
import StepSync from './StepSync.vue'
import StepCivitai from './StepCivitai.vue'
import StepLlm from './StepLlm.vue'
import StepPlugins from './StepPlugins.vue'
import StepAttention from './StepAttention.vue'
import StepConfirm from './StepConfirm.vue'

defineOptions({ name: 'WizardApp' })

const { t, locale } = useI18n({ useScope: 'global' })
const { currentStep, deployState, initLoading, init, totalSteps } = useWizardState()

function toggleLang() {
  switchLanguage(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}

const stepLabels = computed(() => {
  const arr = t('wizard.step_labels')
  return Array.isArray(arr) ? arr as string[] : []
})

onMounted(() => {
  init()
})
</script>

<template>
  <div class="wizard-app">
    <div class="wizard-app__toolbar">
      <button
        class="wizard-app__lang-toggle"
        :title="locale === 'zh-CN' ? t('wizard.btn.switch_to_en') : t('wizard.btn.switch_to_zh')"
        @click="toggleLang"
      >{{ locale === 'zh-CN' ? 'EN' : '中' }}</button>
      <ThemeToggle />
    </div>

    <!-- Loading -->
    <div v-if="initLoading" class="wizard-app__loading">
      <Spinner size="lg" />
    </div>

    <!-- Main Wizard -->
    <div v-else class="wizard-container">
      <div class="wizard-header">
        <h1>{{ t('wizard.header') }}</h1>
        <p v-html="t('wizard.subtitle')" />
      </div>

      <!-- Progress bar (hidden during deploy) -->
      <WizardStepper
        v-if="deployState !== 'deploying' && deployState !== 'done'"
        :total="totalSteps"
        :current="currentStep"
        :labels="stepLabels"
        class="wizard-app__stepper"
      />

      <!-- Step views -->
      <StepDeploy v-if="currentStep === 0 && deployState === 'idle'" />
      <StepPassword v-else-if="currentStep === 1 && deployState === 'idle'" />
      <StepTunnel v-else-if="currentStep === 2 && deployState === 'idle'" />
      <StepRclone v-else-if="currentStep === 3 && deployState === 'idle'" />
      <StepSync v-else-if="currentStep === 4 && deployState === 'idle'" />
      <StepCivitai v-else-if="currentStep === 5 && deployState === 'idle'" />
      <StepLlm v-else-if="currentStep === 6 && deployState === 'idle'" />
      <StepPlugins v-else-if="currentStep === 7 && deployState === 'idle'" />
      <StepAttention v-else-if="currentStep === 8 && deployState === 'idle'" />
      <StepConfirm v-else-if="currentStep === 9 || deployState !== 'idle'" />
    </div>
  </div>
</template>

<style scoped>
.wizard-app {
  width: 100%;
  min-height: 100vh;
}

.wizard-app__toolbar {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 8px;
}

.wizard-app__lang-toggle {
  background: var(--bg2);
  border: 1px solid var(--bd);
  color: var(--t2);
  border-radius: 4px;
  font-size: .68rem;
  font-weight: 600;
  padding: 4px 8px;
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
  letter-spacing: .03em;
  white-space: nowrap;
}

.wizard-app__lang-toggle:hover {
  background: var(--bg3);
  color: var(--t1);
}

.wizard-app__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.wizard-container {
  max-width: 960px;
  margin: 0 auto;
  padding: clamp(24px, 4vw, 60px) clamp(16px, 3vw, 40px);

  /* ── Wizard sizing tokens ──
     Fixed values that override shared component defaults for the wizard's
     spacious layout. Components consume via var(--x, fallback).
     html root = 100% (16px browser default) — all rem values are stable. */

  /* BaseButton md ≈ wizard action buttons */
  --btn-py-md: 10px;
  --btn-px-md: 22px;
  --btn-font-md: .92rem;

  /* BaseButton lg ≈ wizard navigation buttons */
  --btn-py-lg: 14px;
  --btn-px-lg: 36px;
  --btn-font-lg: 1.05rem;

  /* ModeCard */
  --mode-title-size: 1.05rem;
  --mode-desc-size: .88rem;

  /* BaseCard roomy density */
  --card-py-roomy: 22px;
  --card-px-roomy: 22px;

  /* Form inputs */
  --input-py: 10px;
  --input-px: 14px;
  --input-font: .92rem;
  --input-radius: 8px;

  /* Labels & hints */
  --label-font: .88rem;
  --hint-font: .78rem;
}

.wizard-header {
  text-align: center;
  margin-bottom: 36px;
}

.wizard-header h1 {
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #7c5cfc, #e879f9);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.wizard-header p {
  color: var(--t3);
  font-size: .95rem;
  margin-top: 8px;
}

.wizard-app__stepper {
  margin-bottom: 32px;
}

@media (max-width: 768px) {
  .wizard-container {
    padding: 24px 16px;
  }
}
</style>
