<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ListRow from '@/components/ui/ListRow.vue'
import { fmtBytes } from '@/utils/format'
import type { OverviewData, ServiceEntry } from '@/types/dashboard'
import type { SystemStats } from '@/types/system'
import { serviceIcon } from '@/config/serviceIdentity'

defineOptions({ name: 'DashboardDiagnostics' })

const props = defineProps<{
  initialLoading: boolean
  data: OverviewData | null
  sysStats: SystemStats | null
  orderedServices: ServiceEntry[]
  onlineServiceCount: number
  totalServiceCount: number
  /** 正在执行的动作: 行内动作提交期间互斥 (loading 精确到按钮, disabled 覆盖同行) */
  acting?: { name: string; action: string } | null
}>()

const emit = defineEmits<{
  (e: 'svcAction', name: string, action: string): void
}>()

const { t } = useI18n({ useScope: 'global' })

const diagSummary = computed(() => {
  return t('dashboard.diagnostics.summary', {
    online: props.onlineServiceCount,
    total: props.totalServiceCount,
  })
})

// ── 服务行的身份 ──────────────────────────────────────────────────────
// 列表按“用户在面板上认识的名字”渲染（ComfyUI / Jupyter / 云同步 / 隧道），
// pm2 内部名只用于取数据，并留在名称的 title 里供排障时悬停查看。
const SVC_IDENTITY: Record<string, { nameKey: string }> = {
  comfy: { nameKey: 'comfyui' },
  'cf-tunnel': { nameKey: 'tunnel' },
  jupyter: { nameKey: 'jupyter' },
  'sync-worker': { nameKey: 'sync' },
  dashboard: { nameKey: 'dashboard' },
}

function svcName(name: string): string {
  const id = SVC_IDENTITY[name]
  return id ? t(`dashboard.services.${id.nameKey}`) : name
}

function svcIcon(name: string): string {
  return serviceIcon(name)
}

function fmtSvcMem(bytes: number | string | undefined) {
  if (bytes === '-' || bytes === undefined || bytes === null) return '-'
  const n = Number(bytes)
  if (!n) return '-'
  return fmtBytes(n)
}

function fmtSvcCpu(cpu: number | string | undefined) {
  if (cpu === '-' || cpu === undefined || cpu === null) return '-'
  const n = Number(cpu)
  if (isNaN(n)) return '-'
  return `${n.toFixed(1)}%`
}

