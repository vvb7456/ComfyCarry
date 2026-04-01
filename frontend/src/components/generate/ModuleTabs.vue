<script setup lang="ts">
/**
 * ModuleTabs — 功能模块 Tab 栏 + 独立开关
 *
 * 三态:
 *  1. 基础态 (inactive + disabled)
 *  2. 激活态 (active = 正在查看面板)
 *  3. 启用态 (enabled = 开关打开, 不一定正在查看)
 *
 * 行为:
 *  - 点击 tab → 切换 active (互斥, 再次点击同一 tab 可收起)
 *  - 点击 switch → 切换 enabled (独立于 active, 不冒泡)
 */
import { computed } from 'vue'
import MsIcon from '@/components/ui/MsIcon.vue'

export interface SwitchTabItem {
  key: string
  label: string
  icon?: string
  disabled?: boolean
}

const props = defineProps<{
  tabs: SwitchTabItem[]
  /** 当前激活的 tab key (null = 无面板展开) */
  activeTab: string | null
  /** 已启用的 tab keys */
  enabledTabs: Set<string>
}>()

const emit = defineEmits<{
  'update:activeTab': [key: string | null]
  'toggle': [key: string, enabled: boolean]
}>()

const activeKey = computed(() => props.activeTab)

function onTabClick(tab: SwitchTabItem) {
  if (tab.disabled) return
  // Toggle: 再次点击同一 tab → 收起 (null)
  emit('update:activeTab', activeKey.value === tab.key ? null : tab.key)
}

function onSwitchClick(e: Event, tab: SwitchTabItem) {
  e.stopPropagation()
  if (tab.disabled) return
  const checked = (e.target as HTMLInputElement).checked
  emit('toggle', tab.key, checked)
}

function tabClass(tab: SwitchTabItem) {
  return {
    'switch-tab': true,
    'active': activeKey.value === tab.key,
    'enabled': props.enabledTabs.has(tab.key) && activeKey.value !== tab.key,
    'disabled': !!tab.disabled,
  }
}
</script>

<template>
  <div class="switch-tabs" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      :class="tabClass(tab)"
      role="tab"
      :aria-selected="activeKey === tab.key"
      :disabled="tab.disabled"
      @click="onTabClick(tab)"
    >
      <MsIcon v-if="tab.icon" :name="tab.icon" class="tab-icon" />
      <span class="tab-label">{{ tab.label }}</span>
      <input
        type="checkbox"
        class="tab-switch"
        :checked="enabledTabs.has(tab.key)"
        :disabled="tab.disabled"
        :title="tab.label"
        @click="onSwitchClick($event, tab)"
      >
    </button>
  </div>
</template>

<style scoped>
.switch-tabs {
  display: flex;
  gap: var(--sp-2, 8px);
  flex-wrap: wrap;
  margin-bottom: var(--sp-2, 8px);
}

@media (max-width: 768px) {
  .switch-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .switch-tabs::-webkit-scrollbar { display: none; }
  .switch-tab { flex-shrink: 0; }
}

/* ── Base state ── */
.switch-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: .82rem;
  font-weight: 500;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md, 8px);
  color: var(--t2);
  cursor: pointer;
  user-select: none;
  transition: background .15s, border-color .15s, color .15s;
}
.switch-tab:hover:not(.disabled) { background: var(--bg3); }

/* ── Active state: viewing panel ── */
.switch-tab.active {
  background: color-mix(in srgb, var(--ac) 15%, transparent);
  border-color: var(--ac);
  color: var(--ac);
}

/* ── Enabled state: switch on, not viewing ── */
.switch-tab.enabled {
  background: color-mix(in srgb, var(--ac) 8%, var(--bg2));
  border-color: color-mix(in srgb, var(--ac) 40%, var(--bd));
  color: var(--t1);
}
.switch-tab.enabled .tab-icon { color: var(--ac); }

/* ── Disabled ── */
.switch-tab.disabled { opacity: .4; cursor: not-allowed; }

/* ── Icon ── */
.tab-icon { font-size: .95rem; }

/* ── Toggle switch ── */
.tab-switch {
  appearance: none;
  -webkit-appearance: none;
  width: 28px;
  height: 14px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: 7px;
  cursor: pointer;
  margin: 0 0 0 4px;
  flex-shrink: 0;
  position: relative;
  transition: background .2s, border-color .2s;
}
.tab-switch::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 10px;
  height: 10px;
  background: var(--t3);
  border-radius: 50%;
  transition: transform .2s, background .2s;
}
.tab-switch:checked {
  background: var(--ac);
  border-color: var(--ac);
}
.tab-switch:checked::after {
  transform: translateX(14px);
  background: #fff;
}
.tab-switch:disabled { cursor: not-allowed; }
</style>
