<script setup lang="ts">
/**
 * SettingsGroupToggleRow — 设置组内的开关行 (label(+help)+desc 左 + ToggleSwitch 右)。
 * 纯展示包装, 统一行内边距与分隔线语义 (由 SettingsGroup 的行分隔样式承担)。
 */
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'SettingsGroupToggleRow' })

defineProps<{
  label: string
  desc?: string
  /** 行级操作建议/注意事项 (HelpTip) */
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