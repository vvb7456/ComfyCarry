<script setup lang="ts">
/**
 * FusionTabs — Tab-panel fusion container.
 *
 * Two modes:
 *   1. `bare` (default) — just the tab bar, no wrapping container
 *   2. `wrapped` — tabs sit in a bg3 header, panel slot below,
 *      all wrapped in a bordered + rounded container
 *
 * Active tab's bottom border merges with the panel below.
 */
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
  /** Size variant */
  size?: 'sm' | 'md'
  /** Wrapping mode: false = tab bar only, true = bordered container with panel slot */
  wrapped?: boolean
  /** Min height for the panel area (only in wrapped mode) */
  minHeight?: string
}>(), {
  panelBg: 'var(--bg)',
  size: 'md',
  wrapped: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
}>()

const active = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function onClick(tab: FusionTab) {
  active.value = active.value === tab.key ? null : tab.key
}
</script>

<template>
  <!-- Wrapped mode: bordered container -->
  <div v-if="wrapped" class="ft-wrap">
    <div class="ft-header">
      <div class="ft-tabs" role="tablist">
        <button
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

  <!-- Bare mode: just the tab bar -->
  <div v-else class="ft-tabs" role="tablist">
    <button
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
/* ═══ Wrapped mode ═══ */
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

/* ═══ Tab bar ═══ */
.ft-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  position: relative;
  border-bottom: 1px solid var(--bd);
}

/* ═══ Tab button ═══ */
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

/* ── Size: sm ── */
.ft-tab--sm {
  padding: 5px 12px;
  font-size: var(--text-sm);
}
</style>
