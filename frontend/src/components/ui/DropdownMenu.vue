<script setup lang="ts">
/**
 * DropdownMenu — Teleport 锚定弹层下拉菜单 (规格 v3 / C1-C5 重做)。
 *
 * 特性:
 *  - Teleport 到 body, 无全屏遮罩, 点击外部/ESC 关闭
 *  - 定位: floating-ui, **transform: false** (用 top/left 避免与 Transition transform 冲突)
 *    (C1: 修"从左上角飞入" bug — 默认 transform 定位与动画 transform 冲突)
 *  - 入场动画 = 锚点起源 scale(0.98→1)+opacity+translateY, origin 按 placement 推导 (C1)
 *  - 二级交互 = 下钻式 (C2): 点击父行 → 面板内容横滑切换为子视图
 *    (顶部"‹ 返回 + 父组名", 下方列 children); 移除内联折叠
 *  - 打开时若选中 key 在某组 children → 直接进入该组子视图
 *  - 触发器闭合态 ↑/↓ 直接在叶子项扁平序列中循环切换, 不展开菜单 (C3)
 *  - hover 高亮 (次级底色) 与键盘高亮 (底色 + 左 2px accent 竖条) 视觉区分 (C4)
 *  - logo 暗色适配: logoInvertDark=true 时暗色主题 filter: invert(1), 底板透明 (C5)
 *  - 键盘: ↑/↓ 移动高亮; Enter 叶子=选中 / 父行=下钻; 子视图 ArrowLeft/Backspace=返回;
 *    Escape=关闭 (任何层级)
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFloating, autoUpdate, offset, flip, shift, size as floatingSize } from '@floating-ui/vue'
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'DropdownMenu' })

export interface DropdownMenuItem {
  key: string
  label: string
  /** 图片资源 URL; 与 letter 二选一 */
  logo?: string
  /** 暗色主题下 logo 反色 (纯黑单色 logo); C5: filter: invert(1) + 底板透明 */
  logoInvertDark?: boolean
  /** logo 缺省时字母徽章字符 (1-2 字符) */
  letter?: string
  /** 说明性小字 (可选, 单行, 次要色) */
  hint?: string
  /** 二级子项 (C2: 下钻式子视图) */
  children?: DropdownMenuItem[]
}

const props = defineProps<{
  items: DropdownMenuItem[]
  /** 当前选中 key (可能是子项 key) */
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'close': []
}>()

const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const open = ref(false)

// ── 当前视图: 'root' | 父组 key (C2 下钻式) ──
const currentView = ref<string>('root')

/** 当前视图对应的行 (root → 顶级 items; 子视图 → 父组的 children) */
const viewRows = computed<DropdownMenuItem[]>(() => {
  if (currentView.value === 'root') return props.items
  const parent = props.items.find(it => it.key === currentView.value)
  return parent?.children || []
})

/** 当前视图的父组 (root → null) */
const currentParent = computed<DropdownMenuItem | null>(() => {
  if (currentView.value === 'root') return null
  return props.items.find(it => it.key === currentView.value) || null
})

// ── 选中 key 所属的父组 key (若选中在某个 children 内) ──
const selectedParentKey = computed<string | null>(() => {
  for (const it of props.items) {
    if (it.children && it.children.some(c => c.key === props.modelValue)) {
      return it.key
    }
  }
  return null
})

// ── 叶子扁平序列 (C3: 触发器闭合态 ↑/↓ 在此循环) ──
const flatLeaves = computed<DropdownMenuItem[]>(() => {
  const out: DropdownMenuItem[] = []
  for (const it of props.items) {
    if (it.children && it.children.length) {
      out.push(...it.children)
    } else {
      out.push(it)
    }
  }
  return out
})

// ── 定位 (floating-ui, C1: transform: false) ──
const { floatingStyles, placement } = useFloating(triggerRef, panelRef, {
  open,
  placement: 'bottom-start',
  strategy: 'fixed',
  transform: false,  // C1: 用 top/left 定位, 避免 transform 与 Transition 冲突
  middleware: [
    offset(8),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
    floatingSize({
      padding: 8,
      apply({ availableHeight, elements }) {
        const max = Math.max(200, availableHeight)
        elements.floating.style.setProperty('--dd-menu-max', `${max}px`)
      },
    }),
  ],
  whileElementsMounted: autoUpdate,
})

// 当前实际 placement (含 flip 后), 用于推导 transform-origin (C1)
const resolvedPlacement = ref(placement.value)
watch(placement, (v) => { resolvedPlacement.value = v })

/** transform-origin 按实际 placement 推导 (C1):
 *  bottom-start → top left; 翻转后 top-start → bottom left; 右侧对齐 → 右 */
