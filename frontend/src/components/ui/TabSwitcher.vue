<script setup lang="ts">
import { computed } from 'vue'
import MsIcon from './MsIcon.vue'
import { useAppStore } from '@/stores/app'

defineOptions({ name: 'TabSwitcher' })

const app = useAppStore()

export interface TabItem {
  key: string
  label: string
  icon?: string
  iconColor?: string
  badge?: string | number
  disabled?: boolean
  /** 未保存状态小圆点 (设置页分区导航用), 纯展示 */
  dot?: boolean
  /** Push this tab to the right side (adds auto margin spacer before the first right-aligned tab) */
  align?: 'right'
}

const props = withDefaults(defineProps<{
  tabs: TabItem[]
  modelValue: string
  title?: string
  /** 页面级 tab 默认吸附在 .content 滚动容器顶部; modal 内部的 tab 传 false */
  sticky?: boolean
}>(), {
  sticky: true,
})

const emit = defineEmits<{
  'update:modelValue': [key: string]
}>()

const firstRightIndex = computed(() =>
  props.tabs.findIndex(t => t.align === 'right'),
)

function selectTab(tab: TabItem) {
  if (tab.disabled || props.modelValue === tab.key) return
  emit('update:modelValue', tab.key)
}
</script>

<template>
  <div
    class="tab-switcher"
    :class="{ 'tab-switcher--sticky': props.sticky }"
    role="tablist"
  >
    <div v-if="title || $slots['title-extra']" class="tab-switcher__title-group">
      <div class="tab-switcher__title-wrap">
        <button
          type="button"
          class="mobile-menu-btn"
          :aria-label="app.mobileSidebarOpen ? 'Close menu' : 'Open menu'"
          @click="app.toggleMobileSidebar()"
        >
          <MsIcon name="menu" />
        </button>
        <h1 v-if="title" class="tab-switcher__title">{{ title }}</h1>
        <slot name="title-extra" />
      </div>
      <span class="tab-switcher__title-divider" aria-hidden="true" />
    </div>

    <div class="tab-switcher__tabs">
      <button
        v-for="(tab, idx) in tabs"
        :key="tab.key"
        type="button"
        class="tab-switcher__tab"
        :class="{
          'tab-switcher__tab--active': modelValue === tab.key,
          'tab-switcher__tab--disabled': tab.disabled,
          'tab-switcher__tab--right-first': idx === firstRightIndex,
        }"
        :disabled="tab.disabled"
        :aria-selected="modelValue === tab.key"
        @click="selectTab(tab)"
      >
        <MsIcon
          v-if="tab.icon"
          :name="tab.icon"
          size="sm"
        />
        <span>{{ tab.label }}</span>
        <span v-if="tab.badge" class="tab-switcher__badge">{{ tab.badge }}</span>
        <span v-if="tab.dot" class="tab-switcher__dot" aria-label="unsaved" />
      </button>
    </div>

    <div v-if="$slots.extra || $slots.default" class="tab-switcher__extra">
      <slot name="extra" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.tab-switcher {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--sp-4);
  overflow-x: auto;
  scrollbar-width: none;
  touch-action: pan-x;
  min-height: 38px;
}

.tab-switcher--sticky {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg-ambient);
  background-attachment: fixed;
  margin-top: calc(-1 * var(--page-body-pt));
  padding-top: var(--page-body-pt);
  padding-bottom: 8px;
  /* 底部向下的柔和渐变消隐蒙版：使得穿过的下方内容自然淡出消失 */
  mask-image: linear-gradient(to bottom, black calc(100% - 10px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 10px), transparent 100%);
}

.tab-switcher__title-group {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-right: 8px;
  flex-shrink: 0;
}

.tab-switcher__title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.tab-switcher__title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -.015em;
  color: var(--t1);
  margin: 0;
  line-height: 1;
  white-space: nowrap;
}

.tab-switcher__title-divider {
  width: 1px;
  height: 16px;
  background: var(--bd);
  opacity: .8;
}

.tab-switcher__tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.tab-switcher__extra {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-right: var(--sp-1);
  flex-shrink: 0;
}

.tab-switcher::-webkit-scrollbar {
  display: none;
}

.tab-switcher__tab {
  padding: 6px 12px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
  cursor: pointer;
  font-size: .86rem;
  font-weight: 500;
  color: var(--t2);
  background: none;
  border: none;
  transition: all .15s ease;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  appearance: none;
  -webkit-appearance: none;
}

.tab-switcher__tab:hover {
  color: var(--t1);
  background: color-mix(in srgb, var(--t1) 6%, transparent);
}

.tab-switcher__tab--active {
  color: var(--t1);
  font-weight: 600;
  background: color-mix(in srgb, var(--ac) 12%, transparent);
}

[data-theme="light"] .tab-switcher__tab--active {
  color: var(--ac);
  background: color-mix(in srgb, var(--ac) 14%, transparent);
}

.tab-switcher__tab:disabled,
.tab-switcher__tab--disabled {
  opacity: .4;
  cursor: not-allowed;
}

.tab-switcher__tab--right-first {
  margin-left: auto;
}

.tab-switcher__badge {
  background: var(--ac);
  color: #fff;
  font-size: .68rem;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 2px;
}

/* 未保存状态小圆点 (设置页分区导航): 与 label 同行的纯 CSS 圆点 */
.tab-switcher__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--c-caution, #e8a33d);
  margin-left: 2px;
}

.tab-switcher__tab :deep(.ms) {
  font-size: 18px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 18;
}

.tab-switcher__tab--active :deep(.ms) {
  color: var(--ac);
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 18;
}

.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  color: var(--t2);
  cursor: pointer;
  padding: 2px 4px;
  margin-left: -4px;
  border-radius: var(--r-xs, 4px);
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color .15s ease, background .15s ease;
  line-height: 1;
}

.mobile-menu-btn:hover {
  color: var(--t1);
  background: color-mix(in srgb, var(--t1) 6%, transparent);
}

.mobile-menu-btn :deep(.ms) {
  font-size: 20px;
}

@media (max-width: 768px) {
  .tab-switcher {
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 0;
    min-height: auto;
  }

  .tab-switcher__title-group {
    order: 1;
    margin-right: auto;
    gap: 6px;
  }

  .tab-switcher__title-divider {
    display: none;
  }

  .tab-switcher__extra {
    order: 2;
    margin-left: auto;
    padding-right: 0;
  }

  .tab-switcher__tabs {
    order: 3;
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
    gap: 4px;
    mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
  }

  .mobile-menu-btn {
    display: inline-flex;
  }
}
</style>
