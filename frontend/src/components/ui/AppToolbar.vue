<script setup lang="ts">
defineOptions({ name: 'AppToolbar' })

withDefaults(defineProps<{
  /**
   * 视觉形态:
   * - 'page': 页面级工具栏 (默认; 底部留白 12px, 常配合 Teleport 进 PageTopStack 吸顶)
   * - 'embedded': 内嵌面板 (较小留白, 用于折叠卡 / 抽屉内的局部工具条)
   */
  variant?: 'page' | 'embedded'
  /** search 段占满整行剩余空间 (Civitai 远程检索形态, 配合 SearchInput / FilterInput 的 full) */
  searchFull?: boolean
}>(), {
  variant: 'page',
  searchFull: false,
})
</script>

<template>
  <div
    class="app-toolbar"
    :class="[`app-toolbar--${variant}`, { 'app-toolbar--search-full': searchFull }]"
  >
    <div v-if="$slots.search" class="app-toolbar__search"><slot name="search" /></div>
    <div v-if="$slots.status" class="app-toolbar__status"><slot name="status" /></div>
    <div v-if="$slots.filters" class="app-toolbar__filters"><slot name="filters" /></div>
    <div v-if="$slots.actions" class="app-toolbar__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
/* ── 布局契约 (PageHeaderRow 哲学在数据操作层的延伸) ─────────────────
   宽屏单行: [search] [status] ···空白··· [filters] [actions]
   - 左侧是主操作 (搜索框 + 只读统计), 右侧聚合维度过滤与动作按钮,
     中间大段留白凸显 input 的主操作地位

   右侧组内部顺序 (全站统一, 从视图到功能):
     [维度筛选下拉] → [刷新 (icon-only ghost)] → [主行动按钮] → [设置]
   - 筛选改"我看到什么", 贴近左侧查询域
   - 刷新重新拉数据, 轻量的 icon 做视图组与动作组的分界
   - 主行动 (如安装) 是最右的终结点, 符合"最右即主操作"惯例
   - Civitai 例外: 筛选触发器语义属 filters, 但因移动端单行要求
     放在 actions 槽首位, 视觉位置与规范一致
   - 容器 <840px: status 整体隐藏 (静态计数不值得在中窄屏占宽)
   - 容器 <600px: 严格重组为两行, 红线是绝不产生第三行 ——
       Row 1: search 占满 + actions 贴右 (label 收缩为纯图标, ghost 化)
       Row 2: filters 通栏, 子项等分
   - actions 契约: 按钮必须写成 图标 + <span class="app-toolbar__label">文字</span>,
     窄屏由容器查询统一隐藏 label 并 ghost 化 (BaseButton 头注释登记的体系例外)
   - 行高恒定 min-height 36px: 按钮出现 / 消失不引起行高跳动 (同 PageHeaderRow)
   ─────────────────────────────────────────────────────────────────── */
.app-toolbar {
  container: toolbar / inline-size;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  min-height: 36px;
  box-sizing: border-box;
}

.app-toolbar--page {
  margin-bottom: 12px;
}

.app-toolbar--embedded {
  margin-bottom: 10px;
}

/* 查询域: 输入框宽度基线由 FilterInput / SearchInput 自带
   (--ctl-w-md 320 / --ctl-w-lg 420), 段只负责弹性收缩 */
.app-toolbar__search {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
}

.app-toolbar--search-full .app-toolbar__search {
  flex: 1 1 auto;
}

.app-toolbar__status {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--t2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 维度过滤贴右聚合, 与 actions 连成右侧控制组;
   searchFull 形态 (Civitai 无 filters) 下由 search 的 flex:1 把 actions 推到最右 */
.app-toolbar__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  margin-left: auto;
}

/* 下拉保持紧凑 (fit 的 min-width 走此变量), 与 320px 的 input 拉开主次对比 */
.app-toolbar__filters :deep(.base-select) {
  --ctl-w-sm: 128px;
}

.app-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

/* ── 容器 <840px: 静态计数让位 ── */
@container toolbar (max-width: 840px) {
  .app-toolbar__status {
    display: none;
  }
}

/* ── 容器 <600px: 两行重组 ── */
@container toolbar (max-width: 600px) {
  .app-toolbar__search {
    order: 1;
    flex: 1 1 auto;
    min-width: 0;
  }

  .app-toolbar__actions {
    order: 2;
  }

  /* actions 契约: label 隐藏, 按钮 ghost 化为纯图标并与 input 同高 (36px) */
  .app-toolbar__actions :deep(.app-toolbar__label) {
    display: none;
  }

  .app-toolbar__actions :deep(.base-btn) {
    padding-inline: 0;
    min-width: 42px;
    min-height: 36px;
    justify-content: center;
    border-color: transparent;
    background: transparent;
  }

  .app-toolbar__filters {
    order: 3;
    flex-basis: 100%;
    margin-left: 0;
  }

  /* filters 子项等分填满 (两个下拉各 50%), 绝不掉第三行 */
  .app-toolbar__filters > :deep(*) {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
