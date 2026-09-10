<script setup lang="ts">
/**
 * BaseButton — 全站按钮基类。
 *
 * 行内纯图标按钮的标准用法（对象行 / 分页 / 工具条）：
 *   <BaseButton variant="ghost" size="sm" icon-only aria-label="停止">
 *     <MsIcon name="stop" />
 *   </BaseButton>
 * 长方形约 42×32（左右 padding 10 + 20px 图标），触屏 44 高。
 * 尺寸集中在 `iconOnly` 内实现，调用方不要再用 :deep 覆盖。
 * 旧的 `square`（正方形）保留给尚未收敛的调用点，两者并存，iconOnly 是新标准。
 */
import { computed } from 'vue'
import Spinner from './Spinner.vue'

defineOptions({ name: 'BaseButton' })

type ButtonVariant = 'default' | 'primary' | 'danger' | 'success' | 'warning' | 'ghost'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  square?: boolean
  /** 标准行内纯图标按钮形态（长方形，约 42×32；触屏 44 高），标准用法见组件头注释 */
  iconOnly?: boolean
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
        'base-btn--icon-only': iconOnly,
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

/* ── Square (icon-only, 旧用法) ── */
.base-btn--square.base-btn--xs { padding: 2px;  }
.base-btn--square.base-btn--sm { padding: 4px;  }
.base-btn--square.base-btn--md { padding: 6px;  }
.base-btn--square.base-btn--lg { padding: 8px;  }

/* ── Icon only（标准行内纯图标按钮，新用法）──
   长方形而不是正方形：1px 边框 + 左右各 10px + 20px 图标 ≈ 42×32。
   尺寸与图标规格集中在这里，行 / 页调用方只传 `size="sm" icon-only variant="ghost"`。
   触屏只加高命中区（44px），图标不放大。 */
.base-btn--icon-only {
  gap: 0;
  min-width: 42px;
  min-height: 32px;
  padding: 0 10px;
}

.base-btn--icon-only :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}

@media (pointer: coarse) {
  .base-btn--icon-only {
    min-height: 44px;
  }
}

/* ── Variant: default ── */
.base-btn--default:hover:not(.base-btn--disabled) {
  border-color: var(--bd-f);
  background: var(--bg4);
}

/* ── Variant: primary ── */
.base-btn--primary {
  background: color-mix(in srgb, var(--ac) 65%, var(--bg3));
  border-color: color-mix(in srgb, var(--ac) 65%, var(--bg3));
  color: #fff;
}
.base-btn--primary:hover:not(.base-btn--disabled) {
  background: color-mix(in srgb, var(--ac) 80%, var(--bg3));
}

/* ── Variant: danger ── */
.base-btn--danger {
  background: transparent;
  border-color: color-mix(in srgb, var(--red) 30%, transparent);
  color: color-mix(in srgb, var(--red) 70%, var(--t2));
}
.base-btn--danger:hover:not(.base-btn--disabled) {
  background: color-mix(in srgb, var(--red) 10%, transparent);
}

/* ── Variant: success ── */
.base-btn--success {
  background: transparent;
  border-color: color-mix(in srgb, var(--green) 30%, transparent);
  color: color-mix(in srgb, var(--green) 70%, var(--t2));
}
.base-btn--success:hover:not(.base-btn--disabled) {
  background: color-mix(in srgb, var(--green) 10%, transparent);
}

/* ── Variant: warning ── */
.base-btn--warning {
  background: transparent;
  border-color: color-mix(in srgb, var(--amber) 30%, transparent);
  color: color-mix(in srgb, var(--amber) 70%, var(--t2));
}
.base-btn--warning:hover:not(.base-btn--disabled) {
  background: color-mix(in srgb, var(--amber) 10%, transparent);
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
