<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import MsIcon from './MsIcon.vue'

const { t } = useI18n({ useScope: 'global' })
const theme = useTheme()

const iconMap: Record<string, string> = {
  dark: 'dark_mode',
  light: 'light_mode',
  system: 'contrast',
}
</script>

<template>
  <button
    type="button"
    class="theme-toggle-btn"
    :title="t('common.theme_toggle')"
    :aria-label="t('common.theme_toggle')"
    @click="theme.cycle()"
  >
    <MsIcon
      :name="iconMap[theme.mode.value] || 'contrast'"
      size="md"
      color="none"
      class="theme-toggle-btn__icon"
    />
  </button>
</template>

<style scoped>
.theme-toggle-btn {
  background: none;
  border: none;
  color: var(--t2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 50%;
  transition: color .2s;
  appearance: none;
  -webkit-appearance: none;
}

.theme-toggle-btn:hover {
  color: var(--ac);
}

.theme-toggle-btn :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
}
</style>
