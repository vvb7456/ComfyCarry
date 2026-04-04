<script setup lang="ts">
import { useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'WizardStepLayout' })

const { t } = useI18n({ useScope: 'global' })

withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  iconColor?: string
  showPrev?: boolean
  showNext?: boolean
  nextLabel?: string
  nextVariant?: 'primary' | 'success'
  loading?: boolean
  nextDisabled?: boolean
}>(), {
  showPrev: true,
  showNext: true,
  nextLabel: undefined as string | undefined,
  nextVariant: 'primary',
})

const emit = defineEmits<{
  prev: []
  next: []
}>()

const slots = useSlots()
</script>

<template>
  <div class="wizard-step">
    <h2 class="wizard-step__title">
      <slot name="icon">
        <MsIcon v-if="icon" :name="icon" size="sm" :color="iconColor || 'none'" />
      </slot>
      {{ title }}
    </h2>

    <p v-if="description || slots.description" class="wizard-step__desc">
      <slot name="description">{{ description }}</slot>
    </p>

    <slot name="hint" />

    <div class="wizard-step__content">
      <slot />
    </div>

    <div class="wizard-step__footer">
      <slot name="footer">
        <BaseButton
          v-if="showPrev"
          variant="default"
          size="lg"
          @click="emit('prev')"
        >{{ t('wizard.btn.prev') }}</BaseButton>
        <BaseButton
          v-if="showNext"
          :variant="nextVariant === 'success' ? 'success' : 'primary'"
          size="lg"
          :disabled="nextDisabled"
          :loading="loading"
          @click="emit('next')"
        >{{ nextLabel ?? t('wizard.btn.next') }}</BaseButton>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.wizard-step__title {
  font-size: 1.3rem;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.wizard-step__desc {
  color: var(--t2);
  font-size: .95rem;
  margin-bottom: 24px;
  line-height: 1.6;
}

.wizard-step__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

/* prevent double spacing: gap + FormField margin-bottom */
.wizard-step__content > :deep(.form-field) {
  margin-bottom: 0;
}

.wizard-step__footer {
  display: flex;
  gap: 14px;
  margin-top: 28px;
}
</style>
