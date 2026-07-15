<script setup lang="ts">
// HelpTip — small "?" trigger that shows a tooltip on hover/click.
//
// Tooltip is rendered via Teleport to <body> with position:fixed so it
// is never clipped by ancestor overflow (e.g. modal-body's overflow-y:auto)
// and never causes layout shift on hover.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

defineOptions({ name: 'HelpTip' })

defineProps<{ text: string }>()

const open = ref(false)
const hovering = ref(false)
const trigger = ref<HTMLElement>()
const tipPos = ref<{ top: number; left: number; placement: 'top' | 'bottom' }>({
  top: 0, left: 0, placement: 'top',
})

const visible = computed(() => open.value || hovering.value)

const TIP_MAX_WIDTH = 280
const GAP = 8

function recalcPosition() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const vw = window.innerWidth
  // Prefer above; flip below if no room
  const placement = rect.top > 80 ? 'top' : 'bottom'
  const left = Math.min(
    Math.max(8, rect.left),
    vw - TIP_MAX_WIDTH - 8,
  )
  const top = placement === 'top'
    ? rect.top - GAP
    : rect.bottom + GAP
  tipPos.value = { top, left, placement }
}

async function show() {
  hovering.value = true
  await nextTick()
  recalcPosition()
}

function hide() {
  hovering.value = false
}

function toggle(e: Event) {
  e.stopPropagation()
  open.value = !open.value
  if (open.value) void show()
}

function onDocClick(e: Event) {
  if (trigger.value && !trigger.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onScroll() {
  if (visible.value) recalcPosition()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <span
    ref="trigger"
    class="cc-help-tip"
    :class="{ open: visible }"
    @click="toggle"
    @mouseenter="show"
    @mouseleave="hide"
  >?</span>
  <Teleport to="body">
    <div
      v-if="visible"
      class="cc-help-tip-pop"
      :class="{ 'pop-top': tipPos.placement === 'top', 'pop-bottom': tipPos.placement === 'bottom' }"
      :style="{ top: tipPos.top + 'px', left: tipPos.left + 'px' }"
    >{{ text }}</div>
  </Teleport>
</template>

<style scoped>
.cc-help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bd);
  color: var(--t3);
  font-size: .65rem;
  cursor: help;
  flex-shrink: 0;
  vertical-align: middle;
  margin-left: 4px;
}
</style>

<style>
/* Unscoped so the teleported popup picks up the styles. */
.cc-help-tip-pop {
  position: fixed;
  background: var(--bg-in);
  border: 1px solid var(--bd);
  color: var(--t1);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: .72rem;
  line-height: 1.4;
  white-space: pre-line;
  width: max-content;
  max-width: 280px;
  z-index: 10000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, .25);
  pointer-events: none;
}
.cc-help-tip-pop.pop-top {
  transform: translateY(-100%);
}
</style>
