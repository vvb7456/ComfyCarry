<script setup lang="ts">

defineOptions({ name: 'BaseInput' })

withDefaults(defineProps<{
  modelValue?: string
  type?: string
  placeholder?: string
  disabled?: boolean
  mono?: boolean
}>(), {
  type: 'text',
})

defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="['form-input', { 'form-input--mono': mono }]"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
