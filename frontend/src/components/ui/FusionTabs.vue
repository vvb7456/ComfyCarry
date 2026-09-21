<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'FusionTabs' })

export interface FusionTab {
  key: string | number
  label: string
  color?: string
}

const props = withDefaults(defineProps<{
  tabs: FusionTab[]
  modelValue: string | number | null
  /** Background of the panel below — used for border-bottom merge. */
  panelBg?: string
  size?: 'sm' | 'md'
  wrapped?: boolean
  minHeight?: string
  collapsible?: boolean
}>(), {
  panelBg: 'var(--bg)',
  size: 'md',
  wrapped: false,
  collapsible: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
}>()

const active = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function onClick(tab: FusionTab) {
  if (active.value === tab.key) {
    if (props.collapsible) active.value = null
  } else {
    active.value = tab.key
  }
}
</script>

<template>
  <div v-if="wrapped" class="ft-wrap">
    <div class="ft-header">
      <div class="ft-tabs" role="tablist">
        <button
          type="button"
          v-for="tab in tabs"
          :key="tab.key"
          class="ft-tab"
          :class="[
            { active: active === tab.key },
            size === 'sm' ? 'ft-tab--sm' : '',
          ]"
          :style="active === tab.key
            ? { '--chip-color': tab.color, '--ft-panel-bg': panelBg }
            : { '--chip-color': tab.color }
          "
          role="tab"
          :aria-selected="active === tab.key"
          @click="onClick(tab)"
        >
          <slot name="tab" :tab="tab" :active="active === tab.key">
            {{ tab.label }}
          </slot>
        </button>
        <slot name="extra" />
      </div>
    </div>
    <div class="ft-panel" :style="{ background: panelBg, minHeight }">
      <slot />
    </div>
  </div>

  <div v-else class="ft-tabs" role="tablist">
    <button
      type="button"
      v-for="tab in tabs"
      :key="tab.key"
      class="ft-tab"
      :class="[
        { active: active === tab.key },
        size === 'sm' ? 'ft-tab--sm' : '',
      ]"
      :style="active === tab.key
        ? { '--chip-color': tab.color, '--ft-panel-bg': panelBg }
        : { '--chip-color': tab.color }
      "
      role="tab"
      :aria-selected="active === tab.key"
      @click="onClick(tab)"
    >
      <slot name="tab" :tab="tab" :active="active === tab.key">
        {{ tab.label }}
      </slot>
    </button>
  </div>
</template>

<style scoped>
.ft-wrap {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.ft-header {
  background: var(--bg3);
  padding: var(--sp-2) var(--sp-3) 0;
}

.ft-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.ft-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  position: relative;
  border-bottom: 1px solid var(--bd);
}

.ft-tab {
  --ft-panel-bg: var(--bg);
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 6px 16px;
  margin-bottom: -1px;
  border: 1px solid transparent;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-top-left-radius: var(--r-md);
  border-top-right-radius: var(--r-md);
  background: transparent;
  color: var(--t2);
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background .15s, border-color .15s, color .15s;
  white-space: nowrap;
}

.ft-tab:hover:not(.active) {
  background: color-mix(in srgb, var(--bg2) 50%, transparent);
  color: var(--t1);
}

.ft-tab.active {
  background: var(--ft-panel-bg);
  border-color: var(--bd);
  border-bottom-color: var(--ft-panel-bg);
  color: var(--ac);
  z-index: 1;
}

.ft-tab--sm {
  padding: 5px 12px;
  font-size: var(--text-sm);
}
</style>
