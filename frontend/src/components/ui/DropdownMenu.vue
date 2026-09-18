<script setup lang="ts">
/**
 * DropdownMenu — Teleport 锚定弹层下拉菜单 (响应式自适应)
 *
 * 交互范式:
 *  - 桌面端 (宽屏 > 768px): 向右自适应悬浮级联 (Flyout Submenu), 一级架构常驻可见,
 *    鼠标悬停或键盘右键即展开子菜单, 右侧空间不足自适应向左翻转, 零返回成本。
 *  - 移动端 (窄屏 <= 768px): 自适应降级为单列下钻, 配备专属吸顶强化返回条。
 *  - 定位: floating-ui (transform: false), 智能 flip + shift。
 *  - 键盘: 桌面端 ArrowRight/Enter 展开子级, ArrowLeft 收起返回; Escape 关闭。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useFloating, autoUpdate, offset, flip, shift, size as floatingSize } from '@floating-ui/vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'DropdownMenu' })

export interface DropdownMenuItem {
  key: string
  label: string
  /** 图片资源 URL; 与 letter 二选一 */
  logo?: string
  /** 暗色主题下 logo 反色 (仅纯黑/单色 logo) */
  logoInvertDark?: boolean
  /** logo 缺省时字母徽章字符 (1-2 字符) */
  letter?: string
  /** 说明性小字 (可选, 单行, 次要色) */
  hint?: string
  /** 二级子项 */
  children?: DropdownMenuItem[]
}

const { t } = useI18n()

const props = withDefaults(defineProps<{
  items: DropdownMenuItem[]
  /** 当前选中 key (可能是子项 key) */
  modelValue: string
  /** 移动端返回顶栏的提示文本，缺省回退 i18n 'common.btn.all' */
  backLabel?: string
}>(), {
  backLabel: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'close': []
}>()

const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const open = ref(false)

// ── 响应式检测 (桌面端 vs 移动端) ──
const isMobile = ref(false)
function updateDevice() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth <= 768
}

// ── 桌面端: 二级悬浮级联状态 ──
const activeSubmenuParent = ref<DropdownMenuItem | null>(null)
const subTriggerEl = ref<HTMLElement | null>(null)
const subPanelRef = ref<HTMLElement | null>(null)
let subOpenTimer: number | null = null
let subCloseTimer: number | null = null

// ── 移动端: 当前视图 ('root' | 父组 key) ──
const currentView = ref<string>('root')

/** 移动端当前视图行 */
const mobileViewRows = computed<DropdownMenuItem[]>(() => {
  if (currentView.value === 'root') return props.items
  const parent = props.items.find(it => it.key === currentView.value)
  return parent?.children || []
})

/** 移动端当前视图父项 */
const currentParent = computed<DropdownMenuItem | null>(() => {
  if (currentView.value === 'root') return null
  return props.items.find(it => it.key === currentView.value) || null
})

// ── 选中 key 所属的父组 key ──
const selectedParentKey = computed<string | null>(() => {
  for (const it of props.items) {
    if (it.children && it.children.some(c => c.key === props.modelValue)) {
      return it.key
    }
  }
  return null
})

// ── 叶子扁平序列 (触发器闭合态 ↑/↓ 切换) ──
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

// ── 主面板定位 (floating-ui) ──
const { floatingStyles: mainFloatingStyles, placement: mainPlacement } = useFloating(triggerRef, panelRef, {
  open,
  placement: 'bottom-start',
  strategy: 'fixed',
  transform: false,
  middleware: [
    offset(8),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
    floatingSize({
      padding: 8,
      apply({ availableHeight, elements, rects }) {
        const max = Math.max(200, availableHeight)
        elements.floating.style.setProperty('--dd-menu-max', `${max}px`)
        // 浮层宽度跟随触发器按钮: 保证不比触发器窄
        const refWidth = Math.round(rects.reference.width)
        if (refWidth > 0) {
          elements.floating.style.setProperty('--dd-trigger-width', `${refWidth}px`)
        }
      },
    }),
  ],
  whileElementsMounted: autoUpdate,
})

