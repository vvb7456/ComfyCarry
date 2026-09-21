<script setup lang="ts">
/**
 * 内容区 (.settings-module__body) 内的行间 hairline 由 .settings-lines 承担。
 */
defineOptions({ name: 'SettingsModule', inheritAttrs: false })

withDefaults(defineProps<{
  title: string
}>(), {})
</script>

<template>
  <section class="settings-module" v-bind="$attrs">
    <div class="settings-module__head">
      <h3 class="settings-module__title">{{ title }}</h3>
    </div>
    <div class="settings-module__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-module__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}

.settings-module__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--t3);
}

.settings-module__body {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
}
</style>