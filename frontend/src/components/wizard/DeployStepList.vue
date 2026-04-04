<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DeployStep } from '@/types/wizard'

defineOptions({ name: 'DeployStepList' })

defineProps<{
  steps: DeployStep[]
}>()

const { t } = useI18n({ useScope: 'global' })

const icons: Record<DeployStep['status'], string> = {
  active: 'hourglass_top',
  done: 'check_circle',
  error: 'cancel',
}

function translateStep(name: string): string {
  // Handle "install_attn:FA2/SA2" format
  if (name.startsWith('install_attn:')) {
    const parts = name.slice('install_attn:'.length)
    return t('wizard.steps.install_attn', { parts })
  }
  const key = `wizard.steps.${name}`
  const translated = t(key)
  // If translation key not found, t() returns the key itself — fall back to raw name
  return translated === key ? name : translated
}
</script>

<template>
  <div class="deploy-steps">
    <div
      v-for="(step, i) in steps"
      :key="i"
      class="deploy-steps__item"
      :class="`deploy-steps__item--${step.status}`"
    >
      <span class="ms ms-xs deploy-steps__icon">{{ icons[step.status] }}</span>
      <span>{{ translateStep(step.name) }}</span>
    </div>
  </div>
</template>

<style scoped>
.deploy-steps {
  position: sticky;
  top: 20px;
}

.deploy-steps__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: .95rem;
  color: var(--t3);
  transition: color .2s;
}

.deploy-steps__item--active {
  color: var(--t1);
  font-weight: 500;
}

.deploy-steps__item--done {
  color: var(--green);
}

.deploy-steps__item--error {
  color: var(--red);
}

.deploy-steps__icon {
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}
</style>
