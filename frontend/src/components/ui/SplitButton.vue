<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'SplitButton' })

export interface SplitButtonOption {
  key: string
  label: string
  icon?: string
  active?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  label: string
  icon?: string
  variant?: 'primary' | 'danger' | 'success'
  disabled?: boolean
  loading?: boolean
  options: SplitButtonOption[]
}>(), {
  variant: 'primary',
})

const emit = defineEmits<{
  click: []
  select: [key: string]
}>()

const open = ref(false)

function toggle(e: MouseEvent) {
  e.stopPropagation()
  if (props.disabled || props.loading) return
  open.value = !open.value
}

function select(key: string) {
  emit('select', key)
  open.value = false
}

function onDocClick() {
  open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="split-button" :class="[`split-button--${variant}`]">
    <button
      class="split-button__main"
      :disabled="disabled || loading"
      @click="emit('click')"
    >
      <MsIcon v-if="loading" name="progress_activity" size="sm" color="none" class="split-button__spin" />
      <MsIcon v-else-if="icon" :name="icon" size="sm" color="none" />
      <span>{{ label }}</span>
    </button>

    <button
      class="split-button__arrow"
      :disabled="disabled || loading"
      @click="toggle"
    >
      <MsIcon name="expand_more" size="xs" color="none" />
    </button>

    <div v-if="open" class="split-button__dropdown">
      <div
        v-for="opt in options"
        :key="opt.key"
        class="split-button__option"
        :class="{ 'split-button__option--active': opt.active, 'split-button__option--disabled': opt.disabled }"
        @click="!opt.disabled && select(opt.key)"
      >
        <MsIcon v-if="opt.icon" :name="opt.icon" size="sm" color="none" />
        <span class="split-button__option-label">{{ opt.label }}</span>
        <MsIcon v-if="opt.active" name="check" color="none" class="split-button__check" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.split-button {
  display: inline-flex;
  position: relative;
}

/* ── shared base ── */
.split-button__main,
.split-button__arrow {
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  font-size: .82rem;
  transition: background .15s;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.split-button__main {
  border-radius: var(--rs) 0 0 var(--rs);
  padding: 6px 14px;
  gap: 4px;
  justify-content: center;
}

.split-button__arrow {
  border-radius: 0 var(--rs) var(--rs) 0;
  border-left: 1px solid rgba(255, 255, 255, .18);
  padding: 6px 6px;
}

.split-button__main:disabled,
.split-button__arrow:disabled {
  opacity: .5;
  cursor: not-allowed;
}

/* reset .ms vertical-align (designed for inline context, not flex) */
.split-button__main .ms,
.split-button__arrow .ms {
  vertical-align: 0;
}

/* ── primary ── */
.split-button--primary .split-button__main,
.split-button--primary .split-button__arrow {
  background: var(--ac);
  color: #fff;
}
.split-button--primary .split-button__main:hover:not(:disabled),
.split-button--primary .split-button__arrow:hover:not(:disabled) {
  background: var(--ac2);
}

/* ── danger ── */
.split-button--danger .split-button__main,
.split-button--danger .split-button__arrow {
  background: var(--red);
  color: #fff;
}
.split-button--danger .split-button__main:hover:not(:disabled),
.split-button--danger .split-button__arrow:hover:not(:disabled) {
  background: color-mix(in srgb, var(--red) 85%, #000);
}

/* ── success (darken --green for filled bg, raw #4ade80 is too bright for white text) ── */
.split-button--success .split-button__main,
.split-button--success .split-button__arrow {
  background: color-mix(in srgb, var(--green) 60%, #000);
  color: #fff;
}
.split-button--success .split-button__main:hover:not(:disabled),
.split-button--success .split-button__arrow:hover:not(:disabled) {
  background: color-mix(in srgb, var(--green) 50%, #000);
}

/* ── dropdown ── */
.split-button__dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
  min-width: 170px;
  z-index: 210;
  padding: 4px 0;
}

.split-button__option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font-size: .82rem;
  color: var(--t1);
  cursor: pointer;
  white-space: nowrap;
}

.split-button__option:hover {
  background: var(--bg4);
}

.split-button__option--active {
  color: var(--ac);
}

.split-button__option--disabled {
  opacity: .4;
  cursor: not-allowed;
}
.split-button__option--disabled:hover {
  background: transparent;
}

.split-button__option-label {
  flex: 1;
}

.split-button__check {
  font-size: 16px;
  margin-left: auto;
}

/* ── loading spin ── */
@keyframes split-button-spin {
  to { transform: rotate(360deg) }
}
.split-button__spin {
  animation: split-button-spin 1s linear infinite;
}
</style>
