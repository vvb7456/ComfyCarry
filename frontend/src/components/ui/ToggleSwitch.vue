<script setup lang="ts">

defineOptions({ name: 'ToggleSwitch' })

defineProps<{
  modelValue: boolean
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  /** 无障碍名称; 开关文字不在本组件内 (slot/label 包裹) 时必传 */
  label?: string
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <label class="toggle-wrap" :class="`toggle-wrap--${size ?? 'md'}`">
    <input
      type="checkbox"
      role="switch"
      class="toggle-input"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
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
  position: relative;
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

.toggle-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

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

.toggle-input:focus-visible ~ .toggle-track {
  border-color: var(--ac);
  box-shadow: 0 0 0 3px var(--acg);
}

.toggle-wrap--sm  .toggle-input:checked ~ .toggle-track .toggle-knob { left: 14px; }
.toggle-wrap--md  .toggle-input:checked ~ .toggle-track .toggle-knob { left: 18px; }
.toggle-wrap--lg  .toggle-input:checked ~ .toggle-track .toggle-knob { left: 22px; }
</style>
