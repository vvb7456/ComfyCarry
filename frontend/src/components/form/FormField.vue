<script setup lang="ts">
/**
 * 表单字段壳: label + 控件 + hint/error。
 *
 * 无障碍关联: 每实例生成稳定 id, 通过默认作用域插槽暴露绑定值:
 *   <FormField label="..."><template #default="{ id, describedby, invalid }">
 *     <input :id="id" :aria-describedby="describedby" :aria-invalid="invalid" ...>
 *   </template></FormField>
 *  - id            → 控件 id (label 的 for 自动指向它)
 *  - describedby   → hint/error 元素 id (error 优先, 两者都无时 undefined)
 *  - invalid       → 有 error 时 "true", 否则 undefined
 * 未提供 label 的 FormField 不产生 label 关联, 控件仍可绑定 describedby。
 */

import { computed, ref, useId } from 'vue'

defineOptions({ name: 'FormField' })

const props = defineProps<{
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

const hasLabelSlot = ref(false)

const uid = useId()
const controlId = `ff-${uid}`
const hintId = `ff-h-${uid}`
const errId = `ff-e-${uid}`

const describedby = computed(() => {
  if (props.error) return errId
  if (props.hint) return hintId
  return undefined
})
const invalid = computed(() => (props.error ? 'true' : undefined))
const labelFor = computed(() => (props.label || hasLabelSlot.value) ? controlId : undefined)
</script>

<template>
  <div class="form-field" :class="[`form-field--${density ?? 'default'}`, layout === 'horizontal' && 'form-field--h']">
    <!-- Horizontal layout: label+hint on left, control on right -->
    <template v-if="layout === 'horizontal'">
      <div class="form-field__h-left">
        <FieldLabel v-if="label || $slots.label" :required="required" :for="labelFor">
          <slot name="label" v-bind="{ hasLabelSlot }">{{ label }}</slot>
          <template v-if="$slots['label-right']" #right>
            <slot name="label-right" />
          </template>
        </FieldLabel>
        <div v-if="hint && !error" :id="hintId" class="form-field__hint">{{ hint }}</div>
        <div v-if="error" :id="errId" class="form-field__error">{{ error }}</div>
      </div>
      <div v-if="$slots.default" class="form-field__h-right">
        <slot v-bind="{ id: controlId, describedby, invalid }" />
      </div>
    </template>
    <!-- Vertical layout (default) -->
    <template v-else>
      <FieldLabel v-if="label || $slots.label" :required="required" :for="labelFor">
        <slot name="label" v-bind="{ hasLabelSlot }">{{ label }}</slot>
        <template v-if="$slots['label-right']" #right>
          <slot name="label-right" />
        </template>
      </FieldLabel>
      <div v-if="$slots.default" class="form-field__control">
        <slot v-bind="{ id: controlId, describedby, invalid }" />
      </div>
      <div v-if="error" :id="errId" class="form-field__error">{{ error }}</div>
      <div v-else-if="hint" :id="hintId" class="form-field__hint">{{ hint }}</div>
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