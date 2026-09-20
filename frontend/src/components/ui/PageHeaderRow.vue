<script setup lang="ts">
/**
 * PageHeaderRow — 页头行, 全站唯一页头实现 (汉堡唯一入口)。
 *
 * 宽屏单行:
 *   [汉堡|标题(+title-extra)] │ [default 主控件] [sub 次控件] ···空白··· [actions]
 *
 * 窄屏 (页头容器 <600px, 按可用宽而非设备宽判定; iPad Mini 竖屏 744px 仍单行):
 *   Row1: [汉堡|标题(+extra)] ···空白··· [actions]   ← 动作永不下放
 *   Row2: default 通栏 (有内容才出现)
 *   Row3: sub 通栏    (有内容才出现)
 *   分隔符随下放自动隐藏 (标题与控件不再相邻)。
 *
 * 插槽: title-extra(标题附属) / default(主控件, 触发分隔符) / sub(次控件) /
 *       actions(页面级动作, 贴右)。除 title 外全部可选, 纯标题页成立。
 *
 * 吸顶 (默认开): 负 margin 吃掉 .page-body 顶留白并补回自身 padding,
 * 标题距视口顶恒为 --page-body-pt (16~24px)。宿主自管吸顶时传 sticky=false
 * (PageTopStack 内), 仅复用行结构。
 *
 * 布局约束: 本组件及其祖先链禁加 transform/filter/will-change (吸顶背景走
 * background-attachment:fixed 与 .content 视口光晕对齐, transform 会让其退化
 * 为元素盒定位而错位首帧闪烁, 见 layout.css 吸顶注释)。
 */
import { computed, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import { useAppStore } from '@/stores/app'

defineOptions({ name: 'PageHeaderRow' })

withDefaults(defineProps<{
  /** 页面标题 (h1) */
  title: string
  /** 吸顶 (默认开); 宿主自管吸顶时传 false */
  sticky?: boolean
}>(), {
  sticky: true,
})

const { t } = useI18n({ useScope: 'global' })
const app = useAppStore()
const slots = useSlots()

/** 主控件段存在才有分隔符 (标题│主控件); 纯动作页无分隔符 */
const hasMain = computed(() => !!slots.default)
</script>

<template>
  <div class="page-header-row" :class="{ 'page-header-row--static': !sticky }">
    <div class="page-header-row__title">
      <button
        type="button"
        class="mobile-menu-btn"
        :aria-label="app.mobileSidebarOpen ? t('common.btn.close_menu') : t('common.btn.open_menu')"
        @click="app.toggleMobileSidebar()"
      >
        <MsIcon name="menu" />
      </button>
      <h1 class="page-title">{{ title }}</h1>
      <slot name="title-extra" />
    </div>
    <span v-if="hasMain" class="page-header-row__divider" aria-hidden="true" />
    <div v-if="hasMain" class="page-header-row__main"><slot /></div>
    <div v-if="$slots.sub" class="page-header-row__sub"><slot name="sub" /></div>
    <div v-if="$slots.actions" class="page-header-row__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.page-header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  /* 内容行恒定 38px (与 TabSwitcher 同基准): 页头高度不随 actions
     出现/消失跳动 (loading→loaded 标题"下沉"的根因), 标题/按钮在行内居中 */
  min-height: 38px;
  margin-bottom: var(--sp-4);
}

/* 吸顶: 负 margin 吃掉 .page-body 顶留白, padding 补回,
   标题距视口顶恒为 --page-body-pt (16~24px);
   min-height 按 border-box 算入上下 padding, 保证内容行仍是 38px */
.page-header-row:not(.page-header-row--static) {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg-ambient);
  background-attachment: fixed;
  margin-top: calc(-1 * var(--page-body-pt));
  padding-top: var(--page-body-pt);
  padding-bottom: 8px;
  min-height: calc(var(--page-body-pt) + 38px + 8px);
  mask-image: linear-gradient(to bottom, black calc(100% - 10px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 10px), transparent 100%);
}

.page-header-row__title {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.page-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -.015em;
  color: var(--t1);
  margin: 0;
  /* normal = 字体自身度量 (含上下伸部); 用 1 会让 y/p 等下行字母
     超出内容盒, 被 overflow:hidden (省略号) 裁掉 */
  line-height: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 标题与主控件之间的 1px 分隔符 (标题 | tabs/控件组) */
.page-header-row__divider {
  width: 1px;
  height: 16px;
  background: var(--bd);
  opacity: .8;
  flex-shrink: 0;
}

/* 主/次控件段: 段内排布与贴右由内容自理, 段自身可收缩 */
.page-header-row__main,
.page-header-row__sub {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* 动作组贴右: margin-left:auto 吸收行内剩余空白, 无需 spacer 元素;
   窄屏下放后仍把动作钉在 Row1 行尾 */
.page-header-row__actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  max-width: 100%;
  margin-left: auto;
}

/* ── 窄屏下放 (容器查询 .page-body <600px) ──
   order 把主/次控件排到动作之后, 各以 100% basis 独占一行;
   Row1 = 标题组 + actions (margin-left:auto 贴右)。
   段的直接子项 (tab 条/任务切换/选择器等) 一律拉满整行,
   段内更细的等分/滚动自适应由控件和页面自理。 */
@container page (max-width: 600px) {
  .page-header-row__divider {
    display: none;
  }

  .page-header-row__main,
  .page-header-row__sub {
    order: 2;
    flex-basis: 100%;
  }

  .page-header-row__main > :deep(*),
  .page-header-row__sub > :deep(*) {
    width: 100%;
  }
}

/* ── 汉堡 (≤768px 视口, 跟随侧栏显隐) ── */
.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  color: var(--t2);
  cursor: pointer;
  padding: 2px 4px;
  margin-left: -4px;
  border-radius: var(--r-xs, 4px);
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color .15s ease, background .15s ease;
  line-height: 1;
}

.mobile-menu-btn:hover {
  color: var(--t1);
  background: color-mix(in srgb, var(--t1) 6%, transparent);
}

.mobile-menu-btn :deep(.ms) {
  font-size: 20px;
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: inline-flex;
  }

  .page-header-row {
    gap: 8px;
  }

  .page-header-row:not(.page-header-row--static) {
    padding-bottom: 6px;
  }
}
</style>
