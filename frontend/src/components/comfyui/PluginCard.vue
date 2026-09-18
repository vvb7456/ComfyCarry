<script setup lang="ts">
/**
 * PluginCard — 插件对象行 (C08, 需求 8.3)。
 *
 * 复用统一 ListRow: 语义徽章 + 描述 + 事实行 (仓库名带外链) + 行尾纯图标操作。
 * 危险操作 (删除) 置于末位; 操作过程由 PluginOpModal 阻塞弹窗承载。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ListRow from '@/components/ui/ListRow.vue'
import type { ListRowBadge, ListRowFact } from '@/components/ui/ListRow.vue'
import type { PluginData } from '@/types/plugins'

defineOptions({ name: 'PluginCard' })

const props = defineProps<{
  plugin: PluginData
  /** 有变更待重启生效 */
  pending?: boolean
}>()

const emit = defineEmits<{
  install: []
  uninstall: []
  update: []
  toggle: []
  version: []
}>()

const { t } = useI18n()

function shortHash(h: string) { return h && h.length > 8 ? h.substring(0, 8) : (h || 'unknown') }

function displayVersion(): string {
  const p = props.plugin
  if (p.installed) {
    if (p.activeVersion === 'nightly') return shortHash(p.ver)
    return p.activeVersion || shortHash(p.ver)
  }
  return p.registryVersion || ''
}

const facts = computed<Array<string | ListRowFact>>(() => {
  const p = props.plugin
  const out: Array<string | ListRowFact> = []
  const source = p.id || p.dirName
  if (source) out.push(p.repository ? { text: source, href: p.repository } : source)
  const version = displayVersion()
  if (version) {
    out.push(p.installed && p.activeVersion === 'nightly' ? version : `v${version}`)
  }
  if (p.cnrLatest && p.installed && p.cnrLatest !== version) out.push(`latest ${p.cnrLatest}`)
  if ((p.stars ?? 0) > 0) out.push(`${p.stars}`)
  if (p.author) out.push(p.author)
  if (p.lastUpdate && !p.installed) out.push(p.lastUpdate.slice(0, 10))
  return out
})

const rowBadges = computed<ListRowBadge[]>(() => {
  const p = props.plugin
  const out: ListRowBadge[] = []
  if (props.pending) out.push({ text: t('plugins.restart.pending_badge'), tone: 'caution' })
  if (p.updateState) out.push({ text: t('plugins.installed.has_update'), tone: 'caution' })
  if (p.installed) {
    out.push(p.enabled
      ? { text: t('plugins.installed.installed_badge'), tone: 'positive' }
      : { text: t('plugins.installed.disabled'), tone: 'neutral' })
  } else {
    out.push({ text: t('plugins.browse.not_installed'), tone: 'neutral' })
  }
  return out
})
</script>

<template>
  <ListRow
    icon="extension"
    :title="plugin.title"
    :badges="rowBadges"
    :description="plugin.description || undefined"
    :facts="facts"
  >
    <template #actions>
      <template v-if="plugin.installed">
        <BaseButton
          v-if="plugin.updateState"
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.installed.update')"
          @click="emit('update')"
        >
          <MsIcon name="update" />
        </BaseButton>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.installed.version')"
          @click="emit('version')"
        >
          <MsIcon name="swap_horiz" />
        </BaseButton>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="plugin.enabled ? t('plugins.installed.disable') : t('plugins.installed.enable')"
          @click="emit('toggle')"
        >
          <MsIcon :name="plugin.enabled ? 'toggle_on' : 'toggle_off'" />
        </BaseButton>
        <BaseButton
          variant="danger" size="sm" icon-only
          :aria-label="t('plugins.installed.remove')"
          @click="emit('uninstall')"
        >
          <MsIcon name="delete" />
        </BaseButton>
      </template>
      <template v-else>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.browse.install')"
          @click="emit('install')"
        >
          <MsIcon name="download" />
        </BaseButton>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.installed.version')"
          @click="emit('version')"
        >
          <MsIcon name="swap_horiz" />
        </BaseButton>
      </template>
    </template>
  </ListRow>
</template>
