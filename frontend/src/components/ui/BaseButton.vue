<script setup lang="ts">
import { computed } from 'vue'
import Spinner from './Spinner.vue'

defineOptions({ name: 'BaseButton' })

type ButtonVariant = 'default' | 'primary' | 'danger' | 'success' | 'ghost'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  square?: boolean
  href?: string
  target?: string
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
}>(), {
  variant: 'default',
  size: 'md',
  type: 'button',
})

const emit = defineEmits<{ click: [e: MouseEvent] }>()

const tag = computed(() => props.href ? 'a' : 'button')
const isDisabled = computed(() => props.disabled || props.loading)

function onClick(e: MouseEvent) {
  if (isDisabled.value) {
    e.preventDefault()
    return
  }
  emit('click', e)
}
</script>

<template>
  <component
    :is="tag"
    :class="[
      'base-btn',
      `base-btn--${variant}`,
      `base-btn--${size}`,
      {
        'base-btn--square': square,
        'base-btn--loading': loading,
        'base-btn--disabled': isDisabled,
      },
    ]"
    :disabled="(!href && isDisabled) || undefined"
    :type="!href ? type : undefined"
    :href="href || undefined"
    :target="href ? target : undefined"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    :aria-disabled="(href && isDisabled) || undefined"
    :tabindex="href && isDisabled ? -1 : undefined"
    @click="onClick"
  >
    <span v-if="loading" class="base-btn__spinner-wrap">
      <Spinner size="sm" />
    </span>
    <span class="base-btn__content" :class="{ 'base-btn__content--hidden': loading }">
      <slot />
    </span>
  </component>
</template>

<style scoped>
.base-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  box-sizing: border-box;
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  background: var(--bg3);
  color: var(--t1);
  font-family: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
  transition: background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;
  -webkit-appearance: none;
  appearance: none;
}

/* ── Sizes ── */
.base-btn--xs  { padding: var(--btn-py-xs, 2px) var(--btn-px-xs, 8px);   font-size: var(--btn-font-xs, var(--text-xs)); gap: 3px; }
.base-btn--sm  { padding: var(--btn-py-sm, 4px) var(--btn-px-sm, 10px);  font-size: var(--btn-font-sm, .78rem); }
.base-btn--md  { padding: var(--btn-py-md, 7px) var(--btn-px-md, 14px);  font-size: var(--btn-font-md, .82rem); }
.base-btn--lg  { padding: var(--btn-py-lg, 10px) var(--btn-px-lg, 20px); font-size: var(--btn-font-lg, var(--text-md)); }

/* ── Square (icon-only) ── */
.base-btn--square.base-btn--xs { padding: 2px;  }
.base-btn--square.base-btn--sm { padding: 4px;  }
.base-btn--square.base-btn--md { padding: 6px;  }
.base-btn--square.base-btn--lg { padding: 8px;  }

/* ── Variant: default ── */
.base-btn--default:hover:not(.base-btn--disabled) {
  border-color: var(--bd-f);
  background: var(--bg4);
}

/* ── Variant: primary ── */
.base-btn--primary {
  background: var(--ac);
  border-color: var(--ac);
  color: #fff;
}
.base-btn--primary:hover:not(.base-btn--disabled) {
  background: var(--ac2);
}

/* ── Variant: danger ── */
.base-btn--danger {
  background: transparent;
  border-color: rgba(248, 113, 113, .3);
  color: var(--red);
}
.base-btn--danger:hover:not(.base-btn--disabled) {
  background: rgba(248, 113, 113, .1);
}

/* ── Variant: success ── */
.base-btn--success {
  background: transparent;
  border-color: rgba(74, 222, 128, .3);
  color: var(--green);
}
.base-btn--success:hover:not(.base-btn--disabled) {
  background: rgba(74, 222, 128, .1);
}

/* ── Variant: ghost ── */
.base-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--t2);
}
.base-btn--ghost:hover:not(.base-btn--disabled) {
  background: var(--bg4);
  color: var(--t1);
}

/* ── Disabled ── */
.base-btn--disabled {
  opacity: .4;
  cursor: not-allowed;
}

/* ── Focus ── */
.base-btn:focus-visible {
  outline: 2px solid var(--ac);
  outline-offset: 2px;
}

/* ── Loading ── */
.base-btn__spinner-wrap {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.base-btn__content {
  display: inline-flex;
  align-items: center;
  gap: inherit;
}

.base-btn__content--hidden {
  visibility: hidden;
}
</style>
