<script setup lang="ts">
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'SettingsGroupToggleRow' })

defineProps<{
  label: string
  desc?: string
  help?: string
  modelValue: boolean
  disabled?: boolean
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="settings-row">
    <div class="settings-row__text">
      <div class="settings-row__label">
        {{ label }}
        <HelpTip v-if="help" :text="help" />
      </div>
      <div v-if="desc" class="settings-row__desc">{{ desc }}</div>
    </div>
    <div class="settings-row__control settings-row__control--switch">
      <ToggleSwitch
        :model-value="modelValue"
        :disabled="disabled"
        :label="label"
        @update:model-value="$emit('update:modelValue', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.settings-row__control--switch {
  justify-content: flex-end;
}
</style>