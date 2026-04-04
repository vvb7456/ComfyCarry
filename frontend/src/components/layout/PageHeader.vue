<script setup lang="ts">
/**
 * PageHeader — 复用的页面头部组件
 *
 * 与旧前端 core.js 的行为完全一致：
 * - mobile-menu-btn 在 header 最前面 (768px 以下显示)
 * - page-title-group 在左侧 (icon + title + 可选 badge slot)
 * - top-toolbar 在右侧 (可选 controls slot + theme toggle 始终在最末尾)
 */
import { useAppStore } from '@/stores/app'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import MsIcon from '../ui/MsIcon.vue'

defineOptions({ name: 'PageHeader' })

defineProps<{
  icon: string
  iconColor?: string
  title: string
}>()

const app = useAppStore()
</script>

<template>
  <div class="page-header">
    <button class="mobile-menu-btn" @click="app.toggleMobileSidebar()">
      <MsIcon name="menu" size="md" />
    </button>
    <div class="page-header__main">
      <div class="page-title-group">
        <h2 class="page-header__title"><MsIcon :name="icon" :color="iconColor" size="md" /> {{ title }}</h2>
        <slot name="badge" />
      </div>
      <div class="top-toolbar">
        <slot name="controls" />
        <ThemeToggle />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.page-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.page-header__title {
  margin: 0;
  display: inline-flex;
  align-items: center;
  line-height: 1.1;
  white-space: nowrap;
}

.top-toolbar {
  flex-shrink: 0;
}
</style>