const originClass = computed(() => {
  const p = resolvedPlacement.value
  if (p.startsWith('bottom')) return p.endsWith('end') ? 'dd-origin-bottom-end' : 'dd-origin-bottom-start'
  if (p.startsWith('top')) return p.endsWith('end') ? 'dd-origin-top-end' : 'dd-origin-top-start'
  return 'dd-origin-bottom-start'
})

// ── 打开/关闭 ──
function openMenu() {
  open.value = true
  // C2: 若选中 key 在某组 children 内 → 直接进入该组子视图 (定位选中项)
  currentView.value = selectedParentKey.value || 'root'

  // 焦点 + 高亮到当前选中项
  nextTick(() => {
    const idx = viewRows.value.findIndex(r => r.key === props.modelValue)
    highlightIdx.value = idx >= 0 ? idx : 0
    nextTick(() => scrollToHighlighted())
  })
}

function closeMenu() {
  if (!open.value) return
  open.value = false
  emit('close')
}

function toggle() {
  if (open.value) closeMenu()
  else openMenu()
}

// ── 选择 / 下钻 / 返回 (C2) ──
function selectLeaf(item: DropdownMenuItem) {
  emit('update:modelValue', item.key)
  closeMenu()
}

function drillIn(parent: DropdownMenuItem) {
  currentView.value = parent.key
  highlightIdx.value = 0
  nextTick(() => scrollToHighlighted())
}

function drillBack() {
  currentView.value = 'root'
  // 高亮回到该父组行
  const idx = props.items.findIndex(it => it.key === currentParent.value?.key)
  highlightIdx.value = idx >= 0 ? idx : 0
  nextTick(() => scrollToHighlighted())
}

// ── 键盘导航 (C2/C3/C4) ──
const highlightIdx = ref(-1)
// hover 与键盘高亮分离 (C4): hoverIdx = 鼠标停留行; highlightIdx = 键盘高亮行
const hoverIdx = ref(-1)

function onTriggerKeydown(e: KeyboardEvent) {
  // C3: 菜单关闭且触发器聚焦时, ↑/↓ 直接在叶子扁平序列循环切换, 不展开菜单
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const leaves = flatLeaves.value
      if (!leaves.length) return
      const curIdx = leaves.findIndex(l => l.key === props.modelValue)
      const next = e.key === 'ArrowDown'
        ? (curIdx < 0 ? 0 : (curIdx + 1) % leaves.length)
        : (curIdx < 0 ? leaves.length - 1 : (curIdx - 1 + leaves.length) % leaves.length)
      emit('update:modelValue', leaves[next].key)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
      return
    }
    return
  }
  handleKeydown(e)
}

function onPanelKeydown(e: KeyboardEvent) {
  handleKeydown(e)
}

function handleKeydown(e: KeyboardEvent) {
  if (!open.value) return
  const rows = viewRows.value
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault()
      highlightIdx.value = (highlightIdx.value + 1) % rows.length
      scrollToHighlighted()
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      highlightIdx.value = (highlightIdx.value - 1 + rows.length) % rows.length
      scrollToHighlighted()
      break
    }
    case 'Enter':
    case ' ': {
      e.preventDefault()
      const row = rows[highlightIdx.value]
      if (!row) break
      if (row.children && row.children.length) drillIn(row)
      else selectLeaf(row)
      break
    }
    case 'ArrowLeft':
    case 'Backspace': {
      // C2: 子视图内 ArrowLeft/Backspace = 返回一级
      if (currentView.value !== 'root') {
        e.preventDefault()
        drillBack()
      }
      break
    }
    case 'Escape': {
      e.preventDefault()
      closeMenu()
      nextTick(() => triggerRef.value?.focus())
      break
    }
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    panelRef.value?.querySelector('.dd-row--kb')?.scrollIntoView({ block: 'nearest' })
  })
}

function onRowMouseEnter(idx: number) {
  hoverIdx.value = idx
  // 鼠标进入不抢占键盘高亮 (C4: 两者分离)
}

function onRowMouseLeave() {
  hoverIdx.value = -1
}

// ── 点击外部关闭 ──
function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerRef.value?.contains(t)) return
  if (panelRef.value?.contains(t)) return
  closeMenu()
}

onMounted(() => {
  document.addEventListener('click', onClickOutside, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside, true)
})

// 视图切换 / 高亮变化时保持滚动同步
watch(highlightIdx, () => scrollToHighlighted())

// 视图切换时重置 hover
watch(currentView, () => { hoverIdx.value = -1 })

defineExpose({ openMenu, closeMenu })
</script>

