<script lang="ts">
// Module-level singleton — shared across ALL BaseModal instances.
// Must be in a plain <script> block (not <script setup>) so that
// Vue compiler puts it outside the per-instance setup() function.
let bodyLockCount = 0
let previousBodyOverflow = ''
let modalIdCounter = 0

export function lockBodyScroll() {
  if (bodyLockCount === 0) previousBodyOverflow = document.body.style.overflow
  bodyLockCount += 1
  document.body.style.overflow = 'hidden'
}

export function unlockBodyScroll() {
  if (bodyLockCount === 0) return
  bodyLockCount -= 1
  if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow
}
</script>

<script setup lang="ts">
import { computed, watch, ref, nextTick, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'
import { useModalFocus, queryFocusable } from './useModalFocus'
import type { IconName } from '@/config/icon-codepoints'

defineOptions({ name: 'BaseModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  subtitle?: string
  icon?: IconName
  iconColor?: string
  ariaLabel?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'full'
  width?: string
  maxHeight?: string
  density?: 'compact' | 'default' | 'roomy'
  align?: 'center' | 'top'
  scroll?: 'content' | 'body' | 'none'
  closeOnOverlay?: boolean
  closeOnEsc?: boolean
  showClose?: boolean
  persistent?: boolean
  tone?: 'default' | 'info' | 'danger'
  footerAlign?: 'start' | 'end' | 'between'
  /** Override z-index of the modal overlay (default: 1000) */
  zIndex?: number
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
const { captureTrigger, restoreTrigger, trapTab } = useModalFocus()

const sizeWidths: Record<string, string> = { sm: '360px', md: '520px', lg: '720px', xl: '900px', xxl: '1400px', full: '95vw' }

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

watch(() => props.modelValue, (open) => {
  if (open) {
    if (!hasBodyLock.value) {
      lockBodyScroll()
      hasBodyLock.value = true
    }
    captureTrigger()
    nextTick(() => {
      // 首个可操作元素优先, 纯展示弹窗焦点停在容器本身
      const target = boxRef.value ? queryFocusable(boxRef.value)[0] : undefined
      if (target) target.focus()
      else boxRef.value?.focus()
    })
  } else if (hasBodyLock.value) {
    unlockBodyScroll()
    hasBodyLock.value = false
    restoreTrigger()
  }
})

onUnmounted(() => {
  if (!hasBodyLock.value) return
  unlockBodyScroll()
  hasBodyLock.value = false
})

function close() {
  if (!canClose.value) return
  show.value = false
}

// Track mousedown origin to prevent drag-close
const mouseDownOnOverlay = ref(false)

function onOverlayMousedown(e: MouseEvent) {
  mouseDownOnOverlay.value = e.target === e.currentTarget
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget && mouseDownOnOverlay.value && canCloseOverlay.value) close()
  mouseDownOnOverlay.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && canCloseEsc.value) {
    e.stopPropagation()
    close()
    return
  }
  // Tab 圈定: 焦点在弹窗内 (含容器本身) 时循环; 在外部浮层时不干预
  if (e.key === 'Tab' && boxRef.value) {
    const active = document.activeElement
    if (active === boxRef.value || boxRef.value.contains(active)) {
      trapTab(e, boxRef.value)
    }
  }
}

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
        :class="{
          'modal-overlay--top': align === 'top',
          'modal-overlay--edge-to-edge': ['lg', 'xl', 'xxl', 'full'].includes(size),
        }"
        :style="props.zIndex ? { zIndex: props.zIndex } : undefined"
        @mousedown="onOverlayMousedown"
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
          :style="{ '--modal-max-width': resolvedMaxWidth, '--modal-max-height': resolvedMaxHeight }"
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
                  <h3 :id="title ? titleId : undefined" class="modal-title">
                    {{ title }}
                    <!-- 标题后的附属元素 (HelpTip 等)。不用 #header 整体覆盖 ——
                         插槽内容带的是父组件的 scope 标记, 拿不到这里的
                         .modal-title / .modal-subtitle 等 scoped 样式。 -->
                    <slot name="title-extra" />
                  </h3>
                  <p v-if="subtitle" class="modal-subtitle">{{ subtitle }}</p>
                </div>
              </div>
            </slot>
            <button type="button" v-if="showClose" class="modal-close" @click="close" :aria-label="t('common.btn.close')" :title="t('common.btn.close')">
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
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--sp-4);
  overflow-y: auto;
  visibility: visible;
  opacity: 1;
}
.modal-overlay--top { align-items: flex-start; padding-top: 10vh; }

.modal-box {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  width: 100%;
  /* Keep the requested preset/custom limit in a CSS variable so narrow-screen
     rules can cap it without being defeated by an inline max-width/max-height. */
  max-width: var(--modal-max-width, 520px);
  max-height: min(var(--modal-max-height, 85vh), calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  box-shadow: var(--sh);
  outline: none;
}

.modal-box--tone-default {}

.modal-box--tone-info {
  border-color: color-mix(in srgb, var(--blue) 38%, transparent);
}

.modal-box--tone-info .modal-title {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  color: var(--ac);
}

.modal-box--tone-danger {
  border-color: color-mix(in srgb, var(--red) 42%, transparent);
}

.modal-box--tone-danger .modal-title {
  color: var(--red);
}

.modal-box--scroll-body { overflow-y: auto; }
.modal-box--scroll-body > .modal-body { overflow: visible; }
.modal-box--scroll-none > .modal-body { overflow: hidden; }

.modal-box--default > .modal-header { padding: 20px 24px 0; }
.modal-box--default > .modal-body { padding: 16px 24px; }
.modal-box--default > .modal-footer { padding: 0 24px 20px; }

.modal-box--compact > .modal-header { padding: 12px 16px 0; }
.modal-box--compact > .modal-body { padding: 12px 16px; }
.modal-box--compact > .modal-footer { padding: 0 16px 12px; }

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
  line-height: 1.35;
  overflow-wrap: anywhere;
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
  min-width: 0;
}

.modal-footer {
  padding: 0 16px 12px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--sp-2);
  min-width: 0;
}
.modal-footer > * { min-width: 0; }
.modal-footer--start { justify-content: flex-start; }
.modal-footer--between { justify-content: space-between; }

.modal-enter-active, .modal-leave-active { transition: opacity .2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .modal-box, .modal-leave-active .modal-box { transition: transform .2s ease; }
.modal-enter-from .modal-box { transform: scale(.95); }
.modal-leave-to .modal-box { transform: scale(.95); }

@media (max-width: 768px) {
  .modal-overlay {
    padding: 16px;
  }

  .modal-box {
    max-width: min(var(--modal-max-width, 520px), calc(100vw - 32px));
    max-height: min(var(--modal-max-height, 85vh), calc(100vh - 32px));
    border-radius: var(--r);
  }

  .modal-overlay--edge-to-edge {
    padding: 0;
    align-items: stretch;
  }

  .modal-overlay--edge-to-edge .modal-box {
    width: 100%;
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .modal-footer {
    row-gap: 8px;
  }
}

@supports (height: 100dvh) {
  .modal-box {
    max-height: min(var(--modal-max-height, 85vh), calc(100dvh - 32px));
  }

  @media (max-width: 768px) {
    .modal-overlay--edge-to-edge .modal-box {
      max-height: 100dvh;
    }
  }
}
</style>
