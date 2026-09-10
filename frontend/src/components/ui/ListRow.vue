<script setup lang="ts">
/**
 * ListRow — 全站统一的「对象行」。
 *
 * 一行 = 图标 + 主行（名称 / 状态 / 徽章）+ 副行（事实）+ 行尾动作。
 * 无背景、无表头，只有行间发丝线；窄屏收成两列、动作换行右对齐。
 *
 * 用法（外层必须是 `<ul class="list-plain">`，行本身是 `<li>`）：
 *   <ul class="list-plain">
 *     <ListRow icon="terminal" title="ComfyUI" :status="{ tone: 'running', text: '在线' }" :facts="['运行时间 3h', 'CPU 1.2%']">
 *       <template #actions><BaseButton … /></template>
 *     </ListRow>
 *   </ul>
 *
 * 规范（组件已经在代码里保证，调用方不用重复实现）：
 *   1. 图标列 26px、与标题首行光学对齐；没有图标时整列省略，不留空位
 *   2. 状态 = 圆点 + 静音文字 —— 颜色只给圆点；彩色状态词请改用徽章
 *   3. 副行事实等宽小字、自动 `·` 分隔；缺值不要传空串进来（不渲染 `-`）
 *   4. 行尾动作是**长方形**（42×32，与同行的文字按钮等高），不是正方形；命中区靠 min 尺寸
 *      保证 ≥40×32（触屏 ≥40 高）。动作图标由组件统一为 20px（约占盒子 6 成），
 *      调用方传 `size="sm"`、不传 `square`，也不用管图标大小
 *   5. 一个行最多 3 个动作，更多请收进 DropdownMenu；危险动作永远排最右
 */
import MsIcon from './MsIcon.vue'
import StatusDot from './StatusDot.vue'
import Badge from './Badge.vue'

defineOptions({ name: 'ListRow' })

withDefaults(defineProps<{
  /** Material Symbols 图标名（对象身份图标） */
  icon?: string
  /** 主行文字（对象名） */
  title: string
  /** 主行悬停说明：pm2 内部名、完整路径这类排障信息 */
  titleTooltip?: string
  /** 主行状态：圆点 + 词 */
  status?: { tone: 'running' | 'stopped' | 'loading' | 'error'; text: string }
  /** 主行徽章（分类标签，不表达状态） */
  badges?: string[]
  /** 副行事实（等宽小字，组件负责分隔） */
  facts?: string[]
  /** 整行可点：只用于导航，不做有副作用的动作 */
  clickable?: boolean
  /** 停用态（例如被禁用的同步规则） */
  disabled?: boolean
}>(), {
  badges: () => [],
  facts: () => [],
})
</script>

<template>
  <li
    class="list-row"
    :class="{
      'list-row--clickable': clickable,
      'list-row--disabled': disabled,
      'list-row--no-icon': !icon,
    }"
  >
    <span v-if="icon" class="list-row__icon" aria-hidden="true">
      <MsIcon :name="icon" size="md" />
    </span>
    <div class="list-row__main">
      <div class="list-row__head">
        <span class="list-row__title" :title="titleTooltip">{{ title }}</span>
        <span v-if="status" class="list-row__status">
          <StatusDot :status="status.tone" size="sm" />
          {{ status.text }}
        </span>
        <Badge v-for="badge in badges" :key="badge">{{ badge }}</Badge>
      </div>
      <div v-if="facts.length" class="list-row__facts">
        <span v-for="fact in facts" :key="fact">{{ fact }}</span>
      </div>
      <slot name="extra" />
    </div>
    <div v-if="$slots.actions" class="list-row__actions">
      <slot name="actions" />
    </div>
  </li>
</template>

<style scoped>
.list-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 14px 0;
}

.list-row--no-icon {
  grid-template-columns: minmax(0, 1fr) auto;
}

.list-row + .list-row {
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
}

.list-row--clickable {
  cursor: pointer;
  transition: background .15s ease;
}

.list-row--clickable:hover {
  background: var(--bg3);
}

.list-row--disabled {
  opacity: .55;
}

.list-row__icon {
  display: inline-flex;
  color: var(--t2);
  line-height: 1;
  margin-top: 3px;
}

/* 身份图标 22px —— 与设计稿的 `.cc-service > .cc-icon` / `.cc-key-title .cc-icon` 同值。
   MsIcon 的尺寸阶梯（12/16/18/20/32/48）没有 22 这一档，所以在这里定，
   并把 `opsz` 一起对齐（Material 的可变字体按 opsz 决定笔画粗细，只改 font-size 会得到偏重的字形） */
.list-row__icon :deep(.ms) {
  font-size: 22px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 22;
}

.list-row__main {
  min-width: 0;
}

.list-row__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.list-row__title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
}

.list-row__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--t2);
}

.list-row__facts {
  display: flex;
  flex-wrap: wrap;
  color: var(--t3);
  font-size: var(--text-sm);
  font-family: var(--font-tabular);
}

.list-row__facts > span + span::before {
  content: '·';
  margin: 0 6px;
}

.list-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 行内动作按钮是长方形（不是正方形）：左右 10px 内边距 + 20px 图标 ≈ 42×32，
   与同一行的文字按钮等高。min-* 只保证下限（命中区），不加宽高比约束。
   图标与盒子的比例约 0.63 —— 盒子被撑大时图标必须跟着变大，
   否则就是"小图标漂在大盒子里"，比原来更难看。 */
.list-row__actions :deep(.base-btn) {
  min-width: 40px;
  min-height: 32px;
}

.list-row__actions :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}

/* 触屏只加大盒子（命中优先），图标不再放大 */
@media (pointer: coarse) {
  .list-row__actions :deep(.base-btn) {
    min-height: 40px;
  }
}

@media (max-width: 768px) {
  .list-row {
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 8px;
  }

  .list-row--no-icon {
    grid-template-columns: minmax(0, 1fr);
  }

  .list-row__actions {
    grid-column: 2;
    justify-content: flex-end;
  }

  .list-row--no-icon .list-row__actions {
    grid-column: 1;
  }
}
</style>
