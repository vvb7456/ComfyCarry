<script setup lang="ts">
/**
 * SegmentedControl — 少量互斥选项的分段单选 (2-4 项)。
 *
 * 与 ChipSelect (搜索/筛选的流式多选 chip) 场景不同:
 * 一体化滑轨内嵌分段, 点选即切换, 活动段填充高亮, 不可取消为空。
 * 用于模式/引擎类切换 (如 Upscale 的 AuraSR/SeedVR2)。
 */
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'SegmentedControl' })

export interface SegmentOption {
  value: string
  label: string
  /** 选项图标 (MsIcon name, 可选) */
  icon?: string
  /** 单选项禁用 (如未上线的占位选项) */
  disabled?: boolean
}

withDefaults(defineProps<{
  options: SegmentOption[]
  modelValue: string
  disabled?: boolean
  /** 占满容器宽度, 各分段均分 */
  block?: boolean
  /** sm = 面板内模式开关 (默认); md = 页面级主控件 (更大字号/内边距) */
  size?: 'sm' | 'md'
}>(), {
  size: 'sm',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div
    class="seg-control"
    :class="{ 'seg-control--disabled': disabled, 'seg-control--block': block, 'seg-control--md': size === 'md' }"
    role="radiogroup"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="seg-control__item"
      :class="{ active: opt.value === modelValue, 'seg-control__item--disabled': opt.disabled }"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :disabled="disabled || opt.disabled"
      @click="!opt.disabled && opt.value !== modelValue && emit('update:modelValue', opt.value)"
    ><MsIcon v-if="opt.icon" :name="opt.icon" size="sm" color="none" class="seg-control__icon" />{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.seg-control {
  display: inline-flex;
  align-self: flex-start;
  padding: 2px;
  gap: 2px;
  background: var(--bg4);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
}

.seg-control__item {
  border: none;
  background: transparent;
  color: var(--t2);
  font-size: var(--text-xs);
  line-height: 1;
  padding: 6px 14px;
  border-radius: calc(var(--rs) - 3px);
  cursor: pointer;
  transition: background .15s, color .15s;
  user-select: none;
}

.seg-control__item:hover:not(.active) {
  color: var(--t1);
}

.seg-control__item.active {
  background: color-mix(in srgb, var(--ac) 65%, var(--bg3));
  color: #fff;
  font-weight: 500;
  cursor: default;
}

.seg-control__item:focus-visible {
  outline: 2px solid var(--ac);
  outline-offset: 1px;
}

.seg-control--disabled {
  opacity: .5;
  pointer-events: none;
}

.seg-control__item--disabled {
  opacity: .45;
  cursor: not-allowed;
}

.seg-control__icon {
  font-size: 16px;
}

/* md 档: 页面级主控件 (如生成工作台任务切换) */
.seg-control--md .seg-control__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-base);
  padding: 7px 16px;
}

.seg-control--md .seg-control__icon {
  font-size: 18px;
}

.seg-control--block {
  display: flex;
  align-self: stretch;
  width: 100%;
}

.seg-control--block .seg-control__item {
  flex: 1;
  text-align: center;
}
</style>
