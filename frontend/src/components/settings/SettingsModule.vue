<script setup lang="ts">
/**
 * SettingsModule — 设置模块头 + 内容容器。
 *
 * 模块 = 正文的标题层级 (灰大字 kicker, 左对齐): "灰大字"介于页标题与
 * 行 label 之间 —— 灰度表达"模块名是注解", 字号表达"仍是标题"。
 * 内容区 (.settings-module__body) 内的行间 hairline 由 .settings-lines 承担。
 * (原 dirty 浮现保存已随设置域迁出而移除; 剩余模块均为即时动作, 无草稿态。
 *  标题结构保留, 供设置行体系 (.settings-lines / .settings-row) 的宿主复用。)
 */
defineOptions({ name: 'SettingsModule', inheritAttrs: false })

withDefaults(defineProps<{
  /** 模块名 (自解释的模块全名) */
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