// ── 桌面端二级面板定位 (floating-ui) ──
const isSubmenuOpen = computed(() => !isMobile.value && open.value && !!activeSubmenuParent.value)
const { floatingStyles: subFloatingStyles } = useFloating(subTriggerEl, subPanelRef, {
  open: isSubmenuOpen,
  placement: 'right-start',
  strategy: 'fixed',
  transform: false,
  middleware: [
    offset({ mainAxis: 4, crossAxis: -4 }),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
    floatingSize({
      padding: 8,
      apply({ availableHeight, elements }) {
        const max = Math.max(160, availableHeight)
        elements.floating.style.setProperty('--dd-sub-max', `${max}px`)
      },
    }),
  ],
  whileElementsMounted: autoUpdate,
})

const originClass = computed(() => {
  const p = mainPlacement.value
  if (p.startsWith('bottom')) return p.endsWith('end') ? 'dd-origin-bottom-end' : 'dd-origin-bottom-start'
  if (p.startsWith('top')) return p.endsWith('end') ? 'dd-origin-top-end' : 'dd-origin-top-start'
  return 'dd-origin-bottom-start'
})

// ── 键盘导航高亮 ──
const highlightIdx = ref(-1)
const subHighlightIdx = ref(-1)

// ── 打开/关闭 ──
function openMenu() {
  updateDevice()
  open.value = true
  // 移动端和桌面端初次展开均始终展示一级 root 架构列表，保持全局视野
  currentView.value = 'root'

  if (!isMobile.value) {
    // 桌面端: 若选中项在子集内, 默认展开该子集的二级菜单，并初始化子项的高亮与聚焦
    if (selectedParentKey.value) {
      const parent = props.items.find(it => it.key === selectedParentKey.value)
      if (parent) {
        const childIdx = parent.children?.findIndex(c => c.key === props.modelValue) ?? -1
        subHighlightIdx.value = childIdx >= 0 ? childIdx : 0
        nextTick(() => {
          subTriggerEl.value = panelRef.value?.querySelector(`[data-key="${parent.key}"]`) as HTMLElement || null
          activeSubmenuParent.value = parent
          nextTick(() => scrollToHighlighted())
        })
      }
    } else {
      activeSubmenuParent.value = null
      subTriggerEl.value = null
      subHighlightIdx.value = -1
    }
  }

  nextTick(() => {
    const list = props.items
    const idx = list.findIndex(r => r.key === props.modelValue || r.key === selectedParentKey.value)
    highlightIdx.value = idx >= 0 ? idx : 0
    scrollToHighlighted()
  })
}

function closeMenu() {
  if (!open.value) return
  open.value = false
  clearTimers()
  activeSubmenuParent.value = null
  subTriggerEl.value = null
  emit('close')
}

function toggle() {
  if (open.value) closeMenu()
  else openMenu()
}

function clearTimers() {
  if (subOpenTimer) { clearTimeout(subOpenTimer); subOpenTimer = null }
  if (subCloseTimer) { clearTimeout(subCloseTimer); subCloseTimer = null }
}

// ── 选择叶子 ──
function selectLeaf(item: DropdownMenuItem) {
  emit('update:modelValue', item.key)
  closeMenu()
}

// ── 桌面端悬浮级联处理 (位置与数据原子化同步更新，彻底根治残影闪烁) ──
function onDesktopParentHover(item: DropdownMenuItem, e: MouseEvent) {
  if (isMobile.value) return
  // 清除已有的关闭倒计时
  if (subCloseTimer) {
    clearTimeout(subCloseTimer)
    subCloseTimer = null
  }

  // 若已经在当前父项上展开，无需任何操作
  if (activeSubmenuParent.value?.key === item.key) return

  const targetEl = e.currentTarget as HTMLElement
  clearTimers()

  // 1. 若当前尚未展开任何子菜单: 延迟 80ms 展开 (防快速扫过误触)
  // 2. 若当前已展开子菜单: 40ms 极短延迟原子切换 (位置与内容同步替换，绝不产生旧内容位置跳变)
  const delay = activeSubmenuParent.value ? 40 : 80
  subOpenTimer = window.setTimeout(() => {
    subTriggerEl.value = targetEl
    activeSubmenuParent.value = item
    const childIdx = item.children?.findIndex(c => c.key === props.modelValue) ?? -1
    subHighlightIdx.value = childIdx >= 0 ? childIdx : -1
    subOpenTimer = null
    nextTick(() => scrollToHighlighted())
  }, delay)
}

