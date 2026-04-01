<script setup lang="ts">
import { ref, provide } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { confirmKey, type ConfirmOptions } from '@/composables/useConfirm'

const visible = ref(false)
const title = ref<string | undefined>()
const message = ref('')
const variant = ref<'default' | 'danger'>('default')
const confirmText = ref<string | undefined>()
const cancelText = ref<string | undefined>()

interface QueueItem {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

const queue: QueueItem[] = []
let resolveFn: ((value: boolean) => void) | null = null

function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (visible.value) {
      // Queue if a dialog is already open
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
  resolveFn = resolve
  visible.value = true
}

function processNext() {
  const next = queue.shift()
  if (next) {
    showDialog(next.options, next.resolve)
  }
}

function onConfirm() {
  visible.value = false
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
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>
