<script setup lang="ts">
/**
 * PageHeader — 应用条。一行, 高度恒定 64px, 与 .sidebar-logo 同高,
 * 两者的底边线接成一条贯穿视口的横线。
 *
 * 承载三件事, 每件都有准入判据:
 *
 *   1. 身份 (title / launch)  标题永远存在, 不带图标 —— 侧栏高亮项已经指明了位置。
 *                             launch 是"打开这一页主体的原生界面", 目标必须是徽章
 *                             描述的、动作操作的同一个对象 (ComfyUI 页 → ComfyUI 本体)。
 *   2. 运行状态 (service)     三条同时满足才配进来:
 *                               ① 描述的是页面主体本身, 不是主体里装的东西
 *                               ② 是系统告诉你的, 不是你设定的
 *                               ③ 存在一个"坏"的取值, 需要你采取行动
 *                             全站只有 5 个服务页满足。
 *   3. 页级动作 (#actions)    作用对象必须是整个页面主体, 全站只有服务的启停重启。
 *                             刷新列表属于列表工具条, 切主题/换语言属于侧栏。
 *
 * 状态与链接都做成类型化 prop 而不是自由插槽 —— 自由插槽必然被塞进计数、统计之类的东西。
 * 分区导航 (tabs) 不在这里, 它在 .page-body 顶部: 那样左边缘固定贴 --page-pad、
 * 与下方内容对齐, 且移动端不需要另做一套结构。
 */
import { useAppStore } from '@/stores/app'
import MsIcon from '../ui/MsIcon.vue'
import Badge from '../ui/Badge.vue'

defineOptions({ name: 'PageHeader' })

export type ServiceStatus = 'running' | 'stopped' | 'error' | 'unconfigured'

const props = defineProps<{
  title: string
  /** 仅服务页传入; 不传则页头没有状态位 */
  service?: { status: ServiceStatus; label: string }
  /** 页面主体的原生界面; 解析不出地址时不要传, 标题就退回纯文本 */
  launch?: { href: string; label: string }
}>()

const app = useAppStore()

const TONE: Record<ServiceStatus, 'positive' | 'caution' | 'negative' | 'neutral'> = {
  running: 'positive',
  stopped: 'neutral',
  error: 'negative',
  unconfigured: 'caution',
}

const tone = () => TONE[props.service?.status ?? 'stopped']
</script>

<template>
  <div class="page-header">
    <button
      class="mobile-menu-btn"
      :aria-label="app.mobileSidebarOpen ? 'Close menu' : 'Open menu'"
      @click="app.toggleMobileSidebar()"
    >
      <MsIcon name="menu" size="md" />
    </button>

    <h1 class="page-header__title">
      <a
        v-if="launch"
        :href="launch.href"
        target="_blank"
        rel="noopener"
        :title="launch.label"
        class="page-header__launch"
      >{{ title }}<MsIcon name="open_in_new" size="xs" /></a>
      <template v-else>{{ title }}</template>
    </h1>

    <Badge v-if="service" :tone="tone()" dot>{{ service.label }}</Badge>

    <span class="page-header__spacer" />

    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-header__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -.015em;
  line-height: 1.2;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-header__launch {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: color .16s;
}

.page-header__launch:hover,
.page-header__launch:focus-visible {
  color: var(--ac);
}

.page-header__launch .ms {
  opacity: .6;
}

.page-header__launch:hover .ms {
  opacity: 1;
}

.page-header__spacer {
  flex: 1;
  min-width: var(--sp-3);
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .page-header__title {
    font-size: 1rem;
  }
}
</style>
