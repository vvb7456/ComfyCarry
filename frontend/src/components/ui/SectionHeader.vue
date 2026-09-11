<script setup lang="ts">
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'SectionHeader' })

const props = withDefaults(defineProps<{
  icon?: string
  flush?: boolean
  align?: 'left' | 'center'
  withLines?: boolean
  /** 可折叠: 标题行整体可点, 最右显示折叠箭头; 展开状态由父级 v-model:expanded 控制 */
  collapsible?: boolean
  /** 展开状态 (v-model:expanded); 仅 collapsible 时使用 */
  expanded?: boolean
}>(), {
  expanded: true,
})

const emit = defineEmits<{
  'update:expanded': [value: boolean]
}>()

function toggle() {
  if (props.collapsible) emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div
    class="section-header"
    :class="[
      { 'section-header--flush': flush, 'section-header--with-lines': withLines, 'section-header--collapsible': collapsible },
      `section-header--align-${align ?? 'left'}`,
    ]"
    :role="collapsible ? 'button' : undefined"
    :tabindex="collapsible ? 0 : undefined"
    :aria-expanded="collapsible ? expanded : undefined"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <div class="section-title">
      <MsIcon v-if="icon" :name="icon" />
      <slot />
      <MsIcon
        v-if="collapsible"
        name="expand_more"
        class="section-header__chevron"
        :class="{ 'section-header__chevron--collapsed': !expanded }"
      />
    </div>
    <div v-if="$slots.actions" class="section-header__actions" @click.stop>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  margin-bottom: 12px;
}

.section-header--flush {
  margin-top: 0;
}

.section-header--align-center {
  justify-content: center;
  text-align: center;
}

.section-header--align-center.section-header--with-lines {
  position: relative;
  gap: var(--sp-4);
}

.section-header--align-center.section-header--with-lines::before,
.section-header--align-center.section-header--with-lines::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--bd);
  max-width: 240px;
}

.section-header--align-center .section-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--t1);
}

.section-header--align-center .section-title :deep(.ms) {
  font-size: 26px;
}

.section-header--align-center .section-header__actions {
  margin-left: 0;
}

.section-title {
  font-size: .95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title :deep(.ms) {
  font-size: 22px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 22;
}

.section-header__actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}

/* 折叠态: 标题行可点; 箭头内联跟在标题/计数之后 (不占右侧) */
.section-header--collapsible {
  cursor: pointer;
  border-radius: var(--r-sm);
  transition: color .15s ease;
}

.section-header--collapsible:hover .section-title {
  color: var(--t1);
}

.section-header__chevron {
  flex: none;
  font-size: 18px;
  color: var(--t3);
  transition: transform .2s ease, color .15s ease;
}

.section-header--collapsible:hover .section-header__chevron {
  color: var(--t1);
}

.section-header__chevron--collapsed {
  transform: rotate(-90deg);
}
</style>