<template>
  <div class="dd-menu" @keydown="onTriggerKeydown">
    <!-- 触发器: 默认 slot, 提供 open/toggle slot props -->
    <div ref="triggerRef" @click="toggle">
      <slot :open="open" :toggle="toggle" />
    </div>

    <Teleport to="body">
      <Transition name="dd-pop">
        <div
          v-if="open"
          ref="panelRef"
          class="dd-panel"
          :class="originClass"
          :style="floatingStyles"
          role="listbox"
          tabindex="-1"
          @keydown="onPanelKeydown"
        >
          <!-- 子视图返回行 (C2): 仅 currentView !== 'root' 显示 -->
          <div
            v-if="currentView !== 'root' && currentParent"
            class="dd-row dd-row--back"
            :class="{ 'dd-row--kb': highlightIdx === -1 }"
            @click="drillBack"
            @mouseenter="onRowMouseEnter(-1)"
            @mouseleave="onRowMouseLeave"
            role="button"
          >
            <MsIcon name="arrow_back" size="xs" color="var(--t2)" />
            <span class="dd-row__label">{{ currentParent.label }}</span>
          </div>

          <!-- 视图内容 (横滑切换 C2): root 与子视图共用 max-height, 各自滚动 -->
          <Transition :name="'dd-slide-' + (currentView === 'root' ? 'back' : 'in')" mode="out-in">
            <div :key="currentView" class="dd-list">
              <template v-for="(row, idx) in viewRows" :key="row.key">
                <!-- 父行: 下钻 (C2) -->
                <div
                  v-if="row.children && row.children.length"
                  class="dd-row dd-row--parent"
                  :class="{
                    'dd-row--kb': idx === highlightIdx,
                    'dd-row--hover': idx === hoverIdx,
                  }"
                  @click="drillIn(row)"
                  @mouseenter="onRowMouseEnter(idx)"
                    @mouseleave="onRowMouseLeave"
                    role="group"
                >
                  <div class="dd-logo" :class="{ 'dd-logo--pad': row.logo, 'dd-logo--invert-dark': row.logoInvertDark }">
                    <img v-if="row.logo" :src="row.logo" :alt="row.label" class="dd-logo__img" />
                    <span v-else class="dd-logo__letter">{{ row.letter || row.label.charAt(0) }}</span>
                  </div>
                  <span class="dd-row__label">{{ row.label }}</span>
                  <span class="dd-row__right">
                    <span v-if="row.hint" class="dd-row__hint">{{ row.hint }}</span>
                    <MsIcon
                      name="chevron_right"
                      size="xs"
                      color="var(--t3)"
                      class="dd-row__chevron"
                    />
                  </span>
                </div>

                <!-- 叶子行 (一级或子视图共用) -->
                <div
                  v-else
                  class="dd-row dd-row--leaf"
                  :class="{
                    'dd-row--sel': row.key === modelValue,
                    'dd-row--kb': idx === highlightIdx,
                    'dd-row--hover': idx === hoverIdx,
                  }"
                  @click="selectLeaf(row)"
                  @mouseenter="onRowMouseEnter(idx)"
                    @mouseleave="onRowMouseLeave"
                    role="option"
                    :aria-selected="row.key === modelValue"
                >
                  <div class="dd-logo" :class="{ 'dd-logo--pad': row.logo, 'dd-logo--invert-dark': row.logoInvertDark }">
                    <img v-if="row.logo" :src="row.logo" :alt="row.label" class="dd-logo__img" />
                    <span v-else class="dd-logo__letter">{{ row.letter || row.label.charAt(0) }}</span>
                  </div>
                  <span class="dd-row__label">{{ row.label }}</span>
                  <span v-if="row.hint" class="dd-row__hint">{{ row.hint }}</span>
                  <span class="dd-row__right">
                    <span class="dd-row__check-slot">
                      <MsIcon v-if="row.key === modelValue" name="check" size="xs" color="var(--ac)" class="dd-row__check" />
                    </span>
                  </span>
                </div>
              </template>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dd-menu {
  display: inline-block;
}

.dd-panel {
  position: fixed;  /* strategy: fixed + transform:false → top/left 定位 (C1) */
  top: 0;
  left: 0;
  z-index: 1000;
  min-width: 240px;
  max-width: 360px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  box-shadow: var(--sh);
  overflow: hidden;
  --dd-menu-max: 360px;
}

.dd-list {
  max-height: var(--dd-menu-max, 360px);
  overflow-y: auto;
  padding: var(--sp-1);
}

/* ── 行 (通用) ── */
.dd-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 8px;
  cursor: pointer;
  border-radius: var(--rs);
  user-select: none;
  position: relative;
  min-width: 0;
}

.dd-row--leaf {
  font-size: var(--text-base);
  color: var(--t2);
}

