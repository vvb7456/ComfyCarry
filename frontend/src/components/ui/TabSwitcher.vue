<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'
import BrandIcon from './BrandIcon.vue'
import type { BrandName } from '@/config/brand-icons'
import type { IconName } from '@/config/icon-codepoints'

/**
 * TabSwitcher — 纯 tab 条 (无页头/无标题/无吸顶)。
 *
 * 页面级用法放进 PageHeaderRow 默认插槽 (页头由 PageHeaderRow 统一承担
 * 汉堡/标题/吸顶); modal 内直接平铺使用 (sticky 相关样式已移入页头层)。
 * 需要贴行尾时由调用方加 margin-left:auto (如 ModelsPage 触发器)。
 */
defineOptions({ name: 'TabSwitcher' })

const { t } = useI18n({ useScope: 'global' })

export interface TabItem {
  key: string
  label: string
  icon?: IconName
  /** 品牌身份图标 (单色); 与 icon 二选一, brand 优先 */
  brand?: BrandName
  iconColor?: string
  badge?: string | number
  disabled?: boolean
  /** 未保存状态小圆点 (设置页分区导航用), 纯展示 */
  dot?: boolean
  /** Push this tab to the right side (adds auto margin spacer before the first right-aligned tab) */
  align?: 'right'
}

const props = defineProps<{
  tabs: TabItem[]
  modelValue: string
  /**
   * 覆盖 tab 的 aria-controls: 所有 tab 共用同一面板时传固定面板 id
   * (如单列表切换数据源的弹窗); 不传则每个 tab 指向 panelIdFor(key)。
   */
  panelIds?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [key: string]
}>()

/* tab/panel id 配对: 调用方用 tabIdFor(key)/panelIdFor(key) 建立 tab ↔ panel 关联 */
const uid = useId()
function tabIdFor(key: string) {
  return `tab-${uid}-${key}`
}
function panelIdFor(key: string) {
  return `panel-${uid}-${key}`
}
defineExpose({ tabIdFor, panelIdFor })

const firstRightIndex = computed(() =>
  props.tabs.findIndex(t => t.align === 'right'),
)

function selectTab(tab: TabItem) {
  if (tab.disabled || props.modelValue === tab.key) return
  emit('update:modelValue', tab.key)
}

/**
 * 方向键导航: 焦点与激活跟随 (selection follows focus), 跳过禁用项。
 * roving tabindex —— Tab 只停靠激活 tab, 方向键在 tab 间移动。
 * 从 idx±1 起步循环, 避免首步命中当前 tab 导致左右键看似无效。
 */
function onTabKeydown(e: KeyboardEvent, idx: number) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  const isNav = step !== 0 || e.key === 'Home' || e.key === 'End'
  if (!isNav) return
  e.preventDefault()
  const n = props.tabs.length
  const first = (idx + step + n) % n
  const from = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : first
  const dir = e.key === 'Home' ? 1 : e.key === 'End' ? -1 : step
  for (let k = 0; k < n; k++) {
    const tab = props.tabs[(from + dir * k + n) % n]
    if (tab && !tab.disabled) {
      const el = document.getElementById(tabIdFor(tab.key))
      if (el) el.focus()
      selectTab(tab)
      return
    }
  }
}
</script>

<template>
  <div class="tab-switcher" role="tablist">
    <div class="tab-switcher__tabs">
      <button
        v-for="(tab, idx) in tabs"
        :id="tabIdFor(tab.key)"
        :key="tab.key"
        type="button"
        role="tab"
        class="tab-switcher__tab"
        :class="{
          'tab-switcher__tab--active': modelValue === tab.key,
          'tab-switcher__tab--disabled': tab.disabled,
          'tab-switcher__tab--right-first': idx === firstRightIndex,
        }"
        :disabled="tab.disabled"
        :aria-selected="modelValue === tab.key"
        :aria-controls="panelIds || panelIdFor(tab.key)"
        :tabindex="modelValue === tab.key ? 0 : -1"
        @click="selectTab(tab)"
        @keydown="onTabKeydown($event, idx)"
      >
        <BrandIcon
          v-if="tab.brand"
          :name="tab.brand"
          size="sm"
        />
        <MsIcon
          v-else-if="tab.icon"
          :name="tab.icon"
          size="sm"
        />
        <span>{{ tab.label }}</span>
        <span v-if="tab.badge" class="tab-switcher__badge">{{ tab.badge }}</span>
        <span v-if="tab.dot" class="tab-switcher__dot" :aria-label="t('common.unsaved')" />
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 38px;
}

.tab-switcher__tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-switcher__extra {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-right: var(--sp-1);
  flex-shrink: 0;
  flex-wrap: wrap;
  max-width: 100%;
}

.tab-switcher__tabs::-webkit-scrollbar {
  display: none;
}

.tab-switcher__tab {
  white-space: nowrap;
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

/* 品牌单色 mark 跟随选中态: 与上面 MsIcon 同色 */
.tab-switcher__tab--active :deep(.brand-icon) {
  color: var(--ac);
}

/* 窄屏通栏: 与 PageHeaderRow 的下放断点统一 (600px, 见其注释)。
   页面正文的可用宽度已扣除侧栏和留白 (modal 内无 page 容器, 该断点不生效)。 */
@container page (max-width: 600px) {
  .tab-switcher {
    flex-basis: 100%;
    min-height: auto;
  }

  .tab-switcher__tabs {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
    gap: 4px;
  }
}
</style>