function onDesktopLeafHover() {
  if (isMobile.value) return
  if (subOpenTimer) {
    clearTimeout(subOpenTimer)
    subOpenTimer = null
  }
  if (activeSubmenuParent.value && !subCloseTimer) {
    subCloseTimer = window.setTimeout(() => {
      activeSubmenuParent.value = null
      subTriggerEl.value = null
      subHighlightIdx.value = -1
      subCloseTimer = null
    }, 200)
  }
}

function onSubPanelMouseEnter() {
  if (subCloseTimer) {
    clearTimeout(subCloseTimer)
    subCloseTimer = null
  }
}

function onSubPanelMouseLeave() {
  if (isMobile.value) return
  if (!subCloseTimer) {
    subCloseTimer = window.setTimeout(() => {
      activeSubmenuParent.value = null
      subTriggerEl.value = null
      subHighlightIdx.value = -1
      subCloseTimer = null
    }, 200)
  }
}

// ── 移动端下钻处理 ──
function onMobileParentClick(parent: DropdownMenuItem) {
  currentView.value = parent.key
  highlightIdx.value = 0
  nextTick(() => scrollToHighlighted())
}

function drillBack() {
  currentView.value = 'root'
  const idx = props.items.findIndex(it => it.key === currentParent.value?.key)
  highlightIdx.value = idx >= 0 ? idx : 0
  nextTick(() => scrollToHighlighted())
}

// ── 键盘导航 ──
function onTriggerKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const leaves = flatLeaves.value
      if (!leaves.length) return
      const curIdx = leaves.findIndex(l => l.key === props.modelValue)
      const next = e.key === 'ArrowDown'
        ? (curIdx < 0 ? 0 : (curIdx + 1) % leaves.length)
        : (curIdx < 0 ? leaves.length - 1 : (curIdx - 1 + leaves.length) % leaves.length)
      emit('update:modelValue', leaves[next]!.key)
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

function handleKeydown(e: KeyboardEvent) {
  if (!open.value) return

  // 移动端键盘逻辑
  if (isMobile.value) {
    const rows = mobileViewRows.value
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlightIdx.value = (highlightIdx.value + 1) % rows.length
      scrollToHighlighted()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlightIdx.value = (highlightIdx.value - 1 + rows.length) % rows.length
      scrollToHighlighted()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const row = rows[highlightIdx.value]
      if (!row) return
      if (row.children && row.children.length) onMobileParentClick(row)
      else selectLeaf(row)
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      if (currentView.value !== 'root') {
        e.preventDefault()
        drillBack()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
      triggerRef.value?.focus()
    }
    return
  }

  // 桌面端键盘逻辑
  if (activeSubmenuParent.value && activeSubmenuParent.value.children?.length) {
    // 处于子菜单中
    const subRows = activeSubmenuParent.value.children
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      subHighlightIdx.value = (subHighlightIdx.value + 1) % subRows.length
      scrollToHighlighted()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      subHighlightIdx.value = (subHighlightIdx.value - 1 + subRows.length) % subRows.length
      scrollToHighlighted()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const selected = subRows[subHighlightIdx.value]
      if (subHighlightIdx.value >= 0 && selected) {
        selectLeaf(selected)
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      e.preventDefault()
      activeSubmenuParent.value = null
      subHighlightIdx.value = -1
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
      triggerRef.value?.focus()
    }
    return
  }

  // 处于一级菜单中
  const rows = props.items
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlightIdx.value = (highlightIdx.value + 1) % rows.length
    scrollToHighlighted()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightIdx.value = (highlightIdx.value - 1 + rows.length) % rows.length
    scrollToHighlighted()
  } else if (e.key === 'ArrowRight') {
    const row = rows[highlightIdx.value]
    if (row?.children?.length) {
      e.preventDefault()
      // 键盘展开与鼠标悬浮共用状态; 若此前鼠标在叶子行挂起了关闭倒计时,
      // 不清理会把刚展开的子菜单在 200ms 后关闭
      clearTimers()
      activeSubmenuParent.value = row
      subTriggerEl.value = panelRef.value?.querySelector(`[data-key="${row.key}"]`) as HTMLElement || null
      const childIdx = row.children.findIndex(c => c.key === props.modelValue)
      subHighlightIdx.value = childIdx >= 0 ? childIdx : 0
      nextTick(() => scrollToHighlighted())
    }
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const row = rows[highlightIdx.value]
    if (!row) return
    if (row.children?.length) {
      clearTimers()
      activeSubmenuParent.value = row
      subTriggerEl.value = panelRef.value?.querySelector(`[data-key="${row.key}"]`) as HTMLElement || null
      const childIdx = row.children.findIndex(c => c.key === props.modelValue)
      subHighlightIdx.value = childIdx >= 0 ? childIdx : 0
      nextTick(() => scrollToHighlighted())
    } else {
      selectLeaf(row)
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeMenu()
    triggerRef.value?.focus()
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    panelRef.value?.querySelector('.dd-row--kb')?.scrollIntoView({ block: 'nearest' })
    subPanelRef.value?.querySelector('.dd-row--kb')?.scrollIntoView({ block: 'nearest' })
  })
}

