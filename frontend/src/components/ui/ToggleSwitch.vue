<script setup lang="ts">
defineProps<{
  modelValue: boolean
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <label class="toggle-wrap" :class="`toggle-wrap--${size ?? 'md'}`">
    <input
      type="checkbox"
      class="toggle-input"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="toggle-track">
      <span class="toggle-knob" />
    </span>
    <slot />
  </label>
</template>

<style scoped>
.toggle-wrap {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
  user-select: none;
}
.toggle-wrap:has(.toggle-input:disabled) {
  opacity: .5;
  cursor: not-allowed;
}

.toggle-input { display: none; }

.toggle-track {
  position: relative;
  display: inline-block;
  border-radius: 99px;
  background: var(--bg4);
  border: 1px solid var(--bd);
  transition: background .2s, border-color .2s;
  flex-shrink: 0;
}

.toggle-wrap--sm .toggle-track { width: 28px; height: 16px; }
.toggle-wrap--md .toggle-track { width: 36px; height: 20px; }
.toggle-wrap--lg .toggle-track { width: 44px; height: 24px; }

.toggle-knob {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--t3);
  transition: left .2s, width .15s, background .2s;
}

.toggle-wrap--sm  .toggle-knob { width: 10px; height: 10px; left: 2px; }
.toggle-wrap--md  .toggle-knob { width: 14px; height: 14px; left: 2px; }
.toggle-wrap--lg  .toggle-knob { width: 18px; height: 18px; left: 2px; }

.toggle-input:checked ~ .toggle-track { background: var(--ac); border-color: var(--ac); }
.toggle-input:checked ~ .toggle-track .toggle-knob { background: #fff; }

.toggle-wrap--sm  .toggle-input:checked ~ .toggle-track .toggle-knob { left: 14px; }
.toggle-wrap--md  .toggle-input:checked ~ .toggle-track .toggle-knob { left: 18px; }
.toggle-wrap--lg  .toggle-input:checked ~ .toggle-track .toggle-knob { left: 22px; }
</style>
