<script setup lang="ts">
/**
 * Badge — 全站唯一的标签实现。
 *
 * 两种用法, 不要混:
 *   - `tone`  语义状态 (正常/注意/异常/中性), 走语义色变量, 可带状态圆点
 *   - `color` 分类标签 (模型类型/底模等), 传显式色值, 背景自动 15%
 *
 * Usage:
 *   <Badge tone="positive" dot>运行中</Badge>
 *   <Badge color="#f472b6">CHECKPOINTS</Badge>
 *   <Badge>Illustrious</Badge>
 */
import { computed } from 'vue'

defineOptions({ name: 'Badge' })

const props = defineProps<{
  color?: string
  tone?: 'positive' | 'caution' | 'negative' | 'neutral'
  /** 前置状态圆点 — 仅在配合 tone 表达状态时使用 */
  dot?: boolean
}>()

// 必须是 computed: 原实现写在模板 :style 里, 每次渲染都会重算; 提到 setup 顶层
// 做成常量的话 props.color 只在挂载时读一次, 父组件动态换色就不再更新。
const inlineStyle = computed(() =>
  props.color && !props.tone
    ? { color: props.color, background: `color-mix(in srgb, ${props.color} 15%, transparent)` }
    : undefined,
)
</script>

<template>
  <span
    class="badge"
    :class="[
      tone ? `badge--${tone}` : null,
      !tone && !color ? 'badge--muted' : null,
    ]"
    :style="inlineStyle"
  >
    <i v-if="dot" class="badge__dot" />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: .75rem;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
  line-height: 1.5;
}
.badge--muted {
  background: rgba(100, 116, 139, .15);
  color: var(--t2);
}

/* ── 语义状态 ── */
.badge--positive {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 14%, transparent);
}

.badge--caution {
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}

.badge--negative {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 14%, transparent);
}

.badge--neutral {
  color: var(--t2);
  background: var(--bg3);
  border: 1px solid var(--bd);
}

.badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
</style>
