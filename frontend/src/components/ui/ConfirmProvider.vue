<script setup lang="ts">
import { ref, provide } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { confirmKey, type ConfirmOptions } from '@/composables/useConfirm'

defineOptions({ name: 'ConfirmProvider' })

const visible = ref(false)
const title = ref<string | undefined>()
const message = ref('')
const variant = ref<'default' | 'danger'>('default')
const confirmText = ref<string | undefined>()
const cancelText = ref<string | undefined>()
const dontAskKey = ref<string | undefined>()

interface QueueItem {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

const queue: QueueItem[] = []
let resolveFn: ((value: boolean) => void) | null = null

function confirm(options: ConfirmOptions): Promise<boolean> {
  // Auto-confirm if user previously checked "don't ask again"
  if (options.dontAskKey && localStorage.getItem(options.dontAskKey) === 'true') {
    return Promise.resolve(true)
  }
  return new Promise<boolean>((resolve) => {
    if (visible.value) {
      queue.push({ options, resolve })
    } else {
      showDialog(options, resolve)
    }
  })
}

function showDialog(options: ConfirmOptions, resolve: (value: boolean) => void) {
  title.value = options.title
  message.value = options.message
  variant.value = options.variant ?? 'default'
  confirmText.value = options.confirmText
  cancelText.value = options.cancelText
  dontAskKey.value = options.dontAskKey
  resolveFn = resolve
  visible.value = true
}

function processNext() {
  const next = queue.shift()
  if (next) {
    showDialog(next.options, next.resolve)
  }
}

function onConfirm(dontAsk?: boolean) {
  visible.value = false
  if (dontAsk && dontAskKey.value) {
    localStorage.setItem(dontAskKey.value, 'true')
  }
  resolveFn?.(true)
  resolveFn = null
  processNext()
}

function onCancel() {
  visible.value = false
  resolveFn?.(false)
  resolveFn = null
  processNext()
}

provide(confirmKey, confirm)
</script>

<template>
  <slot />
  <ConfirmDialog
    v-model="visible"
    :title="title"
    :message="message"
    :variant="variant"
    :confirm-text="confirmText"
    :cancel-text="cancelText"
    :show-dont-ask="!!dontAskKey"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>
