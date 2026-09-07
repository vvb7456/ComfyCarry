<script setup lang="ts">
/**
 * SettingsModule — 设置模块头 + 内容容器 (单页 v3 视觉规则)。
 *
 * 模块 = 保存边界 = 正文中唯一的标题层级 (L2; L1 分区标题在 SettingsPage,
 * 行 label 自足, 无三级小节)。规则:
 *   - 头部低对比度大字 (1rem/600/--t3, 用户终选), 无 icon, 恒贴左对齐——
 *     "灰大字"介于 L1 (1.15rem/700/--t1 居中) 与行 label (0.9rem/--t1) 之间,
 *     灰度表达"模块名是注解", 字号表达"仍是标题"; 左缘对齐表达归属;
 *   - 非 dirty: 纯 kicker 一行, 无按钮残留;
 *   - dirty: 标题左侧浮现状态点 (绝对定位不占位, 不挤占左对齐), 右侧浮现「保存」;
 *   - 无「放弃」按钮 (低频操作走离开守卫的「放弃并离开」路径)。
 * 内容区 (.settings-module__body) 内的行间 hairline 由 .settings-lines 承担。
 */
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'

defineOptions({ name: 'SettingsModule', inheritAttrs: false })

const { t } = useI18n({ useScope: 'global' })

withDefaults(defineProps<{
  /** 模块名 (自解释的模块全名, 见命名规则) */
  title: string
  dirty?: boolean
  /** 保存请求进行中 (按钮 loading) */
  saving?: boolean
  /** 加载/出错等不可操作状态 (保存禁用) */
  disabled?: boolean
}>(), {
  dirty: false,
  saving: false,
  disabled: false,
})

defineEmits<{
  save: []
}>()
</script>

<template>
  <section class="settings-module" v-bind="$attrs">
    <div class="settings-module__head" :class="{ 'settings-module__head--dirty': dirty }">
      <h3 class="settings-module__title">{{ title }}</h3>
      <span class="settings-module__spacer" />
      <BaseButton
        v-if="dirty"
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="disabled"
        @click="$emit('save')"
      >
        {{ t('common.btn.save') }}
      </BaseButton>
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
  /* dirty 状态点: 左侧浮现, 绝对定位不占位 (标题恒贴左 0) */
  position: relative;
}

.settings-module__head::before {
  content: '';
  position: absolute;
  left: -15px;
  top: 50%;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transform: translateY(-50%);
  background: transparent;
  transition: background .2s ease;
}

.settings-module__head--dirty::before {
  background: var(--c-caution, #e8a33d);
}

.settings-module__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--t3);
  transition: color .2s ease;
}

/* dirty: 标题抬亮一档, 与状态点/按钮构成反馈 */
.settings-module__head--dirty .settings-module__title {
  color: var(--t2);
}

.settings-module__spacer {
  flex: 1;
}
</style>