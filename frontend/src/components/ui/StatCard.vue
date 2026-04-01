<script setup lang="ts">
const props = withDefaults(defineProps<{
  label?: string
  status?: 'info' | 'running' | 'stopped' | 'loading' | 'error'
  valueSize?: 'sm' | 'md'
  valueColor?: string
}>(), {
  status: 'info',
  valueSize: 'md',
})
</script>

<template>
  <div class="stat-card" :class="[`stat-card--${props.status}`]">
    <div v-if="props.label || $slots.label" class="stat-card__label">
      <slot name="label">{{ props.label }}</slot>
    </div>
    <div
      v-if="$slots.value"
      class="stat-card__value"
      :class="[`stat-card__value--${props.valueSize}`]"
      :style="props.valueColor ? { color: props.valueColor } : undefined"
    >
      <slot name="value" />
    </div>
    <div v-if="$slots.sub" class="stat-card__sub">
      <slot name="sub" />
    </div>
    <div v-if="$slots.default" class="stat-card__extra">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  padding: clamp(18px, 1.5vw, 28px) clamp(20px, 1.8vw, 32px);
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--blue);
  opacity: .6;
  border-radius: var(--r) var(--r) 0 0;
}

.stat-card--info::before { background: var(--blue); }
.stat-card--running::before { background: var(--green); }
.stat-card--stopped::before { background: color-mix(in srgb, var(--t3) 80%, var(--bd)); }
.stat-card--loading::before { background: var(--amber); }
.stat-card--error::before { background: var(--red); }

.stat-card__label {
  font-size: .78rem;
  color: var(--t3);
  text-transform: uppercase;
  letter-spacing: .5px;
  margin-bottom: 8px;
}

.stat-card__value {
  font-weight: 700;
}

.stat-card__value--sm {
  font-size: 1rem;
}

.stat-card__value--md {
  font-size: 1.5rem;
}

.stat-card__sub {
  font-size: .78rem;
  color: var(--t2);
  margin-top: 4px;
}

.stat-card__extra {
  margin-top: 10px;
}
</style>
