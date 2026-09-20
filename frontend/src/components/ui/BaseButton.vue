<script setup lang="ts">
/**
 * BaseButton — 全站按钮基类。
 *
 * 行内纯图标按钮的标准用法（对象行 / 分页 / 工具条 / 卡片操作）：
 *   <BaseButton variant="ghost" size="sm" icon-only aria-label="停止">
 *     <MsIcon name="stop" />
 *   </BaseButton>
 * 纯图标按钮与同级文本按钮严格等高（sm: 28px, md: 34px, xs: 22px, lg: 42px），呈紧凑正方形，
 * 避免混排时高低错落或撑高父容器。尺寸集中在组件内按 `size` 分级，调用方无需手写尺寸覆盖。
 * （注：icon-only 强绑定对应档位的标准基准高度 `--btn-h`。若调用方通过 `--btn-py-*` 局部抬高文本按钮高度，同级若有 icon-only 混排需留意可能产生的高度差）
 * icon-only 时 title 缺省取 ariaLabel，纯图标按钮无需再手写 :title。
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
  /** 纯图标按钮形态（与同级文本按钮等高正方形），标准用法见组件头注释 */
  iconOnly?: boolean
  href?: string
  target?: string
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
  /** hover 提示；icon-only 且未传时自动取 ariaLabel，保证纯图标按钮始终有 hover 文本 */
  title?: string
}>(), {
  variant: 'default',
  size: 'md',
  type: 'button',
})

const emit = defineEmits<{ click: [e: MouseEvent] }>()

const tag = computed(() => props.href ? 'a' : 'button')
const isDisabled = computed(() => props.disabled || props.loading)
const hoverTitle = computed(() => props.title ?? (props.iconOnly ? props.ariaLabel : undefined))

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
    :title="hoverTitle"
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

/* ── Sizes (高度基准与常规内边距) ── */
.base-btn--xs  {
  --btn-h: 22px;
  min-height: var(--btn-h);
  padding: var(--btn-py-xs, 2px) var(--btn-px-xs, 8px);
  font-size: var(--btn-font-xs, var(--text-xs));
  gap: 3px;
}
.base-btn--sm  {
  --btn-h: 28px;
  min-height: var(--btn-h);
  padding: var(--btn-py-sm, 4px) var(--btn-px-sm, 10px);
  font-size: var(--btn-font-sm, .78rem);
}
.base-btn--md  {
  --btn-h: 34px;
  min-height: var(--btn-h);
  padding: var(--btn-py-md, 7px) var(--btn-px-md, 14px);
  font-size: var(--btn-font-md, .82rem);
}
.base-btn--lg  {
  --btn-h: 42px;
  min-height: var(--btn-h);
  padding: var(--btn-py-lg, 10px) var(--btn-px-lg, 20px);
  font-size: var(--btn-font-lg, var(--text-md));
}

/* ── Icon only（纯图标按钮：与同级文本按钮严格等高，呈紧凑正方形）──
   高度与最小宽度继承 --btn-h，与文本按钮像素级对齐，避免混排撑高或高矮不齐。
   触屏通过扩展可点击区域（::after）满足大点击域，绝不放大视觉盒模型破坏布局。 */
.base-btn--icon-only {
  gap: 0;
  padding: 0;
  min-height: var(--btn-h, 34px);
  height: var(--btn-h, 34px);
  min-width: var(--btn-h, 34px);
  width: var(--btn-h, 34px);
  flex-shrink: 0;
}

.base-btn--xs.base-btn--icon-only :deep(.ms) {
  font-size: 14px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 14;
}

.base-btn--sm.base-btn--icon-only :deep(.ms) {
  font-size: 18px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18;
}

.base-btn--md.base-btn--icon-only :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}

.base-btn--lg.base-btn--icon-only :deep(.ms) {
  font-size: 24px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
}

@media (pointer: coarse) {
  .base-btn--icon-only::after {
    content: '';
    position: absolute;
    /* 仅纵向扩展点击域（避免横向与相邻 4px gap 按钮命中区互相重叠） */
    inset: -6px 0;
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
