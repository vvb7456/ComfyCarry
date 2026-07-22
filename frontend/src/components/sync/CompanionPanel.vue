<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import type { CompanionClient } from '@/types/sync'
import { useClipboard } from '@/composables/useClipboard'

defineOptions({ name: 'CompanionPanel' })

const props = defineProps<{
  clients: CompanionClient[]
  serve: { running: boolean; pid?: number; addr?: string; baseurl?: string; serve_root?: string } | null
  davUrl: string
  loading?: boolean
}>()

const emit = defineEmits<{
  'forget-client': [clientId: string]
  refresh: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { copy } = useClipboard()

const onlineCount = computed(() => props.clients.filter(c => c.online).length)

function fmtRelative(epoch: number) {
  if (!epoch) return t('sync.companion.never_seen')
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (sec < 10) return t('sync.companion.just_now')
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return new Date(epoch * 1000).toLocaleDateString()
}

function fmtSpeed(bps?: number) {
  if (!bps || bps <= 0) return ''
  if (bps < 1024) return `${bps} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

function methodLabel(m?: string) {
  if (!m) return ''
  const key = `sync.rules.method_short.${m}`
  return t(key) === key ? m : t(key)
}

function triggerLabel(tr?: string) {
  if (!tr) return ''
  const key = `sync.rules.${tr}`
  return t(key) === key ? tr : t(key)
}

function statusKey(s: string) {
  const known = ['idle', 'syncing', 'pulling', 'busy', 'paused', 'error']
  return `sync.companion.status_${known.includes(s) ? s : 'idle'}`
}

function isPulling(c: CompanionClient) {
  return ['syncing', 'pulling', 'busy'].includes(c.status || '')
}

async function copyDav() {
  if (props.davUrl) await copy(props.davUrl)
}

function onForget(c: CompanionClient) {
  emit('forget-client', c.client_id)
}
</script>

<template>
  <!-- ── 传输服务 ── -->
  <SectionHeader icon="cloud" flush>
    {{ t('sync.companion.serve_title') }}
    <template #actions>
      <BaseButton variant="ghost" size="xs" :disabled="loading" @click="emit('refresh')">
        <MsIcon name="refresh" size="xs" />
      </BaseButton>
      <HelpTip :text="t('sync.companion.description')" />
    </template>
  </SectionHeader>

  <div class="serve-grid">
    <div class="serve-cell">
      <div class="cell-k">{{ t('sync.companion.serve_state') }}</div>
      <div class="cell-v">
        <StatusDot :status="serve?.running ? 'online' : 'offline'" size="sm" />
        <span :class="serve?.running ? 'ok' : 'muted'">
          {{ serve?.running ? t('sync.companion.serve_running') : t('sync.companion.serve_stopped') }}
        </span>
        <span v-if="serve?.running && serve.addr" class="cell-note">{{ serve.addr }}</span>
      </div>
    </div>

    <div class="serve-cell">
      <div class="cell-k">{{ t('sync.companion.serve_root_label') }}</div>
      <div class="cell-v"><code class="mono">{{ serve?.serve_root || '—' }}</code></div>
    </div>

    <div class="serve-cell span-2">
      <div class="cell-k">{{ t('sync.companion.dav_url') }}</div>
      <div class="cell-v">
        <code class="mono grow">{{ davUrl || '—' }}</code>
        <BaseButton size="xs" square :disabled="!davUrl" :title="t('common.btn.copy')" @click="copyDav">
          <MsIcon name="content_copy" size="xs" />
        </BaseButton>
      </div>
    </div>
  </div>

  <!-- ── 已连客户端 ── -->
  <SectionHeader icon="monitor" class="clients-head">
    {{ t('sync.companion.clients_title') }}
    <template #actions>
      <span v-if="clients.length" class="clients-count">
        {{ clients.length }} · {{ onlineCount }} {{ t('sync.companion.online_short') }}
      </span>
    </template>
  </SectionHeader>

  <EmptyState
    v-if="!clients.length"
    icon="monitor"
    density="compact"
    :message="t('sync.companion.no_clients')"
  />

  <div v-else class="clients-grid">
    <div
      v-for="c in clients"
      :key="c.client_id"
      class="client-card"
      :class="{ offline: !c.online, pulling: isPulling(c) }"
    >
      <button class="forget-btn" :title="t('sync.companion.forget')" @click="onForget(c)">
        <MsIcon name="close" size="xs" />
      </button>

      <div class="c-top">
        <div class="c-avatar"><MsIcon name="monitor" /></div>
        <div class="c-id">
          <div class="c-name">{{ c.hostname || c.client_id }}</div>
          <div class="c-sub">
            <span v-if="c.app_version" class="mono">v{{ c.app_version }}</span>
            <span class="c-online">
              <StatusDot :status="c.online ? 'online' : 'offline'" size="sm" />
              {{ c.online ? t('sync.companion.client_online') : t('sync.companion.client_offline') }}
            </span>
          </div>
        </div>
      </div>

      <div class="c-status">
        <span class="pill" :class="`st-${c.status || 'idle'}`">
          <MsIcon name="wifi_tethering" size="xxs" /> {{ t(statusKey(c.status)) }}
        </span>
        <span class="hb"><MsIcon name="schedule" size="xxs" /> {{ fmtRelative(c.last_seen) }}</span>
      </div>

      <!-- 拉取进度 -->
      <div v-if="isPulling(c) && c.progress" class="c-prog">
        <div class="prog-line">
          <span class="prog-file mono" v-if="c.progress.file">{{ c.progress.file }}</span>
          <span class="prog-pct mono" v-if="c.progress.pct != null">{{ Math.round(c.progress.pct) }}%</span>
        </div>
        <UsageBar v-if="c.progress.pct != null" :percent="c.progress.pct" :height="4" />
        <span class="prog-speed mono" v-if="c.progress.speed">{{ fmtSpeed(c.progress.speed) }}</span>
      </div>

      <!-- 规则只读镜像 -->
      <div class="c-rules">
        <div class="rules-k">{{ t('sync.companion.client_rules') }}</div>
        <div v-if="!(c.rule_summaries && c.rule_summaries.length)" class="rules-empty">
          {{ t('sync.companion.no_rules') }}
        </div>
        <div
          v-for="(r, i) in (c.rule_summaries || [])"
          :key="i"
          class="rule-row"
        >
          <MsIcon name="cloud_download" size="xs" class="rule-ic" />
          <span class="rule-path mono">
            {{ r.source || 'output' }} <span class="arrow">→</span> {{ r.local_path || '—' }}
          </span>
          <span v-if="r.method" class="chip" :class="`m-${r.method}`">{{ methodLabel(r.method) }}</span>
          <span v-if="r.trigger" class="chip m-watch">{{ triggerLabel(r.trigger) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 传输服务 */
.serve-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--bd);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  margin: 8px 0 4px;
}
.serve-cell { background: var(--bg3); padding: 11px 14px; display: flex; flex-direction: column; gap: 6px; }
.serve-cell.span-2 { grid-column: 1 / -1; }
.cell-k { font-size: .68rem; letter-spacing: .04em; text-transform: uppercase; color: var(--t3); }
.cell-v { display: flex; align-items: center; gap: 8px; font-size: .84rem; font-weight: 500; }
.cell-v .ok { color: var(--green); font-weight: 600; }
.cell-v .muted { color: var(--t3); font-weight: 600; }
.cell-note { color: var(--t3); font-size: .72rem; font-weight: 400; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .76rem; }
code.mono { background: var(--bg2); padding: 2px 8px; border-radius: 6px; color: var(--t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
code.mono.grow { flex: 1; min-width: 0; }

/* 已连客户端 */
.clients-head { margin-top: 22px; }
.clients-count { font-size: .74rem; color: var(--t3); font-variant-numeric: tabular-nums; }
.clients-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(300px, 24vw, 440px), 1fr));
  gap: 14px;
  margin-top: 6px;
}
.client-card {
  position: relative;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.client-card.pulling { border-color: color-mix(in srgb, var(--amber) 45%, var(--bd)); }
.client-card.offline { opacity: .7; }
.forget-btn {
  position: absolute; top: 10px; right: 10px;
  width: 24px; height: 24px; border-radius: 7px;
  border: 1px solid var(--bd); background: none; color: var(--t3);
  cursor: pointer; display: grid; place-items: center; transition: .15s;
}
.forget-btn:hover { color: var(--red); border-color: var(--red); }

.c-top { display: flex; align-items: flex-start; gap: 11px; padding-right: 26px; }
.c-avatar { width: 36px; height: 36px; border-radius: 9px; background: var(--bg2); color: var(--t2); display: grid; place-items: center; flex: none; }
.client-card.pulling .c-avatar { background: color-mix(in srgb, var(--amber) 16%, transparent); color: var(--amber); }
.c-id { min-width: 0; flex: 1; }
.c-name { font-size: .92rem; font-weight: 640; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-sub { display: flex; align-items: center; gap: 10px; margin-top: 3px; font-size: .72rem; color: var(--t3); }
.c-online { display: inline-flex; align-items: center; gap: 4px; }

.c-status { display: flex; align-items: center; gap: 8px; }
.pill { display: inline-flex; align-items: center; gap: 4px; font-size: .72rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--bg2); color: var(--t2); }
.pill.st-syncing, .pill.st-pulling, .pill.st-busy { color: var(--amber); background: color-mix(in srgb, var(--amber) 14%, transparent); }
.pill.st-error { color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent); }
.pill.st-idle { color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent); }
.hb { display: inline-flex; align-items: center; gap: 3px; font-size: .72rem; color: var(--t3); font-variant-numeric: tabular-nums; }

.c-prog { display: flex; flex-direction: column; gap: 6px; background: var(--bg2); border-radius: 8px; padding: 8px 10px; }
.prog-line { display: flex; justify-content: space-between; gap: 8px; font-size: .72rem; color: var(--t2); }
.prog-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prog-pct { color: var(--amber); font-weight: 600; }
.prog-speed { font-size: .7rem; color: var(--green); }

.c-rules { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--bd); padding-top: 11px; }
.rules-k { font-size: .68rem; letter-spacing: .04em; text-transform: uppercase; color: var(--t3); }
.rules-empty { font-size: .76rem; color: var(--t3); }
.rule-row { display: flex; align-items: center; gap: 8px; background: var(--bg2); border-radius: 8px; padding: 7px 10px; }
.rule-ic { color: var(--blue); flex: none; }
.rule-path { flex: 1; min-width: 0; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rule-path .arrow { color: var(--t3); margin: 0 2px; }
.chip { flex: none; font-size: .66rem; font-weight: 600; padding: 2px 7px; border-radius: 6px; background: var(--bg3); color: var(--t2); }
.chip.m-copy { color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent); }
.chip.m-move { color: var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent); }
.chip.m-sync { color: var(--blue); background: color-mix(in srgb, var(--blue) 12%, transparent); }
.chip.m-watch { color: var(--t2); }
</style>
