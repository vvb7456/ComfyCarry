<script setup lang="ts">

defineOptions({ name: 'WizardStepper' })

const props = defineProps<{
  total: number
  current: number
  labels?: string[]
}>()

const emit = defineEmits<{
  'click-step': [index: number]
}>()

function segmentClass(i: number) {
  if (i < props.current) return 'wizard-stepper__seg wizard-stepper__seg--done'
  if (i === props.current) return 'wizard-stepper__seg wizard-stepper__seg--active'
  return 'wizard-stepper__seg'
}

function onClick(i: number) {
  if (i < props.current) emit('click-step', i)
}
</script>

<template>
  <div class="wizard-stepper">
    <div
      v-for="i in total"
      :key="i - 1"
      :class="segmentClass(i - 1)"
      :title="labels?.[i - 1]"
      @click="onClick(i - 1)"
    />
  </div>
</template>

<style scoped>
.wizard-stepper {
  display: flex;
  gap: 6px;
}

.wizard-stepper__seg {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: var(--bg4);
  transition: background .3s;
}

.wizard-stepper__seg--done {
  background: var(--ac);
  cursor: pointer;
}

.wizard-stepper__seg--active {
  background: var(--ac2);
  animation: stepper-pulse 1.5s infinite;
}

@keyframes stepper-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}
</style>
