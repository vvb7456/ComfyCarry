<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import MsIcon from './MsIcon.vue'

const { items, remove } = useToast()

const iconMap: Record<string, string> = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
}
</script>

<template>
  <Teleport to="body">
    <TransitionGroup name="cc-toast" tag="div" class="cc-toast-wrap">
      <div v-for="item in items" :key="item.id" class="cc-toast" :class="`cc-toast--${item.type}`">
        <MsIcon :name="iconMap[item.type] || 'info'" class="cc-toast__icon" />
        <span class="cc-toast__msg">{{ item.message }}</span>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.cc-toast-wrap {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  z-index: 10000;
  pointer-events: none;
}

.cc-toast {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 10px var(--sp-4);
  border-radius: var(--r);
  font-size: var(--text-sm);
  background: var(--bg2);
  border: 1px solid var(--bd);
  box-shadow: var(--sh);
  pointer-events: auto;
  max-width: 420px;
  white-space: nowrap;
}
.cc-toast--success { border-color: var(--green); color: var(--green); }
.cc-toast--error   { border-color: var(--red); color: var(--red); }
.cc-toast--warning { border-color: var(--amber); color: var(--amber); }
.cc-toast--info    { color: var(--t1); }

.cc-toast__icon { flex-shrink: 0; }
.cc-toast__msg  { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

/* TransitionGroup animation */
.cc-toast-enter-active,
.cc-toast-leave-active { transition: all .25s ease; }
.cc-toast-enter-from   { opacity: 0; transform: translateY(10px); }
.cc-toast-leave-to     { opacity: 0; transform: translateY(-10px) scale(.95); }
.cc-toast-move         { transition: transform .25s ease; }
</style>
