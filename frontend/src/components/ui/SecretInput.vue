<script setup lang="ts">
import { computed, getCurrentInstance, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  displayValue?: string
  copyValue?: string
  revealed?: boolean
  placeholder?: string
  readonly?: boolean
  disabled?: boolean
  autocomplete?: string
  isPassword?: boolean
  copyable?: boolean
  toggleable?: boolean
  inputClass?: string
  inputStyle?: string | Record<string, string>
  maskedLength?: number
}>(), {
  modelValue: '',
  displayValue: '',
  copyValue: '',
  placeholder: '',
  readonly: false,
  disabled: false,
  autocomplete: 'off',
  isPassword: false,
  copyable: false,
  toggleable: true,
  maskedLength: 24,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:revealed': [value: boolean]
  copied: [value: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const instance = getCurrentInstance()

const internalRevealed = ref(false)
const isControlled = computed(() => {
  const rawProps = instance?.vnode.props ?? {}
  return Object.prototype.hasOwnProperty.call(rawProps, 'revealed')
    || Object.prototype.hasOwnProperty.call(rawProps, 'onUpdate:revealed')
})

const isRevealed = computed({
  get() {
    return isControlled.value ? !!props.revealed : internalRevealed.value
  },
  set(value: boolean) {
    internalRevealed.value = value
    emit('update:revealed', value)
  },
})

const actualValue = computed(() => props.displayValue || props.modelValue || '')
const copyText = computed(() => props.copyValue || actualValue.value)
const hiddenReadonlyMask = computed(() => '•'.repeat(Math.max(1, props.maskedLength)))

const inputType = computed(() => {
  if (props.isPassword && !isRevealed.value) return 'password'
  return 'text'
})

const inputValue = computed(() => {
  if (props.readonly && !props.isPassword && !isRevealed.value) {
    return hiddenReadonlyMask.value
  }
  return actualValue.value
})

const shouldUseTextMask = computed(() => !props.isPassword && !props.readonly && !isRevealed.value)
const hasSingleAction = computed(() => !!props.toggleable !== !!props.copyable)

const fieldClasses = computed(() => {
  const classes = ['form-input', 'secret-input__field']
  if (shouldUseTextMask.value) classes.push('secret-input__field--masked')
  if (props.inputClass) classes.push(props.inputClass)
  return classes
})

const rootClasses = computed(() => [
  'secret-input',
  {
    'secret-input--single-action': hasSingleAction.value,
  },
])

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function toggleVisibility() {
  isRevealed.value = !isRevealed.value
}

async function copySecret() {
  if (!copyText.value) return
  try {
    await navigator.clipboard.writeText(copyText.value)
    emit('copied', copyText.value)
  } catch {
    // ignore clipboard failures to preserve old behavior
  }
}
</script>

<template>
  <div :class="rootClasses">
    <input
      :type="inputType"
      :value="inputValue"
      :placeholder="placeholder"
      :readonly="readonly"
      :disabled="disabled"
      :autocomplete="autocomplete"
      :class="fieldClasses"
      :style="inputStyle"
      @input="onInput"
    />
    <button
      v-if="toggleable"
      type="button"
      class="secret-input__btn secret-input__btn--toggle"
      :title="isRevealed ? t('common.btn.hide') : t('common.btn.show')"
      @click="toggleVisibility"
    >
      <MsIcon :name="isRevealed ? 'visibility_off' : 'visibility'" size="sm" />
    </button>
    <button
      v-if="copyable"
      type="button"
      class="secret-input__btn secret-input__btn--copy"
      :title="t('common.btn.copy')"
      @click="copySecret"
    >
      <MsIcon name="content_copy" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.secret-input {
  position: relative;
  display: flex;
  align-items: center;
}

.secret-input__field {
  flex: 1;
  padding-right: 60px;
}

.secret-input--single-action .secret-input__field {
  padding-right: 32px;
}

.secret-input__field--masked {
  -webkit-text-security: disc;
  text-security: disc;
}

.secret-input__btn {
  position: absolute;
  background: none;
  border: none;
  color: var(--t3);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  opacity: .5;
}

.secret-input__btn--toggle {
  right: 28px;
}

.secret-input__btn--copy {
  right: 4px;
}

.secret-input--single-action .secret-input__btn--toggle {
  right: 4px;
}

.secret-input__btn:hover {
  color: var(--t1);
  opacity: 1;
}
</style>