// ── 点击外部关闭 ──
function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerRef.value?.contains(t)) return
  if (panelRef.value?.contains(t)) return
  if (subPanelRef.value?.contains(t)) return
  closeMenu()
}

onMounted(() => {
  updateDevice()
  window.addEventListener('resize', updateDevice)
  document.addEventListener('click', onClickOutside, true)
})
onBeforeUnmount(() => {
  clearTimers()
  window.removeEventListener('resize', updateDevice)
  document.removeEventListener('click', onClickOutside, true)
})

defineExpose({ openMenu, closeMenu })
</script>

<template>
  <div class="dd-menu" @keydown="onTriggerKeydown">
    <!-- 触发器插槽。包裹 div 跟随 dd-menu 宽度: dd-menu 被
         外部拉宽时 (如移动端通栏), slot 触发器才能随之全宽。 -->
    <div ref="triggerRef" class="dd-menu__trigger" @click="toggle">
      <slot :open="open" :toggle="toggle" />
    </div>

    <!-- 弹层部分 -->
    <Teleport to="body">
      <Transition name="dd-pop">
        <div
          v-if="open"
          ref="panelRef"
          class="dd-panel"
          :class="[originClass, isMobile && 'dd-panel--mobile']"
          :style="mainFloatingStyles"
          role="listbox"
          tabindex="-1"
          @keydown="handleKeydown"
        >
          <!-- ── 移动端专属吸顶强化返回条 ── -->
          <div
            v-if="isMobile && currentView !== 'root' && currentParent"
            class="dd-mobile-back-bar"
            @click="drillBack"
            role="button"
          >
            <div class="dd-mobile-back-btn">
              <MsIcon name="arrow_back" size="xs" color="var(--ac)" />
              <span>{{ currentParent.label }}</span>
            </div>
            <span class="dd-mobile-back-hint">{{ backLabel || t('common.btn.all') }}</span>
          </div>

          <!-- ── 列表内容 ── -->
          <div class="dd-list">
            <!-- 移动端视图 (下钻) -->
            <template v-if="isMobile">
              <template v-for="(row, idx) in mobileViewRows" :key="row.key">
                <!-- 移动端父行: 点击下钻 -->
                <div
                  v-if="row.children && row.children.length"
                  class="dd-row dd-row--parent"
                  :class="{
                    'dd-row--kb': idx === highlightIdx,
                  }"
                  @click="onMobileParentClick(row)"
                  role="group"
                >
                  <div class="dd-logo" :class="{ 'dd-logo--pad': row.logo, 'dd-logo--invert-dark': row.logoInvertDark }">
                    <img v-if="row.logo" :src="row.logo" :alt="row.label" class="dd-logo__img" />
                    <span v-else class="dd-logo__letter">{{ row.letter || row.label.charAt(0) }}</span>
                  </div>
                  <span class="dd-row__label">{{ row.label }}</span>
                  <span class="dd-row__right">
                    <span v-if="row.hint" class="dd-row__hint">{{ row.hint }}</span>
                    <span v-if="row.key === selectedParentKey" class="dd-row__family-dot"></span>
                    <MsIcon name="chevron_right" size="xs" color="var(--t3)" />
                  </span>
                </div>

                <!-- 移动端叶子行 -->
                <div
                  v-else
                  class="dd-row dd-row--leaf"
                  :class="{
                    'dd-row--sel': row.key === modelValue,
                    'dd-row--kb': idx === highlightIdx,
                  }"
                  @click="selectLeaf(row)"
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
            </template>

            <!-- 桌面端视图 (常驻一级 + 悬浮展开二级) -->
            <template v-else>
              <template v-for="(row, idx) in items" :key="row.key">
                <!-- 桌面端父行 (有 children): 鼠标悬停向右展开子面板 -->
                <div
                  v-if="row.children && row.children.length"
                  :data-key="row.key"
                  class="dd-row dd-row--parent"
                  :class="{
                    'dd-row--kb': idx === highlightIdx && !activeSubmenuParent,
                    'dd-row--active-parent': activeSubmenuParent?.key === row.key,
                  }"
                  @mouseenter="onDesktopParentHover(row, $event)"
                  @click="onDesktopParentHover(row, $event)"
                  role="group"
                >
                  <div class="dd-logo" :class="{ 'dd-logo--pad': row.logo, 'dd-logo--invert-dark': row.logoInvertDark }">
                    <img v-if="row.logo" :src="row.logo" :alt="row.label" class="dd-logo__img" />
                    <span v-else class="dd-logo__letter">{{ row.letter || row.label.charAt(0) }}</span>
                  </div>
                  <span class="dd-row__label">{{ row.label }}</span>
                  <span class="dd-row__right">
                    <span v-if="row.hint" class="dd-row__hint">{{ row.hint }}</span>
                    <span v-if="row.key === selectedParentKey" class="dd-row__family-dot"></span>
                    <MsIcon
                      name="chevron_right"
                      size="xs"
                      :color="activeSubmenuParent?.key === row.key ? 'var(--ac)' : 'var(--t3)'"
                      class="dd-row__chevron"
                    />
                  </span>
                </div>

                <!-- 桌面端常规叶子行 -->
                <div
                  v-else
                  class="dd-row dd-row--leaf"
                  :class="{
                    'dd-row--sel': row.key === modelValue,
                    'dd-row--kb': idx === highlightIdx && !activeSubmenuParent,
                  }"
                  @click="selectLeaf(row)"
                  @mouseenter="onDesktopLeafHover()"
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
            </template>
          </div>
        </div>
      </Transition>

      <!-- ── 桌面端二级悬浮子菜单面板 ── -->
      <Transition name="dd-pop">
        <div
          v-if="isSubmenuOpen && activeSubmenuParent?.children?.length"
          :key="activeSubmenuParent.key"
          ref="subPanelRef"
          class="dd-panel dd-submenu-panel"
          :style="subFloatingStyles"
          role="listbox"
          tabindex="-1"
          @mouseenter="onSubPanelMouseEnter"
          @mouseleave="onSubPanelMouseLeave"
          @keydown="handleKeydown"
        >
          <div class="dd-list dd-submenu-list">
            <div
              v-for="(subRow, subIdx) in activeSubmenuParent.children"
              :key="subRow.key"
              class="dd-row dd-row--leaf"
              :class="{
                'dd-row--sel': subRow.key === modelValue,
                'dd-row--kb': subIdx === subHighlightIdx,
              }"
              @click="selectLeaf(subRow)"
              role="option"
              :aria-selected="subRow.key === modelValue"
            >
              <div class="dd-logo" :class="{ 'dd-logo--pad': subRow.logo, 'dd-logo--invert-dark': subRow.logoInvertDark }">
                <img v-if="subRow.logo" :src="subRow.logo" :alt="subRow.label" class="dd-logo__img" />
                <span v-else class="dd-logo__letter">{{ subRow.letter || subRow.label.charAt(0) }}</span>
              </div>
              <span class="dd-row__label">{{ subRow.label }}</span>
              <span v-if="subRow.hint" class="dd-row__hint">{{ subRow.hint }}</span>
              <span class="dd-row__right">
                <span class="dd-row__check-slot">
                  <MsIcon v-if="subRow.key === modelValue" name="check" size="xs" color="var(--ac)" class="dd-row__check" />
                </span>
              </span>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dd-menu {
  display: inline-block;
}

