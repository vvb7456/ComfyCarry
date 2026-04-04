<script setup lang="ts">
import { computed, useSlots } from 'vue'

defineOptions({ name: 'BaseCard' })

const props = withDefaults(defineProps<{
  variant?: 'bg2' | 'bg3'
  radius?: 'sm' | 'md' | 'lg'
  density?: 'compact' | 'default' | 'roomy'
  tone?: 'default' | 'danger'
  interactive?: boolean
  padding?: boolean
}>(), {
  variant: 'bg3',
  radius: 'md',
  density: 'default',
  tone: 'default',
  interactive: false,
  padding: true,
})

const slots = useSlots()
const structured = computed(() => !!slots.header || !!slots.footer)
const padded = computed(() => props.padding)
</script>

<template>
  <div
    class="base-card"
    :class="[
      `base-card--${props.variant}`,
      `base-card--r-${props.radius}`,
      `base-card--density-${props.density}`,
      `base-card--tone-${props.tone}`,
      {
        'base-card--interactive': props.interactive,
        'base-card--simple': !structured,
        'base-card--structured': structured,
        'base-card--padded': !structured && padded,
      },
    ]"
  >
    <template v-if="structured">
      <div v-if="$slots.header" class="base-card__header">
        <slot name="header" />
      </div>
      <div class="base-card__body" :class="{ 'base-card__body--standalone': !$slots.header }">
        <slot />
      </div>
      <div v-if="$slots.footer" class="base-card__footer">
        <slot name="footer" />
      </div>
    </template>
    <template v-else>
      <slot />
    </template>
  </div>
</template>

<style scoped>
.base-card {
  border: 1px solid var(--bd);
  min-width: 0;
  --card-py: 12px;
  --card-px: 14px;
  --card-gap: 12px;
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
}

.base-card--bg2 { background: var(--bg2); }
.base-card--bg3 { background: var(--bg3); }

.base-card--r-sm { border-radius: var(--rs); }
.base-card--r-md { border-radius: var(--r); }
.base-card--r-lg { border-radius: 16px; }

.base-card--density-compact {
  --card-py: 10px;
  --card-px: 14px;
  --card-gap: 10px;
}

.base-card--density-default {
  --card-py: 12px;
  --card-px: 14px;
  --card-gap: 12px;
}

.base-card--density-roomy {
  --card-py: var(--card-py-roomy, clamp(16px, 1.5vw, 24px));
  --card-px: var(--card-px-roomy, clamp(16px, 1.5vw, 24px));
  --card-gap: 14px;
}

.base-card--tone-danger {
  border-color: rgba(239, 68, 68, 0.25);
}

.base-card--interactive:hover {
  border-color: var(--bd-f);
}

.base-card--simple.base-card--padded {
  padding: var(--card-py) var(--card-px);
}

.base-card__header {
  padding: var(--card-py) var(--card-px) 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: .92rem;
  font-weight: 600;
  color: var(--t1);
}

.base-card__body {
  padding: var(--card-gap) var(--card-px) var(--card-py);
  min-width: 0;
}

.base-card__body--standalone {
  padding-top: var(--card-py);
}

.base-card__footer {
  padding: 0 var(--card-px) var(--card-py);
  min-width: 0;
}

.base-card__header :deep(.ms) {
  flex-shrink: 0;
}
</style>
