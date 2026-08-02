<script setup lang="ts">
/**
 * DrawerTrigger — 顶栏上打开侧滑抽屉的按钮。
 *
 * 规格与 GeneratePage 的架构选择器触发器同底: --bg3 底、1px --bd 边框、
 * var(--rs) 圆角、6px/12px padding, hover 边框变亮。文字取次级色 (--t2),
 * hover 才升主色 —— 它在任何页面上都是辅助操作, 不与主操作抢视觉权重。
 *
 * badge 只表达"正在发生的事"的条数, 不表达静态存量: 常年非零的数字会让 badge
 * 永远亮着, 彻底失去提示价值 (所以生成页放队列数而非历史数, 模型页放进行中
 * 任务数而非收藏数)。
 *
 * alert 与计数正交, 表达"有需要你处理的失败": 有计数时把计数染红, 无计数时
 * 退化成一个红点 —— 失败任务本身不在"进行中"里, 但抽屉关着时必须能看见。
 */
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'DrawerTrigger' })

withDefaults(defineProps<{
  icon: string
  label: string
  /** 正在进行的条数; 0 或不传则不显示计数 */
  badge?: number
  /** 图标 pulse —— 有任务正在跑 */
  pulse?: boolean
  /** 有失败待处理 */
  alert?: boolean
  /** alert 的无障碍说明 (计数/红点的 title 与 aria-label) */
  alertText?: string
}>(), {
  badge: 0,
  pulse: false,
  alert: false,
  alertText: '',
})

defineEmits<{ click: [] }>()
</script>

<template>
  <button class="drawer-trigger" type="button" @click="$emit('click')">
    <MsIcon :name="icon" :class="{ 'drawer-trigger__icon--pulse': pulse }" />
    <span class="drawer-trigger__label">{{ label }}</span>
    <span
      v-if="badge > 0"
      class="drawer-trigger__badge"
      :class="{ 'drawer-trigger__badge--alert': alert }"
      :title="alert ? alertText : undefined"
    >{{ badge }}</span>
    <span
      v-else-if="alert"
      class="drawer-trigger__dot"
      role="status"
      :aria-label="alertText"
      :title="alertText"
    />
  </button>
</template>

<style scoped>
.drawer-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 12px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  color: var(--t2);  /* 次级文字色 —— 辅助操作 */
  font-size: var(--text-base);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
  flex-shrink: 0;
  position: relative;
}

.drawer-trigger:hover {
  border-color: var(--bd-f);
  color: var(--t1);
}

.drawer-trigger__label {
  white-space: nowrap;
}

/* badge: 进行中条数 (>0 显示, accent 底) */
.drawer-trigger__badge {
  background: var(--ac);
  color: #fff;
  font-size: .68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.drawer-trigger__badge--alert {
  background: var(--red);
}

/* 无计数时的失败红点 */
.drawer-trigger__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--red);
  flex-shrink: 0;
}

/* 执行中图标轻微 pulse (CSS, prefers-reduced-motion 降级静态) */
.drawer-trigger__icon--pulse {
  animation: drawer-trigger-pulse 1.6s ease-in-out infinite;
}
@keyframes drawer-trigger-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}
@media (prefers-reduced-motion: reduce) {
  .drawer-trigger__icon--pulse {
    animation: none;
  }
}
</style>