.dd-menu__trigger {
  width: 100%;
}

.dd-panel {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1000;
  min-width: max(230px, var(--dd-trigger-width, 0px));
  max-width: min(380px, calc(100vw - 16px));
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  box-shadow: var(--sh);
  overflow: hidden;
  --dd-menu-max: 380px;
}

.dd-panel--mobile {
  min-width: max(230px, var(--dd-trigger-width, 0px));
  width: max(230px, var(--dd-trigger-width, 0px));
  max-width: calc(100vw - 16px);
}

.dd-submenu-panel {
  z-index: 1001;
  min-width: 220px;
  max-width: 300px;
  --dd-sub-max: 360px;
  overflow: visible;
}

/* 隐形防脱焦桥接热区 (避免鼠标从一级滑向二级时的微小空隙丢失 hover) */
.dd-submenu-panel::before {
  content: '';
  position: absolute;
  top: -10px;
  bottom: -10px;
  left: -24px;
  right: -24px;
  background: transparent;
  z-index: -1;
  pointer-events: auto;
}

.dd-list {
  max-height: var(--dd-menu-max, 380px);
  overflow-y: auto;
  padding: var(--sp-1);
}

.dd-submenu-list {
  max-height: var(--dd-sub-max, 360px);
}

/* ── 移动端专属吸顶强化返回条 ── */
.dd-mobile-back-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg2);
  border-bottom: 1px solid var(--bd);
  cursor: pointer;
  user-select: none;
}
.dd-mobile-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--t1);
}
.dd-mobile-back-hint {
  font-size: var(--text-xs);
  color: var(--t3);
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
  transition: background .12s, color .12s;
}

