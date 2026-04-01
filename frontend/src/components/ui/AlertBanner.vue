<script setup lang="ts">
const props = withDefaults(defineProps<{
  tone?: 'info' | 'success' | 'warning' | 'danger'
  icon?: string
  closable?: boolean
  dense?: boolean
}>(), {
  tone: 'info',
})

const emit = defineEmits<{ close: [] }>()

const visible = defineModel<boolean>('visible', { default: true })

const defaultIcons: Record<string, string> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
}

const iconName = () => props.icon ?? defaultIcons[props.tone]

function close() {
  visible.value = false
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="alert-banner" :class="[`alert-banner--${tone}`, { 'alert-banner--dense': dense }]">
    <span class="alert-banner__icon"><span class="ms ms-xs">{{ iconName() }}</span></span>
    <div class="alert-banner__content">
      <slot />
    </div>
    <button v-if="closable" class="alert-banner__close" @click="close">
      <span class="ms ms-xs">close</span>
    </button>
  </div>
</template>

<style scoped>
.alert-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--rs);
  font-size: .82rem;
  line-height: 1.5;
}

.alert-banner--dense {
  padding: 6px 10px;
}

.alert-banner__icon {
  flex-shrink: 0;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  height: calc(1em * 1.5); /* 1em = parent .82rem; × line-height = one text line */
}

.alert-banner__content {
  flex: 1;
  min-width: 0;
}

.alert-banner__content :deep(code) {
  background: rgba(255, 255, 255, .08);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.alert-banner__close {
  flex-shrink: 0;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  height: calc(1em * 1.5);
  background: none;
  border: none;
  color: inherit;
  opacity: .6;
  cursor: pointer;
  padding: 0;
}
.alert-banner__close:hover {
  opacity: 1;
}

/* ── Tone variants ── */
.alert-banner--success {
  background: color-mix(in srgb, var(--c-positive) 8%, var(--bg3));
  border: 1px solid color-mix(in srgb, var(--c-positive) 25%, var(--bd));
  color: var(--c-positive);
}

.alert-banner--info {
  background: color-mix(in srgb, var(--c-info) 8%, var(--bg3));
  border: 1px solid color-mix(in srgb, var(--c-info) 25%, var(--bd));
  color: var(--c-info);
}

.alert-banner--warning {
  background: color-mix(in srgb, var(--c-caution) 8%, var(--bg3));
  border: 1px solid color-mix(in srgb, var(--c-caution) 25%, var(--bd));
  color: var(--c-caution);
}

.alert-banner--danger {
  background: color-mix(in srgb, var(--c-negative) 8%, var(--bg3));
  border: 1px solid color-mix(in srgb, var(--c-negative) 25%, var(--bd));
  color: var(--c-negative);
}
</style>
