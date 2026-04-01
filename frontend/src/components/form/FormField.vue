<script setup lang="ts">
defineProps<{
  /** Field label text (alternative to #label slot) */
  label?: string
  /** Whether the field is required (shows asterisk) */
  required?: boolean
  /** Hint text below the control */
  hint?: string
  /** Error text below the control (overrides hint when present) */
  error?: string
  /** Layout density */
  density?: 'default' | 'compact'
  /** Layout direction: vertical (default) or horizontal (label left, control right) */
  layout?: 'vertical' | 'horizontal'
}>()
</script>

<template>
  <div class="form-field" :class="[`form-field--${density ?? 'default'}`, layout === 'horizontal' && 'form-field--h']">
    <!-- Horizontal layout: label+hint on left, control on right -->
    <template v-if="layout === 'horizontal'">
      <div class="form-field__h-left">
        <FieldLabel v-if="label || $slots.label" :required="required">
          <slot name="label">{{ label }}</slot>
          <template v-if="$slots['label-right']" #right>
            <slot name="label-right" />
          </template>
        </FieldLabel>
        <div v-if="hint && !error" class="form-field__hint">{{ hint }}</div>
        <div v-if="error" class="form-field__error">{{ error }}</div>
      </div>
      <div v-if="$slots.default" class="form-field__h-right">
        <slot />
      </div>
    </template>
    <!-- Vertical layout (default) -->
    <template v-else>
      <FieldLabel v-if="label || $slots.label" :required="required">
        <slot name="label">{{ label }}</slot>
        <template v-if="$slots['label-right']" #right>
          <slot name="label-right" />
        </template>
      </FieldLabel>
      <div v-if="$slots.default" class="form-field__control">
        <slot />
      </div>
      <div v-if="error" class="form-field__error">{{ error }}</div>
      <div v-else-if="hint" class="form-field__hint">{{ hint }}</div>
      <slot name="below" />
    </template>
  </div>
</template>

<script lang="ts">
import FieldLabel from './FieldLabel.vue'
export default { components: { FieldLabel } }
</script>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
}

/* Default density — main page forms */
.form-field--default {
  gap: 6px;
  margin-bottom: 12px;
}

/* Compact density — modals, wizard */
.form-field--compact {
  gap: 6px;
  margin-bottom: 10px;
}

.form-field__hint {
  font-size: var(--hint-font, .72rem);
  line-height: 1.4;
  color: var(--t3);
}

.form-field__error {
  font-size: var(--hint-font, .72rem);
  line-height: 1.4;
  color: var(--red);
}

/* Control slot — flex for inline alignment */
.form-field__control {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* Single block-level controls fill the row */
.form-field__control > :only-child {
  width: 100%;
}

/* Horizontal layout: label+hint on left, control on right */
.form-field--h {
  flex-direction: row;
  align-items: center;
  gap: 16px;
}
.form-field__h-left {
  flex: 1;
  min-width: 0;
}
.form-field__h-left .form-field__hint,
.form-field__h-left .form-field__error {
  margin-top: 2px;
}
.form-field__h-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
