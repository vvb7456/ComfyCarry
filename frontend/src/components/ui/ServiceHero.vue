<script lang="ts">
/** Hero 状态语义：ok=运行/正常，warn=过渡/注意，bad=失败，off=停止/未配置 */
export type ServiceHeroTone = 'ok' | 'warn' | 'bad' | 'off'
</script>

<script setup lang="ts">
/**
 * ServiceHero — 五个服务页（Tunnel / SSH / Jupyter / 云同步 / ComfyUI）共用的 Hero 卡片。
 *
 * 结构固定为「居中身份图标 → 标题 → 一句副标题 → 可选动作」，
 * 运行事实作为卡片下方的一行可换行紧凑键值。空态、运行、过渡、失败共用同一骨架，
 * 只切换图标着色与过渡动画，保证状态切换时内容位置和留白稳定。
 *
 * tone 与既有 StatusDot 状态体系一一对应（映射完全在本组件内部消化，调用方只传 tone）：
 *   ok   → running（绿）
 *   warn → loading（琥珀，脉冲）
 *   bad  → error（红）
 *   off  → stopped（静音灰）
 * busy 叠在 tone 之上，用旋转表达过渡态；遵循 prefers-reduced-motion: reduce。
 *
 * 用法：
 *   <ServiceHero icon="language" tone="ok" title="隧道已连接" subtitle="已为 2 项服务建立公网入口。">
 *     <template #actions>
 *       <BaseButton variant="primary" @click="…">打开</BaseButton>
 *     </template>
 *     <template #facts>
 *       <span>监听端口<b>8188</b></span>
 *     </template>
 *   </ServiceHero>
 *
 * facts 是「标签 + 值」的紧凑事实项（值用 <b> 承载），组件负责行容器与键值样式。
 */
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'ServiceHero' })

withDefaults(defineProps<{
  /** Material Symbols 图标名（服务身份图标） */
  icon: string
  title: string
  subtitle: string
  tone: ServiceHeroTone
  /** 过渡态：图标旋转（如连接中 / 启动中） */
  busy?: boolean
}>(), {
  busy: false,
})
</script>

<template>
  <div class="service-hero-wrap">
    <section
      class="service-hero"
      :class="[`service-hero--${tone}`, { 'service-hero--busy': busy }]"
      aria-live="polite"
    >
      <div class="service-hero__body">
        <span class="service-hero__icon" aria-hidden="true">
          <MsIcon :name="icon" />
        </span>
        <h2 class="service-hero__title">{{ title }}</h2>
        <p class="service-hero__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="service-hero__actions">
        <slot name="actions" />
      </div>
    </section>

    <div v-if="$slots.facts" class="service-hero__facts">
      <slot name="facts" />
    </div>
  </div>
</template>

<style scoped>
/* 卡片形态：约 240px 视觉高度，内容组垂直居中；有 / 无动作共用同一留白骨架 */
.service-hero {
  --tone: var(--t2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  box-sizing: border-box;
  min-height: 240px;
  padding: 32px 24px;
  text-align: center;
  border: 1px solid var(--bd);
  border-radius: var(--r);
  background: var(--bg2);
}

/* 状态色体系：复用既有语义色变量，与 StatusDot 的 running/loading/error/stopped 对齐 */
.service-hero--ok { --tone: var(--green); }
.service-hero--warn { --tone: var(--amber); }
.service-hero--bad { --tone: var(--red); }
.service-hero--off { --tone: var(--t2); }

.service-hero__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.service-hero__icon {
  display: inline-flex;
  color: var(--tone);
  line-height: 1;
}

/* 身份图标 42px —— MsIcon 尺寸阶梯没有这一档，在此定值并把 opsz 一并对齐，
   否则只改 font-size 会得到偏重的字形 */
.service-hero__icon :deep(.ms) {
  font-size: 42px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 42;
}

/* busy 优先于 warn：过渡态用旋转，warn 的空闲态用脉冲 */
.service-hero--busy .service-hero__icon {
  animation: service-hero-spin 1.6s linear infinite;
}

.service-hero--warn:not(.service-hero--busy) .service-hero__icon {
  animation: service-hero-pulse 1.6s ease-in-out infinite;
}

@keyframes service-hero-spin {
  to { transform: rotate(360deg); }
}

@keyframes service-hero-pulse {
  50% { opacity: .55; }
}

.service-hero__title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -.4px;
  line-height: 1.3;
  color: var(--t1);
}

.service-hero__subtitle {
  max-width: 440px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--t2);
  overflow-wrap: anywhere;
}

.service-hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
  min-height: 36px;
}

/* 动作按钮由业务层传入真实 BaseButton；高度在此统一为 36px，五页一致 */
.service-hero__actions :deep(.base-btn) {
  min-height: 36px;
}

/* 运行事实：hero 卡片下方的一行键值，无容器；字段多时自然换行 */
.service-hero__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 22px;
  padding: 14px 0 0;
  font-family: var(--font-tabular);
  font-size: var(--text-xs);
  color: var(--t3);
}

.service-hero__facts :deep(span) {
  display: inline-flex;
  align-items: baseline;
}

.service-hero__facts :deep(b) {
  margin-left: 6px;
  font-weight: 400;
  color: var(--t2);
}

@media (pointer: coarse) {
  .service-hero__actions :deep(.base-btn) {
    min-height: 44px;
  }
}

@media (max-width: 768px) {
  .service-hero {
    min-height: 0;
    padding: 36px 16px 32px;
  }

  .service-hero__title {
    font-size: 20px;
  }

  .service-hero__facts {
    gap: 4px 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .service-hero--busy .service-hero__icon,
  .service-hero--warn:not(.service-hero--busy) .service-hero__icon {
    animation: none !important;
  }
}
</style>
