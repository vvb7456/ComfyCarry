<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import BaseButton from './BaseButton.vue'

const props = defineProps<{
  modelValue: boolean
  title?: string
  message: string
  variant?: 'default' | 'danger'
  confirmText?: string
  cancelText?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })

const confirmLabel = computed(() => props.confirmText || t('common.btn.confirm'))
const cancelLabel = computed(() => props.cancelText || t('common.btn.cancel'))
const confirmVariant = computed(() => props.variant === 'danger' ? 'danger' : 'primary')

function close() {
  emit('update:modelValue', false)
  emit('cancel')
}

function doConfirm() {
  emit('confirm')
}
</script>

<template>
  <BaseModal :model-value="modelValue" @update:model-value="close" :title="title" size="sm" :close-on-overlay="false">
    <p class="confirm-message">{{ message }}</p>
    <template #footer>
      <BaseButton :disabled="loading" @click="close">{{ cancelLabel }}</BaseButton>
      <BaseButton :variant="confirmVariant" :loading="loading" @click="doConfirm">{{ confirmLabel }}</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.confirm-message {
  font-size: .88rem;
  color: var(--t1);
  line-height: 1.6;
  white-space: pre-line;
  margin: 0;
}
</style>
