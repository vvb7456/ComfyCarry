<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import MsIcon from './MsIcon.vue'

export interface TabItem {
  key: string
  label: string
  icon?: string
  iconColor?: string
  badge?: string | number
  disabled?: boolean
  /** Push this tab to the right side (adds auto margin spacer before the first right-aligned tab) */
  align?: 'right'
}

const props = defineProps<{
  tabs: TabItem[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [key: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const tabRefs = new Map<string, HTMLButtonElement>()
const indicatorLeft = ref(0)
const indicatorWidth = ref(0)
const indicatorVisible = ref(false)

const firstRightIndex = computed(() =>
  props.tabs.findIndex(t => t.align === 'right'),
)

function selectTab(tab: TabItem) {
  if (tab.disabled || props.modelValue === tab.key) return
  emit('update:modelValue', tab.key)
}

function setTabRef(key: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLButtonElement) {
    tabRefs.set(key, el)
  } else {
    tabRefs.delete(key)
  }
}

async function updateIndicator() {
  await nextTick()
  const activeTab = tabRefs.get(props.modelValue)
  if (!activeTab) {
    indicatorVisible.value = false
    return
  }
  indicatorLeft.value = activeTab.offsetLeft
  indicatorWidth.value = activeTab.offsetWidth
  indicatorVisible.value = true
}

function onResize() {
  updateIndicator()
}

const indicatorStyle = computed(() => ({
  width: `${indicatorWidth.value}px`,
  transform: `translateX(${indicatorLeft.value}px)`,
  opacity: indicatorVisible.value ? '1' : '0',
}))

watch(
  () => [props.modelValue, props.tabs.map(tab => `${tab.key}:${tab.label}:${tab.badge ?? ''}:${tab.disabled ? '1' : '0'}`).join('|')],
  () => { updateIndicator() },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('resize', onResize)
  updateIndicator()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div ref="rootRef" class="tab-switcher" role="tablist">
    <button
      v-for="(tab, idx) in tabs"
      :key="tab.key"
      type="button"
      :ref="el => setTabRef(tab.key, el)"
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
    </button>
    <span class="tab-switcher__indicator" :style="indicatorStyle" />
    <slot />
  </div>
</template>

<style scoped>
.tab-switcher {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid var(--bd);
  margin-bottom: 16px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.tab-switcher::-webkit-scrollbar {
  display: none;
}

.tab-switcher__tab {
  padding: 10px 18px;
  flex-shrink: 0;
  cursor: pointer;
  font-size: .88rem;
  font-weight: 500;
  color: var(--t2);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  transition: all .15s;
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
}

.tab-switcher__tab--active {
  color: var(--ac);
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
  margin-left: 5px;
}

.tab-switcher__tab :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}

.tab-switcher__indicator {
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 2px;
  background: var(--ac);
  pointer-events: none;
  transition:
    transform .34s cubic-bezier(0.22, 1, 0.36, 1),
    width .34s cubic-bezier(0.22, 1, 0.36, 1),
    opacity .18s ease;
}

@media (prefers-reduced-motion: reduce) {
  .tab-switcher__indicator {
    transition: none;
  }
}
</style>
