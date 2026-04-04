<script setup lang="ts">

defineOptions({ name: 'BaseTextarea' })

withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  rows?: number
  disabled?: boolean
  mono?: boolean
  spellcheck?: boolean
}>(), {
  rows: 3,
  spellcheck: true,
})

defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    :disabled="disabled"
    :spellcheck="spellcheck"
    :class="['form-textarea', { 'form-textarea--mono': mono }]"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