/* C4: hover 高亮 = 次级底色 (不抢键盘高亮) */
.dd-row--hover {
  background: color-mix(in srgb, var(--ac) 6%, transparent);
  color: var(--t1);
}

/* C4: 键盘高亮 = 底色 + 左 2px accent 竖条 */
.dd-row--kb {
  background: color-mix(in srgb, var(--ac) 10%, transparent);
  color: var(--t1);
}
.dd-row--kb::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 2px;
  background: var(--ac);
}

/* 父行: 不可选中态, 下钻入口 */
.dd-row--parent {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--t1);
}

/* 返回行 (C2 子视图顶部) */
.dd-row--back {
  font-size: var(--text-base);
  color: var(--t2);
  border-bottom: 1px solid var(--bd);
  border-radius: 0;
  margin-bottom: var(--sp-1);
  padding-left: var(--sp-1);
}
.dd-row--back:hover {
  color: var(--t1);
  background: color-mix(in srgb, var(--ac) 6%, transparent);
}

/* 选中态高亮: accent 竖条 + 颜色 (与键盘高亮竖条共存, 选中态额外着色) */
.dd-row--sel {
  color: var(--ac);
}
.dd-row--sel::after {
  content: '';
  position: absolute;
  right: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ac) 40%, transparent);
}

/* ── logo / 字母徽章 (28px 圆角方块) ── */
.dd-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

/* logo 底板: 中性设计 — 白底 + 1px 边框弱化突兀 (C5) */
.dd-logo--pad {
  background: #f4f4f5;
  border: 1px solid var(--bd);
}

/* C5: 暗色主题下纯黑单色 logo 反色; 底板改透明 */
.dd-logo--invert-dark {
  /* data-theme 未设 = 暗色 (见 useTheme.ts: isDark → dataset.theme = '') */
  filter: invert(1);
  background: transparent;
  border-color: transparent;
}
/* 明色主题不反色 (data-theme="light") */
:global([data-theme="light"]) .dd-logo--invert-dark {
  filter: none;
  background: #f4f4f5;
  border: 1px solid var(--bd);
}

.dd-logo__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 字母徽章: accent 渐变底 + 白字 */
.dd-logo__letter {
  font-size: .82rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac2));
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

/* ── 文本 ── */
.dd-row__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dd-row__hint {
  font-size: var(--text-xs);
  color: var(--t3);
  font-weight: 400;
  white-space: nowrap;
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dd-row__right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* ── chevron (C2: 指示下钻, 不再折叠) ── */
.dd-row__chevron {
  opacity: .7;
}

/* ── 选中 check 图标 ── */
.dd-row__check {
  font-size: 14px;
}

/* ── 行尾固定槽位 (避免条件渲染导致列宽抖动) ── */
.dd-row__check-slot {
  flex: none;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── C1: 入场/离场动画 (锚点起源 scale + opacity + translateY) ── */
/* transform-origin 按 placement 推导 (originClass) */
.dd-panel.dd-origin-bottom-start { transform-origin: top left; }
.dd-panel.dd-origin-bottom-end { transform-origin: top right; }
.dd-panel.dd-origin-top-start { transform-origin: bottom left; }
.dd-panel.dd-origin-top-end { transform-origin: bottom right; }

.dd-pop-enter-active {
  transition: opacity .13s ease-out, transform .13s ease-out;
}
.dd-pop-leave-active {
  transition: opacity .09s ease-in, transform .09s ease-in;
}
.dd-pop-enter-from {
  opacity: 0;
  transform: scale(.98) translateY(-4px);
}
.dd-pop-leave-to {
  opacity: 0;
  transform: scale(.98) translateY(-2px);
}

/* ── C2: 子视图横滑切换 ── */
.dd-slide-in-enter-active,
.dd-slide-in-leave-active,
.dd-slide-back-enter-active,
.dd-slide-back-leave-active {
  transition: opacity .15s ease, transform .15s ease;
}
.dd-slide-in-enter-from {
  opacity: 0;
  transform: translateX(30px);  /* 子视图从右侧滑入 */
}
.dd-slide-in-leave-to {
  opacity: 0;
  transform: translateX(-30px);  /* root 向左滑出 */
}
.dd-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-30px);  /* root 从左侧滑回 */
}
.dd-slide-back-leave-to {
  opacity: 0;
  transform: translateX(30px);  /* 子视图向右滑出 */
}
@media (prefers-reduced-motion: reduce) {
  /* 偏好减少动效: 横滑降级为纯 fade (C2) */
  .dd-slide-in-enter-from,
  .dd-slide-in-leave-to,
  .dd-slide-back-enter-from,
  .dd-slide-back-leave-to {
    transform: none;
  }
}
</style>
