<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import BaseButton from './BaseButton.vue'

defineOptions({ name: 'ConfirmDialog' })

const props = defineProps<{
  modelValue: boolean
  title?: string
  message: string
  variant?: 'default' | 'danger'
  confirmText?: string
  cancelText?: string
  altText?: string
  altVariant?: 'default' | 'primary' | 'danger' | 'success'
  loading?: boolean
  showDontAsk?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [dontAsk?: boolean]
  alt: []
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })

const dontAsk = ref(false)
const confirmLabel = computed(() => props.confirmText || t('common.btn.confirm'))

// Reset checkbox when dialog opens
watch(() => props.modelValue, (open) => {
  if (open) dontAsk.value = false
})
const cancelLabel = computed(() => props.cancelText || t('common.btn.cancel'))
const confirmVariant = computed(() => props.variant === 'danger' ? 'danger' : 'primary')

function close() {
  emit('update:modelValue', false)
  emit('cancel')
}

function doConfirm() {
  emit('confirm', dontAsk.value)
}

function doAlt() {
  emit('alt')
}
</script>

<template>
  <BaseModal :model-value="modelValue" @update:model-value="close" :title="title" size="sm" :close-on-overlay="false" :footer-align="showDontAsk ? 'between' : 'end'" :z-index="1100">
    <p class="confirm-message">{{ message }}</p>
    <template #footer>
      <label v-if="showDontAsk" class="confirm-dont-ask">
        <input v-model="dontAsk" type="checkbox">
        <span>{{ t('common.btn.dont_ask') }}</span>
      </label>
      <div class="confirm-buttons">
        <BaseButton :disabled="loading" @click="close">{{ cancelLabel }}</BaseButton>
        <BaseButton v-if="altText" :variant="altVariant ?? 'default'" :disabled="loading" @click="doAlt">{{ altText }}</BaseButton>
        <BaseButton :variant="confirmVariant" :loading="loading" @click="doConfirm">{{ confirmLabel }}</BaseButton>
      </div>
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

.confirm-dont-ask {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .82rem;
  color: var(--t3);
  cursor: pointer;
  user-select: none;
}

.confirm-dont-ask input {
  accent-color: var(--ac);
}

.confirm-buttons {
  display: flex;
  gap: 8px;
}
</style>
