<script setup lang="ts">
import { computed } from 'vue'
import { ICON_CODEPOINTS } from '@/config/icon-codepoints'

defineOptions({ name: 'MsIcon' })

const props = defineProps<{
  /** Material Symbols icon name */
  name: string
  /** Size variant: xxs(12) | xs(16) | sm(18, default) | md(20) | lg(32) | xl(48) */
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** 着色。默认继承父级文字色; 仅在表达状态时显式传入语义色变量 */
  color?: string
}>()

/**
 * 图标默认不着色 —— 继承父级文字色。
 *
 * 旧实现有一张 icon name → color 的全局映射表 (73 个硬编码 hex), 任何图标
 * 不传 color 就按名字自动上色。后果是一屏 7~8 种色相, 语义色被稀释:
 * 当 `add` 也是绿的、`search` 也是蓝的, "绿=正常/红=异常" 就失去了指示作用。
 *
 * 现在颜色只用于表达状态, 且必须由调用方显式传入 —— 通常传语义变量
 * (var(--green)/var(--amber)/var(--red)/var(--blue)), 其余一律继承。
 */

const sizeClass = computed(() => {
  if (!props.size || props.size === 'sm') return 'ms-sm'
  if (props.size === 'md') return ''
  return `ms-${props.size}`
})

const iconChar = computed(() => ICON_CODEPOINTS[props.name] || props.name)

const iconStyle = computed(() => {
  // 'none' 保留为显式"继承"写法 (与默认行为一致, 兼容既有调用点)
  if (!props.color || props.color === 'none') return undefined
  return { color: props.color }
})
</script>

<template>
  <span class="ms" :class="sizeClass" :style="iconStyle">{{ iconChar }}</span>
</template>
