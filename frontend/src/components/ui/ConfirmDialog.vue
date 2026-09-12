<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import BaseButton from './BaseButton.vue'

defineOptions({ name: 'ConfirmDialog' })

const props = defineProps<{
  modelValue: boolean
  /** 每次打开递增 (排队弹窗时 visible 在同 tick 内 false→true, 仅靠 modelValue 无法触发重置) */
  openSeq?: number
  title?: string
  message: string
  variant?: 'default' | 'danger'
  confirmText?: string
  cancelText?: string
  altText?: string
  altVariant?: 'default' | 'primary' | 'danger' | 'success'
  loading?: boolean
  showDontAsk?: boolean
  checkboxLabel?: string
  checkboxInternal?: boolean
  checkboxRef?: Ref<boolean>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [dontAsk?: boolean]
  alt: []
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })

const dontAsk = ref(false)
const localCheckbox = ref(false)
const cancelBtnRef = ref<InstanceType<typeof BaseButton> | null>(null)
const confirmLabel = computed(() => props.confirmText || t('common.btn.confirm'))

const checkboxChecked = computed<boolean>({
  get: () => props.checkboxRef ? props.checkboxRef.value : localCheckbox.value,
  set: (v) => {
    if (props.checkboxRef) props.checkboxRef.value = v
    else localCheckbox.value = v
  },
})

const hasFooterLeft = computed(() => props.showDontAsk || !!props.checkboxLabel)

// Reset checkboxes when dialog opens; danger variant focuses Cancel to avoid accidental confirm.
// 监听 [modelValue, openSeq] 元组: 排队续接的弹窗 visible 不变, 只有 openSeq 变化.
watch(() => [props.modelValue, props.openSeq ?? 0] as const, async ([open]) => {
  if (!open) return
  dontAsk.value = false
  if (!props.checkboxRef) localCheckbox.value = props.checkboxInternal ?? false
  if (props.variant === 'danger') {
    await nextTick()
    // BaseModal 也在 nextTick 聚焦弹窗容器，延迟到宏任务再聚焦取消键
    window.setTimeout(() => {
      const el = cancelBtnRef.value?.$el as HTMLElement | undefined
      el?.focus()
    }, 0)
  }
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
  <BaseModal :model-value="modelValue" @update:model-value="close" :title="title" size="sm" :close-on-overlay="false" :footer-align="hasFooterLeft ? 'between' : 'end'" :z-index="1100">
    <p class="confirm-message">{{ message }}</p>
    <template #footer>
      <div v-if="hasFooterLeft" class="confirm-footer-left">
        <label v-if="checkboxLabel" class="confirm-dont-ask">
          <input v-model="checkboxChecked" type="checkbox">
          <span>{{ checkboxLabel }}</span>
        </label>
        <label v-if="showDontAsk" class="confirm-dont-ask">
          <input v-model="dontAsk" type="checkbox">
          <span>{{ t('common.btn.dont_ask') }}</span>
        </label>
      </div>
      <div class="confirm-buttons">
        <BaseButton ref="cancelBtnRef" :disabled="loading" @click="close">{{ cancelLabel }}</BaseButton>
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
  /* 长文件名（无空格）可能撑破弹窗，任意处断行；内容超高时滚动而非截断，
     保证“无法撤销”等后果说明始终完整可见 */
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
  max-height: 40vh;
  overflow-y: auto;
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

.confirm-footer-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.confirm-buttons {
  display: flex;
  gap: 8px;
}
</style>
