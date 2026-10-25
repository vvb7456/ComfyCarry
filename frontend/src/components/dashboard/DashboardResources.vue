<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UsageBar from '@/components/ui/UsageBar.vue'
import { fmtBytes } from '@/utils/format'
import type { SystemStats } from '@/types/system'

defineOptions({ name: 'DashboardResources' })

const props = defineProps<{
  stats: SystemStats | null
  initialLoading: boolean
}>()

const { t } = useI18n({ useScope: 'global' })

function capacity(bytes: number) {
  const [value, unit] = fmtBytes(bytes).split(' ')
  return { value: String(Math.round(Number(value) * 10) / 10), unit }
}

const resources = computed(() => {
  const gpu = props.stats?.gpu?.[0]
  const gpuTotal = (gpu?.mem_total ?? 0) * 1024 ** 2
  const gpuUsed = (gpu?.mem_used ?? 0) * 1024 ** 2
  const disk = props.stats?.disk
  const diskPercent = disk?.percent ?? 0

  return [
    {
      id: 'gpu',
      label: t('dashboard.gpu.title'),
      total: gpuTotal,
      used: gpuUsed,
      free: capacity(Math.max(0, gpuTotal - gpuUsed)),
      percent: gpuTotal > 0 ? Math.min(100, Math.max(0, gpuUsed / gpuTotal * 100)) : 0,
      color: 'var(--ac)',
      detail: [gpu?.name, gpu?.temp != null ? `${gpu.temp}°C` : ''].filter(Boolean).join(' · '),
      unavailable: t('dashboard.gpu.not_detected'),
    },
    {
      id: 'disk',
      label: t('dashboard.disk.title'),
      total: disk?.total ?? 0,
      used: disk?.used ?? 0,
      free: capacity(disk?.free ?? 0),
      percent: diskPercent,
      color: diskPercent >= 95 ? 'var(--red)' : diskPercent >= 90 ? 'var(--amber)' : 'var(--t3)',
      detail: disk?.path ?? '',
      unavailable: t('dashboard.disk.unavailable'),
    },
  ]
})

function usageDetail(resource: (typeof resources.value)[number]) {
  return t('dashboard.resources.usage_detail', {
    used: fmtBytes(resource.used),
    total: fmtBytes(resource.total),
    pct: resource.percent.toFixed(1),
  })
}
</script>

<template>
  <div class="dash-resources" :aria-busy="!stats && initialLoading">
    <div v-for="resource in resources" :key="resource.id" class="dash-resource">
      <div class="dash-resource__label" :title="resource.detail">
        {{ resource.label }}
      </div>

      <template v-if="!stats && initialLoading">
        <div class="dash-resource__value">
          <span class="dash-resource__skeleton dash-resource__skeleton--value"></span>
        </div>
        <div class="dash-resource__skeleton dash-resource__skeleton--bar"></div>
        <div class="dash-resource__footer">
          <span class="dash-resource__skeleton dash-resource__skeleton--text"></span>
        </div>
      </template>

      <template v-else-if="resource.total > 0">
        <div class="dash-resource__value">
          <span>{{ resource.free.value }}</span>
          <span class="dash-resource__unit">{{ resource.free.unit }}</span>
        </div>
        <UsageBar
          :percent="resource.percent"
          :height="3"
          :base-color="resource.color"
          :aria-label="resource.label"
          :aria-valuetext="usageDetail(resource)"
          :title="usageDetail(resource)"
        />
        <div class="dash-resource__footer" :title="usageDetail(resource)">
          <span>{{ t('dashboard.resources.total', { size: fmtBytes(resource.total) }) }}</span>
          <span :style="{ color: resource.color }">
            {{ t('dashboard.resources.used_pct', { pct: Math.round(resource.percent) }) }}
          </span>
        </div>
      </template>

      <template v-else>
        <div class="dash-resource__value dash-resource__value--empty">—</div>
        <div class="dash-resource__empty-bar"></div>
        <div class="dash-resource__footer">{{ resource.unavailable }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dash-resources {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
  padding: var(--sp-6);
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  box-shadow: var(--sh);
}

.dash-resource {
  min-width: 0;
  padding-inline-end: 28px;
}

.dash-resource + .dash-resource {
  padding-inline: 28px 0;
  border-inline-start: 1px solid var(--bd);
}

.dash-resource__label {
  color: var(--t2);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1.5;
}

.dash-resource__value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 38px;
  margin: 12px 0 24px;
  color: var(--t1);
  font-family: var(--font-tabular);
  font-size: 2rem;
  font-weight: 500;
  letter-spacing: -0.055em;
  line-height: 1.2;
}

.dash-resource__unit {
  color: var(--t3);
  font-size: var(--text-sm);
  font-weight: 400;
  letter-spacing: 0;
}

.dash-resource__footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 10px;
  color: var(--t3);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}

.dash-resource__value--empty {
  color: var(--t3);
}

.dash-resource__empty-bar,
.dash-resource__skeleton {
  background: color-mix(in srgb, var(--t3) 14%, transparent);
  border-radius: var(--r-xs);
}

.dash-resource__empty-bar,
.dash-resource__skeleton--bar {
  height: 3px;
}

.dash-resource__skeleton {
  display: block;
  animation: pulse 1.5s ease-in-out infinite;
}

.dash-resource__skeleton--value {
  width: 70%;
  height: 32px;
}

.dash-resource__skeleton--text {
  width: 100%;
  height: 17px;
}

@container page (max-width: 420px) {
  .dash-resources {
    padding: var(--sp-5) var(--sp-4);
  }

  .dash-resource {
    padding-inline-end: var(--sp-4);
  }

  .dash-resource + .dash-resource {
    padding-inline-start: var(--sp-4);
  }

  .dash-resource__value {
    font-size: 1.625rem;
  }
}
</style>
