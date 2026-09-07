<script setup lang="ts">
/**
 * SettingsGroup — 设置页 group 式分区容器。
 *
 * 结构 = 组头 (icon + 标题 + 可选 HelpTip + 右侧 collapse) + 行区。
 * 行区由调用方直接放 SettingsRow 式内容; 行间分隔线由本组件 CSS 承担
 * (相邻 .settings-row 之间 hairline)。组间留白由 settings-centered 列的
 * 组间距样式承担。
 */
import { ref } from 'vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'SettingsGroup' })

const props = withDefaults(defineProps<{
  icon?: string
  title?: string
  help?: string
  /** 可折叠; 默认展开 */
  collapsible?: boolean
}>(), {
  collapsible: false,
})

/** 默认展开 (v-model 由调用方持有); collapsed 只在 collapsible 时生效 */
const collapsed = ref(false)

function toggle() {
  if (!props.collapsible) return
  collapsed.value = !collapsed.value
}
</script>

<template>
  <section class="settings-group">
    <header
      v-if="icon || title || help || collapsible"
      class="settings-group__head"
      :class="{ 'settings-group__head--collapsible': collapsible }"
      @click="toggle"
    >
      <MsIcon v-if="icon" :name="icon" />
      <h3 class="settings-group__title">{{ title }}</h3>
      <HelpTip v-if="help" :text="help" />
      <span class="settings-group__spacer" />
      <button
        v-if="collapsible"
        type="button"
        class="settings-group__collapse"
        :class="{ 'settings-group__collapse--collapsed': collapsed }"
        :aria-expanded="!collapsed"
        @click.stop="toggle"
      >
        <MsIcon name="expand_more" size="sm" />
      </button>
    </header>
    <div v-show="!collapsed" class="settings-group__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  display: flex;
  flex-direction: column;
}

.settings-group__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--bd);
  user-select: none;
}

.settings-group__head > :deep(.ms) {
  font-size: 20px;
  color: var(--t2);
}

.settings-group__head--collapsible {
  cursor: pointer;
}

.settings-group__title {
  margin: 0;
  font-size: .95rem;
  font-weight: 600;
  color: var(--t1);
}

.settings-group__spacer {
  flex: 1;
}

.settings-group__collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--rs);
  background: none;
  color: var(--t3);
  cursor: pointer;
  transition: transform .2s ease, color .15s ease;
}

.settings-group__collapse:hover {
  color: var(--t1);
}

.settings-group__collapse--collapsed {
  transform: rotate(-90deg);
}

/* 行间 hairline: 相邻行 (含 .settings-row 类行与自定义块行) 之间 */
.settings-group__body > :deep(.settings-row + .settings-row),
.settings-group__body > :deep(* + *) {
  border-top: 1px solid color-mix(in srgb, var(--bd) 55%, transparent);
}
</style>