<script setup lang="ts">
/**
 * SegmentedControl — 少量互斥选项的分段单选 (2-4 项)。
 *
 * 与 ChipSelect (搜索/筛选的流式多选 chip) 场景不同:
 * 一体化滑轨内嵌分段, 点选即平滑滑动切换, 活动段填充高亮, 不可取消为空。
 * 用于模式/引擎类切换 (如 Upscale 的 AuraSR/SeedVR2、生成页文/图生视频切换)。
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import MsIcon from './MsIcon.vue'
import type { IconName } from '@/config/icon-codepoints'

defineOptions({ name: 'SegmentedControl' })

export interface SegmentOption {
  value: string
  label: string
  /** 选项图标 (MsIcon name, 可选) */
  icon?: IconName
  /** 单选项禁用 (如未上线的占位选项) */
  disabled?: boolean
  /** 未保存状态小圆点 (纯展示, TabItem.dot 同构) */
  dot?: boolean
}

const props = withDefaults(defineProps<{
  options: SegmentOption[]
  modelValue: string
  disabled?: boolean
  /** 占满容器宽度, 各分段均分 */
  block?: boolean
  /** sm = 面板内模式开关 (28px, 默认); md = 页面级主控件 (34px, 与按钮对齐) */
  size?: 'sm' | 'md'
}>(), {
  size: 'sm',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const btnRefs = ref<HTMLButtonElement[]>([])
const indicatorStyle = ref<Record<string, string>>({
  opacity: '0',
})

function updateIndicator() {
  const activeIdx = props.options.findIndex(o => o.value === props.modelValue)
  if (activeIdx === -1 || !btnRefs.value[activeIdx] || !rootRef.value) {
    indicatorStyle.value = { opacity: '0' }
    return
  }
  const el = btnRefs.value[activeIdx]
  indicatorStyle.value = {
    transform: `translate3d(${el.offsetLeft}px, ${el.offsetTop}px, 0)`,
    width: `${el.offsetWidth}px`,
    height: `${el.offsetHeight}px`,
    opacity: '1',
  }
}

watch(
  () => [props.modelValue, props.options],
  () => {
    nextTick(updateIndicator)
  },
  { deep: true },
)

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    updateIndicator()
    if (rootRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateIndicator()
      })
      resizeObserver.observe(rootRef.value)
    }
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="rootRef"
    class="seg-control"
    :class="{
      'seg-control--disabled': disabled,
      'seg-control--block': block,
      'seg-control--md': size === 'md',
      'seg-control--sm': size === 'sm',
    }"
    role="radiogroup"
  >
    <!-- 动态平滑滑块 -->
    <div
      class="seg-control__indicator"
      :style="indicatorStyle"
      aria-hidden="true"
    />

    <button
      v-for="(opt, idx) in options"
      :key="opt.value"
      :ref="el => { if (el) btnRefs[idx] = el as HTMLButtonElement }"
      type="button"
      class="seg-control__item"
      :class="{ active: opt.value === modelValue, 'seg-control__item--disabled': opt.disabled }"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :disabled="disabled || opt.disabled"
      @click="!opt.disabled && opt.value !== modelValue && emit('update:modelValue', opt.value)"
    >
      <MsIcon v-if="opt.icon" :name="opt.icon" size="sm" color="none" class="seg-control__icon" />
      <span>{{ opt.label }}</span>
      <span v-if="opt.dot" class="seg-control__dot" aria-label="unsaved" />
    </button>
  </div>
</template>

<style scoped>
.seg-control {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 2px;
  gap: 2px;
  background: var(--bg4);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
}

.seg-control--sm {
  height: 28px;
}

.seg-control--md {
  height: 34px;
}

/* 动态滑动指示器 */
.seg-control__indicator {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: calc(var(--rs) - 3px);
  background: color-mix(in srgb, var(--ac) 65%, var(--bg3));
  box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
  transition: transform .22s cubic-bezier(0.25, 1, 0.5, 1),
              width .22s cubic-bezier(0.25, 1, 0.5, 1),
              opacity .15s ease;
  pointer-events: none;
  z-index: 0;
}

@media (prefers-reduced-motion: reduce) {
  .seg-control__indicator {
    transition: opacity .15s ease;
  }
}

.seg-control__item {
  border: none;
  background: transparent;
  color: var(--t2);
  font-size: var(--text-xs);
  line-height: 1;
  padding: 3px 10px;
  border-radius: calc(var(--rs) - 3px);
  cursor: pointer;
  transition: color .18s ease;
  user-select: none;
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  box-sizing: border-box;
  font-family: inherit;
  white-space: nowrap;
}

.seg-control__item:hover:not(.active):not(:disabled) {
  color: var(--t1);
}

.seg-control__item.active {
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
  font-size: 15px;
  margin-right: 4px;
}

/* 未保存状态小圆点 */
.seg-control__dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: var(--c-caution, #e8a33d);
  margin-left: 2px;
}

/* md 档: 页面级主控件 (如生成工作台任务切换) */
.seg-control--md .seg-control__item {
  gap: 6px;
  font-size: var(--text-base);
  padding: 4px 14px;
}

.seg-control--md .seg-control__icon {
  font-size: 16px;
  margin-right: 0;
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
