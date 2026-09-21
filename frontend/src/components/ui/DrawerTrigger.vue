<script setup lang="ts">
/**
 * badge 只表达"正在发生的事"的条数, 不表达静态存量: 常年非零的数字会让 badge
 * 永远亮着, 彻底失去提示价值 (所以生成页放队列数而非历史数, 模型页放进行中
 * 任务数而非收藏数)。
 *
 * alert 与计数正交, 表达"有需要你处理的失败": 有计数时把计数染红, 无计数时
 * 退化成一个红点 —— 失败任务本身不在"进行中"里, 但抽屉关着时必须能看见。
 */
import MsIcon from './MsIcon.vue'
import type { IconName } from '@/config/icon-codepoints'

defineOptions({ name: 'DrawerTrigger' })

withDefaults(defineProps<{
  icon: IconName
  label: string
  badge?: number
  pulse?: boolean
  alert?: boolean
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
  padding: 0 12px;
  height: 34px;
  box-sizing: border-box;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  color: var(--t2);
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

.drawer-trigger__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--red);
  flex-shrink: 0;
}

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
