<script setup lang="ts">
/**
 * Drawer — 右侧滑出面板。
 *
 * 复用 BaseModal 的遮罩 / ESC / 滚动锁定模式, 但:
 *  - 内容常驻挂载: 关闭时 transform 移出 + visibility:hidden, 不得 v-if 销毁内容
 *    (QueuePanel/HistoryPanel 的 ref 被 ws 回调调用, 必须存活)。
 *  - 右侧滑出而非居中弹窗, 260ms ease 滑入; 窄屏 (<640px) 100vw。
 */
import { computed, watch, ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from './BaseModal.vue'

defineOptions({ name: 'Drawer' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  icon?: string
  width?: string
}>(), {
  width: 'clamp(420px, 42vw, 620px)',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const drawerRef = ref<HTMLElement | null>(null)
const hasBodyLock = ref(false)

watch(() => props.modelValue, (open) => {
  if (open) {
    if (!hasBodyLock.value) {
      lockBodyScroll()
      hasBodyLock.value = true
    }
  } else if (hasBodyLock.value) {
    unlockBodyScroll()
    hasBodyLock.value = false
  }
})

onUnmounted(() => {
  if (hasBodyLock.value) {
    unlockBodyScroll()
    hasBodyLock.value = false
  }
})

function close() {
  show.value = false
}

// Track mousedown origin to prevent drag-close
const mouseDownOnOverlay = ref(false)

function onOverlayMousedown(e: MouseEvent) {
  mouseDownOnOverlay.value = e.target === e.currentTarget
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget && mouseDownOnOverlay.value) close()
  mouseDownOnOverlay.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩: 打开/关闭淡入淡出; 内容常驻挂载 (visibility 控制) -->
    <div
      class="drawer-overlay"
      :class="{ 'drawer-overlay--open': show }"
      @mousedown="onOverlayMousedown"
      @click="onOverlayClick"
      @keydown="onKeydown"
      tabindex="-1"
    >
      <aside
        ref="drawerRef"
        class="drawer-panel"
        :class="{ 'drawer-panel--open': show }"
        :style="{ width: width }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <!-- 头部 -->
        <header class="drawer-header">
          <div class="drawer-header__title-group">
            <MsIcon v-if="icon" :name="icon" />
            <h3 class="drawer-title">{{ title }}</h3>
          </div>
          <button class="drawer-close" @click="close" :aria-label="t('common.btn.close')">
            <MsIcon name="close" />
          </button>
        </header>

        <!-- body 独立滚动 -->
        <div class="drawer-body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 1000;
  visibility: hidden;
  opacity: 0;
  transition: opacity .26s ease, visibility .26s ease;
}
.drawer-overlay--open {
  visibility: visible;
  opacity: 1;
}

.drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  max-width: 100vw;
  background: var(--bg2);
  border-left: 1px solid var(--bd);
  box-shadow: var(--sh);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  visibility: hidden;
  transition: transform .26s ease, visibility .26s ease;
}
.drawer-panel--open {
  transform: translateX(0);
  visibility: visible;
}

@media (max-width: 640px) {
  .drawer-panel { width: 100vw !important; }
}

/* Drawer header 对齐 PageHeader 规格 (F):
   PageHeader: min-height 64px, padding 0 clamp(28px,2.5vw,42px),
   h2 font-size 1.15rem/600, icon .ms font-size 28px margin-right 6px。
   抽屉宽度较窄, 左右 padding 缩小至 clamp(20px,2vw,28px) 保持同水平线视觉。 */
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;  /* 与 PageHeader 同高 (F) */
  padding: 0 clamp(20px, 2vw, 28px);  /* 与 PageHeader 同水平线视觉 (F) */
  gap: var(--sp-2);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}

.drawer-header__title-group {
  display: flex;
  align-items: center;
  gap: 6px;  /* 与 PageHeader h2 .ms margin-right 一致 (F) */
  min-width: 0;
}

/* 标题字号/字重对齐 PageHeader h2 (F: 1.15rem / 600) */
.drawer-title {
  font-size: 1.15rem;  /* PageHeader h2 字号 (F) */
  font-weight: 600;    /* PageHeader h2 字重 (F) */
  color: var(--t1);
  line-height: 1.1;
  margin: 0;
}

/* 头部图标尺寸对齐 PageHeader .ms (F: 28px, opsz 28) */
.drawer-header__title-group :deep(.ms) {
  font-size: 28px;
  vertical-align: -5px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 28;
}

.drawer-close {
  background: none;
  border: none;
  color: var(--t3);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--rs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.drawer-close:hover { color: var(--t1); background: var(--bg3); }

.drawer-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
</style>
