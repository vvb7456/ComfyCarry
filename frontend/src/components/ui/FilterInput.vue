<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n({ useScope: 'global' })
const model = defineModel<string>({ default: '' })

withDefaults(defineProps<{
  placeholder?: string
  clearable?: boolean
}>(), {
  placeholder: '',
  clearable: true,
})
</script>

<template>
  <div class="filter-input">
    <span class="ms filter-input__icon">search</span>
    <input
      v-model="model"
      type="text"
      class="form-input filter-input__field"
      :placeholder="placeholder || t('common.filter')"
    >
    <button
      v-if="clearable && model"
      class="filter-input__clear"
      @click="model = ''"
    >
      <span class="ms">close</span>
    </button>
  </div>
</template>

<style scoped>
.filter-input {
  position: relative;
  display: flex;
  align-items: center;
}

.filter-input__icon {
  position: absolute;
  left: 10px;
  font-size: 18px;
  color: var(--t3);
  pointer-events: none;
}

.filter-input__field {
  padding-left: 34px;
  padding-right: 32px;
}

.filter-input__clear {
  position: absolute;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  padding: 0;
}

.filter-input__clear:hover {
  background: var(--bg3);
  color: var(--t2);
}

.filter-input__clear .ms {
  font-size: 16px;
}
</style>
