<script setup lang="ts">
/**
 * GpuMetricsCard — 单块 GPU 的四张指标卡 (C08, 需求 8.2)。
 *
 * 一块 GPU 一组四张卡: 利用率 / 显存 / 温度 / 功耗。
 * 每张卡固定「标签 → 主数值 → 细条 → 次级事实」四行, 次级事实只用后端原生读数。
 * 条统一主题色, 温度在 temp_limit 有效时按阈值归一化, 缺失时保留中性轨道。
 * null 读数保留结构, 值显示 ——; 0 是有效值照常显示。
 * 手机端 (≤768px) 一块 GPU 收为一张卡, 四组指标顺序不变。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UsageBar from '@/components/ui/UsageBar.vue'
import type { GpuInfo } from '@/types/system'

defineOptions({ name: 'GpuMetricsCard' })

const props = defineProps<{ gpu: GpuInfo }>()

const { t } = useI18n({ useScope: 'global' })

function has(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && !Number.isNaN(v)
}

/** 主数值格式化: 0 有效, null/缺失显示 — */
function num(v: number | null | undefined, unit = ''): string {
  return has(v) ? `${Math.round(v)}${unit}` : '—'
}

/** 显存读数 (MB) 换算成可读容量 */
function mb(v: number | null | undefined): string {
  // 与总览 Hero 一致: MiB → GB 四舍五入一位小数
  return has(v) ? `${(v / 1024).toFixed(1)} GB` : '—'
}

function pct(part: number | null | undefined, whole: number | null | undefined): number {
  if (!has(part) || !has(whole) || whole <= 0) return 0
  return (part / whole) * 100
}

const gpuLabel = computed(() => {
  const g = props.gpu
  const idx = `GPU${has(g.index) ? g.index : ''}`
  return g.name ? `${idx} · ${g.name}` : idx
})

const metrics = computed(() => {
  const g = props.gpu
  const tempLimitValid = has(g.temp_limit) && g.temp_limit > 0
  return [
    {
      key: 'util',
      label: t('comfyui.gpu.utilization'),
      value: num(g.util, ' %'),
      percent: has(g.util) ? g.util : 0,
      subLabel: t('comfyui.gpu.clock'),
      subValue: num(g.clock_sm, ' MHz'),
    },
    {
      key: 'mem',
      label: t('comfyui.gpu.memory'),
      value: `${mb(g.mem_used)} / ${mb(g.mem_total)}`,
      percent: pct(g.mem_used, g.mem_total),
      subLabel: t('comfyui.gpu.free'),
      subValue: mb(g.mem_free),
    },
    {
      key: 'temp',
      label: t('comfyui.gpu.temperature'),
      value: num(g.temp, ' °C'),
      percent: tempLimitValid ? (g.temp as number) / (g.temp_limit as number) * 100 : 0,
      subLabel: t('comfyui.gpu.fan'),
      subValue: num(g.fan, ' %'),
    },
    {
      key: 'power',
      label: t('comfyui.gpu.power'),
      value: num(g.power, ' W'),
      percent: pct(g.power, g.power_limit),
      subLabel: t('comfyui.gpu.limit'),
      subValue: num(g.power_limit, ' W'),
    },
  ]
})
</script>

<template>
  <div class="gpu-block">
    <div class="gpu-block__name">{{ gpuLabel }}</div>
    <div class="gpu-block__cards">
      <div v-for="metric in metrics" :key="metric.key" class="gpu-metric">
        <span class="gpu-metric__label">{{ metric.label }}</span>
        <span class="gpu-metric__value">{{ metric.value }}</span>
        <UsageBar :percent="metric.percent" :height="4" />
        <span class="gpu-metric__sub">
          <span class="gpu-metric__sub-k">{{ metric.subLabel }}</span>
          <span class="gpu-metric__sub-v">{{ metric.subValue }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gpu-block {
  padding: 14px 0;
}

.gpu-block + .gpu-block {
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
}

.gpu-block__name {
  margin-bottom: 10px;
  color: var(--t2);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gpu-block__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.gpu-metric {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  background: var(--bg3);
}

.gpu-metric__label {
  color: var(--t3);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gpu-metric__value {
  color: var(--t1);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -.3px;
  font-family: var(--font-tabular);
  line-height: 1.1;
}

.gpu-metric__sub {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--t3);
  font-size: var(--text-xs);
  font-family: var(--font-tabular);
  white-space: nowrap;
  overflow: hidden;
}

.gpu-metric__sub-k {
  color: var(--t3);
}

.gpu-metric__sub-v {
  color: var(--t2);
}

/* 手机端: 一块 GPU 收成一张卡, 四组指标顺序不变 */
@media (max-width: 768px) {
  .gpu-block {
    padding: 12px 14px;
    border: 1px solid var(--bd);
    border-radius: var(--rs);
    background: var(--bg3);
  }

  .gpu-block + .gpu-block {
    border-top: 1px solid var(--bd);
    margin-top: 10px;
  }

  .gpu-block__cards {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .gpu-metric {
    padding: 10px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .gpu-metric + .gpu-metric {
    border-top: 1px solid color-mix(in srgb, var(--bd) 55%, transparent);
  }
}
</style>