.dd-row--leaf {
  font-size: var(--text-base);
  font-weight: 400;
  color: var(--t2);
}

/* hover 高亮 */
.dd-row:hover {
  background: color-mix(in srgb, var(--ac) 6%, transparent);
  color: var(--t1);
}

/* 键盘高亮 */
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

/* 父行: 悬浮/激活态 */
.dd-row--parent {
  font-size: var(--text-base);
  font-weight: 400;
  color: var(--t2);
}

.dd-row--active-parent {
  background: color-mix(in srgb, var(--ac) 10%, transparent);
  color: var(--ac);
}

/* 家族内包含选中项的小圆点 */
.dd-row__family-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ac);
  flex-shrink: 0;
}

/* 选中态高亮 */
.dd-row--sel {
  color: var(--ac);
  font-weight: 500;
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

/* logo 底板: 保证单色/黑色与彩色 logo 在暗色和亮色下均清晰可见 */
.dd-logo--pad {
  background: var(--bg-logo-pad, #f1f3f5);
  border: 1px solid var(--bd);
  padding: 2px;
}

/* 暗色主题下纯黑单色 logo 反色 */
.dd-logo--invert-dark {
  filter: invert(1);
  background: transparent;
  border-color: transparent;
}
/* 浅色主题下不反色: 祖先选择器 + scoped 后缀即可命中, 不用 :global()。
   :global() 写法在 @vue/compiler-sfc 3.5.31 会丢弃 :global() 段之后的选择器,
   产物退化为裸 [data-theme="light"] —— data-theme 挂在 <html> 上, 等于给
   <html> 加 1px border, 造成 2px 文档级假滚动条 (与 .content 真滚动条并排)。 */
[data-theme="light"] .dd-logo--invert-dark {
  filter: none;
  background: var(--bg-logo-pad, #ffffff);
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
  gap: 6px;
  flex-shrink: 0;
}

.dd-row__chevron {
  opacity: .75;
  transition: transform .15s ease;
}

.dd-row__check {
  font-size: 14px;
}

.dd-row__check-slot {
  flex: none;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 动画 ── */
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
</style>
