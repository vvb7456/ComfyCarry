<script setup lang="ts">
/**
 * 字段标签。传 for 时渲染原生 label (点击聚焦控件、读屏器读字段名),
 * 不传保持 div (纯展示场景, 如列表头/说明行)。
 */

defineOptions({ name: 'FieldLabel', inheritAttrs: false })

const props = defineProps<{
  /** Whether the field is required (shows asterisk) */
  required?: boolean
  /** 关联控件的 id —— 传入后根元素渲染为 <label :for> */
  for?: string
}>()
</script>

<template>
  <component
    :is="props.for ? 'label' : 'div'"
    class="field-label"
    :for="props.for"
    v-bind="$attrs"
  >
    <span class="field-label__text">
      <slot />
      <span v-if="required" class="field-label__req">*</span>
    </span>
    <span v-if="$slots.right" class="field-label__right">
      <slot name="right" />
    </span>
  </component>
</template>

<style scoped>
.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--label-font, .82rem);
  font-weight: 500;
  color: var(--t2);
  line-height: 1.35;
}

.field-label__text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.field-label__req {
  color: var(--red);
  font-weight: 600;
}

.field-label__right {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .85rem;
  font-weight: 600;
  color: var(--ac);
}
</style>