function fmtSvcUptime(ms: number | string | undefined) {
  if (ms === '-' || ms === undefined || ms === null) return '-'
  const n = Number(ms)
  if (!n || isNaN(n)) return '-'
  const sec = Math.floor((Date.now() - n) / 1000)
  if (sec < 0) return '-'
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h`
}

function svcStatusTone(st?: string): 'running' | 'stopped' | 'loading' | 'error' {
  if (!st) return 'stopped'
  const s = st.toLowerCase()
  if (['online', 'running'].includes(s)) return 'running'
  if (['starting', 'launching', 'connecting'].includes(s)) return 'loading'
  if (['errored', 'error', 'failed'].includes(s)) return 'error'
  return 'stopped'
}

// pm2 的原始状态是英文，列表里一律走词表（与上方服务微卡同一套词）
function svcStatusText(st?: string): string {
  const s = (st || '').toLowerCase()
  if (['online', 'running'].includes(s)) return t('dashboard.services.online')
  if (['starting', 'launching', 'busy'].includes(s)) return t('dashboard.services.starting')
  if (s === 'connecting') return t('dashboard.services.connecting')
  if (['errored', 'error', 'failed'].includes(s)) return t('dashboard.services.error')
  if (s === 'offline') return t('dashboard.services.offline')
  return t('dashboard.services.stopped')
}

// 副行事实：缺值的那一项直接不渲染（不打 `-`，避免 `- · - · -` 这种行）
function svcFacts(svc: ServiceEntry): string[] {
  return [
    metaFact('dashboard.services.meta_uptime', fmtSvcUptime(svc.uptime)),
    metaFact('dashboard.services.meta_cpu', fmtSvcCpu(svc.cpu)),
    metaFact('dashboard.services.meta_memory', fmtSvcMem(svc.memory)),
    metaFact('dashboard.services.meta_restarts', svc.restarts == null ? '-' : String(svc.restarts)),
  ].filter(Boolean)
}

function metaFact(key: string, value: string): string {
  return value === '-' ? '' : t(key, { value })
}

// ── 环境事实行 ────────────────────────────────────────────────────────
// 只放 hero 没有的信息（hero 那行已经写着 ComfyCarry / ComfyUI 版本）。
function shortGpuName(name: string): string {
  return name.replace(/^NVIDIA\s+(GeForce\s+)?/i, '').replace(/^AMD\s+/i, '')
}

const envFacts = computed(() => {
  const facts: { label: string; value: string }[] = []
  const gpu = props.sysStats?.gpu?.[0]
  const cores = props.sysStats?.cpu?.cores
  const ramTotal = props.sysStats?.memory?.total
  const pytorch = props.data?.comfyui?.pytorch_version
  const python = props.data?.comfyui?.python_version

  if (pytorch) facts.push({ label: 'PyTorch', value: pytorch })
  if (python) facts.push({ label: 'Python', value: python.split(' ')[0] })
  if (gpu?.name) {
    const vram = gpu.mem_total ? ` ${(gpu.mem_total / 1024).toFixed(0)} GB` : ''
    facts.push({ label: 'GPU', value: `${shortGpuName(gpu.name)}${vram}` })
  }
  if (cores) facts.push({ label: 'CPU', value: t('dashboard.diagnostics.cores', { n: cores }) })
  if (ramTotal) facts.push({ label: t('dashboard.services.memory'), value: fmtBytes(ramTotal) })

  return facts
})
</script>

<template>
  <section class="dash-section">
    <div class="dash-section-header">
      <div class="dash-section-tagline">
        <span class="dash-accent-bar"></span>
        <span class="dash-tagline-text">{{ t('dashboard.taglines.diagnostics') }}</span>
      </div>
      <div class="dash-section-title-row">
        <h2 class="dash-section-title">{{ t('dashboard.diagnostics.title') }}</h2>
        <span class="dash-diagnostics__meta">
          {{ diagSummary }}
        </span>
      </div>
    </div>

    <!-- Initial loading -->
    <div v-if="initialLoading && !data" class="dash-diagnostics__loading">
      <div class="dash-spinner"></div>
      <span>{{ t('common.status.loading') }}</span>
    </div>

    <!-- 服务进程列表：无背景无表头，一行 = 图标 + 名称与状态 + 副行指标 + 行尾图标动作 -->
    <template v-else-if="data">
      <ul class="list-plain">
        <ListRow
          v-for="svc in orderedServices"
          :key="svc.name"
          :icon="svcIcon(svc.name)"
          :title="svcName(svc.name)"
          :title-tooltip="svc.name"
          :status="{ tone: svcStatusTone(svc.status), text: svcStatusText(svc.status) }"
          :facts="svcFacts(svc)"
        >
          <template #actions>
            <BaseButton
              v-if="svc.status === 'online'"
              variant="ghost"
              size="sm"
              icon-only
              :title="`${t('common.btn.stop')} ${svcName(svc.name)}`"
              :aria-label="`${t('common.btn.stop')} ${svcName(svc.name)}`"
              :disabled="!!acting"
              :loading="acting?.name === svc.name && acting?.action === 'stop'"
              @click="emit('svcAction', svc.name, 'stop')"
            >
              <MsIcon name="stop" />
            </BaseButton>
            <BaseButton
              v-if="svc.status === 'online'"
              variant="ghost"
              size="sm"
              icon-only
              :title="`${t('common.btn.restart')} ${svcName(svc.name)}`"
              :aria-label="`${t('common.btn.restart')} ${svcName(svc.name)}`"
              :disabled="!!acting"
              :loading="acting?.name === svc.name && acting?.action === 'restart'"
              @click="emit('svcAction', svc.name, 'restart')"
            >
              <MsIcon name="restart_alt" />
            </BaseButton>
            <BaseButton
              v-else
              variant="ghost"
              size="sm"
              icon-only
              :title="`${t('common.btn.start')} ${svcName(svc.name)}`"
              :aria-label="`${t('common.btn.start')} ${svcName(svc.name)}`"
              :disabled="!!acting"
              :loading="acting?.name === svc.name && acting?.action === 'start'"
              @click="emit('svcAction', svc.name, 'start')"
            >
              <MsIcon name="play_arrow" />
            </BaseButton>
          </template>
        </ListRow>
      </ul>

      <!-- 环境事实行：标签 + 值，小字、无容器 -->
      <div v-if="envFacts.length" class="dash-facts">
        <span v-for="fact in envFacts" :key="fact.label">
          {{ fact.label }}<b>{{ fact.value }}</b>
        </span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.dash-diagnostics__meta {
  font-size: var(--text-sm);
  color: var(--t3);
  font-family: var(--font-tabular);
}

.dash-diagnostics__loading {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--t3);
  font-size: var(--text-sm);
}

/* 服务行本身用 ListRow（图标 + 主副文案 + 行尾动作 + 命中区都在组件里）；
   这里只剩“环境事实行”，与设计稿的 facts 行同构（标签 + 值，小字，无 chip） */
.dash-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 22px;
  margin-top: 2px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
  font-size: var(--text-xs);
  color: var(--t3);
}

.dash-facts > span {
  display: inline-flex;
  align-items: baseline;
}

.dash-facts b {
  margin-left: 6px;
  font-weight: 400;
  color: var(--t2);
  font-family: var(--font-tabular);
}

/* 窄屏：行收成两列，动作换到第二列右对齐（与设计稿的移动端规则一致） */
@media (max-width: 768px) {
  .dash-facts {
    gap: 4px 16px;
  }
}
</style>
