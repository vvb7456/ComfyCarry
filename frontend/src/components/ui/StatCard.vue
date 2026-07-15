<script setup lang="ts">

defineOptions({ name: 'StatCard' })

const props = withDefaults(defineProps<{
  label?: string
  status?: 'info' | 'running' | 'stopped' | 'loading' | 'error'
  valueSize?: 'sm' | 'md'
  valueColor?: string
  /**
   * Visual variant.
   * - ``default``: top accent bar driven by ``status``.
   * - ``kpi``: compact KPI tile with bottom accent bar driven by ``tone``
   *   (used by Dashboard summary tiles, see CR §5.9).
   */
  variant?: 'default' | 'kpi'
  /** Only consumed when ``variant === 'kpi'``. */
  tone?: 'default' | 'warn'
}>(), {
  status: 'info',
  valueSize: 'md',
  variant: 'default',
  tone: 'default',
})
</script>

<template>
  <div
    class="stat-card"
    :class="[
      `stat-card--${props.status}`,
      `stat-card--v-${props.variant}`,
      props.variant === 'kpi' ? `stat-card--tone-${props.tone}` : null,
    ]"
  >
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

/* ── Default variant: top accent bar driven by status ── */
.stat-card--v-default::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--blue);
  opacity: .6;
  border-radius: var(--r) var(--r) 0 0;
}

.stat-card--v-default.stat-card--info::before { background: var(--blue); }
.stat-card--v-default.stat-card--running::before { background: var(--green); }
.stat-card--v-default.stat-card--stopped::before { background: color-mix(in srgb, var(--t3) 80%, var(--bd)); }
.stat-card--v-default.stat-card--loading::before { background: var(--amber); }
.stat-card--v-default.stat-card--error::before { background: var(--red); }

/* ── KPI variant: compact tile + bottom accent bar driven by tone ── */
.stat-card--v-kpi {
  border-radius: var(--r-md);
  padding: var(--sp-5) var(--sp-5) var(--sp-4);
}
.stat-card--v-kpi::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--ac);
  opacity: 0.5;
}
.stat-card--v-kpi.stat-card--tone-warn::after {
  background: var(--amber);
  opacity: 0.8;
}

.stat-card__label {
  font-size: .78rem;
  color: var(--t3);
  text-transform: uppercase;
  letter-spacing: .5px;
  margin-bottom: 8px;
}

.stat-card--v-kpi .stat-card__label {
  font-size: var(--text-xs);
  letter-spacing: 0.6px;
  margin-bottom: var(--sp-2);
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

.stat-card--v-kpi .stat-card__value {
  font-size: 1.6rem;
  color: var(--t1);
  font-variant-numeric: tabular-nums;
  line-height: 1;
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
