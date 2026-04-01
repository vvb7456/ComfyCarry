<script lang="ts">
// Module-level singleton — shared across ALL BaseModal instances.
// Must be in a plain <script> block (not <script setup>) so that
// Vue compiler puts it outside the per-instance setup() function.
let bodyLockCount = 0
let previousBodyOverflow = ''
let modalIdCounter = 0

function lockBodyScroll() {
  if (bodyLockCount === 0) previousBodyOverflow = document.body.style.overflow
  bodyLockCount += 1
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  if (bodyLockCount === 0) return
  bodyLockCount -= 1
  if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow
}
</script>

<script setup lang="ts">
import { computed, watch, ref, nextTick, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  subtitle?: string
  icon?: string
  iconColor?: string
  ariaLabel?: string
  // Size
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  width?: string
  maxHeight?: string
  // Layout
  density?: 'compact' | 'default' | 'roomy'
  align?: 'center' | 'top'
  scroll?: 'content' | 'body' | 'none'
  // Close behavior
  closeOnOverlay?: boolean
  closeOnEsc?: boolean
  showClose?: boolean
  persistent?: boolean
  // Visual
  tone?: 'default' | 'info' | 'danger'
  footerAlign?: 'start' | 'end' | 'between'
}>(), {
  size: 'md',
  maxHeight: '90vh',
  density: 'default',
  align: 'center',
  scroll: 'content',
  closeOnOverlay: true,
  closeOnEsc: true,
  showClose: true,
  persistent: false,
  tone: 'default',
  footerAlign: 'end',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const boxRef = ref<HTMLElement | null>(null)
const hasBodyLock = ref(false)
const titleId = `base-modal-title-${++modalIdCounter}`

// Size presets
const sizeWidths: Record<string, string> = { sm: '360px', md: '520px', lg: '720px', xl: '900px', full: '95vw' }

const resolvedMaxWidth = computed(() => {
  if (props.width) return props.width
  return sizeWidths[props.size] || sizeWidths.md
})

const resolvedMaxHeight = computed(() => {
  if (props.size === 'full') return '95vh'
  return props.maxHeight
})

const canClose = computed(() => !props.persistent)
const canCloseOverlay = computed(() => canClose.value && props.closeOnOverlay)
const canCloseEsc = computed(() => canClose.value && props.closeOnEsc)

// Lock body scroll when modal is open
watch(() => props.modelValue, (open) => {
  if (open) {
    if (!hasBodyLock.value) {
      lockBodyScroll()
      hasBodyLock.value = true
    }
    nextTick(() => {
      boxRef.value?.focus()
    })
  } else if (hasBodyLock.value) {
    unlockBodyScroll()
    hasBodyLock.value = false
  }
})

// Ensure scroll lock is released on unmount
onUnmounted(() => {
  if (!hasBodyLock.value) return
  unlockBodyScroll()
  hasBodyLock.value = false
})

function close() {
  if (!canClose.value) return
  show.value = false
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget && canCloseOverlay.value) close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && canCloseEsc.value) {
    e.stopPropagation()
    close()
  }
}

// Footer alignment class
const footerClass = computed(() => {
  if (props.footerAlign === 'start') return 'modal-footer--start'
  if (props.footerAlign === 'between') return 'modal-footer--between'
  return ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show"
        class="modal-overlay"
        :class="{ 'modal-overlay--top': align === 'top' }"
        @click="onOverlayClick"
        @keydown="onKeydown"
        tabindex="-1"
      >
        <div
          ref="boxRef"
          class="modal-box"
          :class="[
            `modal-box--${density}`,
            `modal-box--tone-${tone}`,
            { 'modal-box--scroll-body': scroll === 'body', 'modal-box--scroll-none': scroll === 'none' },
          ]"
          :style="{ maxWidth: resolvedMaxWidth, maxHeight: resolvedMaxHeight }"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? titleId : undefined"
          :aria-label="!title ? ariaLabel : undefined"
        >
          <div v-if="title || $slots.header" class="modal-header">
            <slot name="header">
              <div class="modal-header__title-group">
                <MsIcon v-if="icon" :name="icon" :style="iconColor ? { color: iconColor } : undefined" />
                <div>
                  <h3 :id="title ? titleId : undefined" class="modal-title">{{ title }}</h3>
                  <p v-if="subtitle" class="modal-subtitle">{{ subtitle }}</p>
                </div>
              </div>
            </slot>
            <button v-if="showClose" class="modal-close" @click="close" :aria-label="t('common.btn.close')">
              <MsIcon name="close" />
            </button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer" :class="footerClass">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--sp-4);
  visibility: visible;
  opacity: 1;
}
.modal-overlay--top { align-items: flex-start; padding-top: 10vh; }

.modal-box {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  max-width: 520px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--sh);
  outline: none;
}

.modal-box--tone-default {}

.modal-box--tone-info {
  border-color: rgba(96, 165, 250, .38);
}

.modal-box--tone-info .modal-title {
  color: var(--ac);
}

.modal-box--tone-danger {
  border-color: rgba(239, 68, 68, .42);
}

.modal-box--tone-danger .modal-title {
  color: var(--red);
}

/* Scroll strategies */
.modal-box--scroll-body { overflow-y: auto; }
.modal-box--scroll-body > .modal-body { overflow: visible; }
.modal-box--scroll-none > .modal-body { overflow: hidden; }

/* Density: default */
.modal-box--default > .modal-header { padding: 20px 24px 0; }
.modal-box--default > .modal-body { padding: 16px 24px; }
.modal-box--default > .modal-footer { padding: 0 24px 20px; }

/* Density: compact */
.modal-box--compact > .modal-header { padding: 12px 16px 0; }
.modal-box--compact > .modal-body { padding: 12px 16px; }
.modal-box--compact > .modal-footer { padding: 0 16px 12px; }

/* Density: roomy */
.modal-box--roomy > .modal-header { padding: clamp(20px, 2vw, 28px) clamp(24px, 2.2vw, 32px) 0; }
.modal-box--roomy > .modal-body { padding: clamp(16px, 1.5vw, 24px) clamp(24px, 2.2vw, 32px); }
.modal-box--roomy > .modal-footer { padding: 0 clamp(24px, 2.2vw, 32px) clamp(16px, 1.5vw, 24px); }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 0;
  gap: var(--sp-2);
}

.modal-header__title-group {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.modal-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
}

.modal-subtitle {
  font-size: .78rem;
  color: var(--t3);
  margin: 2px 0 0;
}

.modal-close {
  background: none;
  border: none;
  color: var(--t3);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--rs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.modal-close:hover { color: var(--t1); background: var(--bg3); }

.modal-body {
  padding: 12px 16px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 0 16px 12px;
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.modal-footer--start { justify-content: flex-start; }
.modal-footer--between { justify-content: space-between; }

/* Transitions */
.modal-enter-active, .modal-leave-active { transition: opacity .2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .modal-box, .modal-leave-active .modal-box { transition: transform .2s ease; }
.modal-enter-from .modal-box { transform: scale(.95); }
.modal-leave-to .modal-box { transform: scale(.95); }

@media (max-width: 768px) {
  .modal-box {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
  .modal-overlay { padding: 0; }
}
</style>
