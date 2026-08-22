<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useI18n } from 'vue-i18n'
import type { PluginData } from '@/types/plugins'

defineOptions({ name: 'PluginCard' })

const props = defineProps<{
  plugin: PluginData
  /** 进行中的操作: 对应按钮转 spinner, 其余按钮禁用 */
  op?: 'install' | 'uninstall' | 'update' | 'toggle' | null
  /** 行级错误原文 (Manager done 事件的失败信息) */
  error?: string
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

const { t } = useI18n({ useScope: 'global' })

const busy = computed(() => !!props.op)

// 错误条展示状态: error 出现即显示, 手动关闭; 换新错误重新弹出
const errVisible = ref(false)
watch(() => props.error, (v) => { errVisible.value = !!v })

function shortHash(h: string) { return h && h.length > 8 ? h.substring(0, 8) : (h || 'unknown') }

function displayVersion(): string {
  const p = props.plugin
  if (p.installed) {
    if (p.activeVersion === 'nightly') return shortHash(p.ver)
    return p.activeVersion || shortHash(p.ver)
  }
  return p.registryVersion || ''
}
</script>

<template>
  <div class="plugin-item">
    <div class="plugin-item-header">
      <div class="plugin-item-title text-truncate">
        <a v-if="plugin.repository" :href="plugin.repository" target="_blank">{{ plugin.title }}</a>
        <span v-else>{{ plugin.title }}</span>
      </div>
      <span v-if="pending" class="plugin-badge pending">{{ t('plugins.restart.pending_badge') }}</span>
      <span v-if="plugin.updateState" class="plugin-badge update">{{ t('plugins.installed.has_update') }}</span>
      <template v-if="plugin.installed">
        <span v-if="!plugin.enabled" class="plugin-badge disabled">{{ t('plugins.installed.disabled') }}</span>
        <span v-else class="plugin-badge installed">{{ t('plugins.installed.installed_badge') }}</span>
      </template>
      <span v-else class="plugin-badge not-installed">{{ t('plugins.browse.not_installed') }}</span>
    </div>
    <div v-if="plugin.description" class="plugin-item-desc">{{ plugin.description }}</div>
    <div class="plugin-item-meta">
      <span><MsIcon name="extension" /> {{ plugin.id || plugin.dirName }}</span>
      <span v-if="displayVersion()" :style="plugin.activeVersion === 'nightly' ? { color: 'var(--cyan)' } : undefined">
        <template v-if="plugin.installed && plugin.activeVersion === 'nightly'"><MsIcon name="build" /> {{ displayVersion() }}</template>
        <template v-else>v{{ displayVersion() }}</template>
      </span>
      <span v-if="plugin.cnrLatest && plugin.installed" style="color:var(--t3)">(latest: {{ plugin.cnrLatest }})</span>
      <span v-if="(plugin.stars ?? 0) > 0"><MsIcon name="star" /> {{ plugin.stars }}</span>
      <span v-if="plugin.author"><MsIcon name="person" /> {{ plugin.author }}</span>
      <span v-if="plugin.lastUpdate && !plugin.installed"><MsIcon name="schedule" /> {{ plugin.lastUpdate.slice(0, 10) }}</span>
      <div class="plugin-item-actions">
        <template v-if="plugin.installed">
          <BaseButton v-if="plugin.updateState" variant="success" size="sm" :loading="op === 'update'" :disabled="busy" @click="emit('update')">{{ t('plugins.installed.update') }}</BaseButton>
          <BaseButton size="sm" :disabled="busy" @click="emit('version')">{{ t('plugins.installed.version') }}</BaseButton>
          <BaseButton v-if="!plugin.enabled" variant="primary" size="sm" :loading="op === 'toggle'" :disabled="busy" @click="emit('toggle')">{{ t('plugins.installed.enable') }}</BaseButton>
          <BaseButton v-else size="sm" :loading="op === 'toggle'" :disabled="busy" @click="emit('toggle')">{{ t('plugins.installed.disable') }}</BaseButton>
          <BaseButton variant="danger" size="sm" square :loading="op === 'uninstall'" :disabled="busy" @click="emit('uninstall')"><MsIcon name="delete" /></BaseButton>
        </template>
        <template v-else>
          <BaseButton variant="primary" size="sm" :loading="op === 'install'" :disabled="busy" @click="emit('install')">{{ t('plugins.browse.install') }}</BaseButton>
          <BaseButton size="sm" :disabled="busy" @click="emit('version')">{{ t('plugins.installed.version') }}</BaseButton>
        </template>
      </div>
    </div>
    <div v-if="errVisible && error" class="plugin-item-error">
      <span class="plugin-item-error-msg">{{ error }}</span>
      <BaseButton size="sm" @click="errVisible = false">{{ t('plugins.row.dismiss_error') }}</BaseButton>
    </div>
  </div>
</template>

<style scoped>
.plugin-item { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: clamp(14px, 1.2vw, 20px) clamp(16px, 1.5vw, 24px); margin-bottom: clamp(8px, 0.6vw, 12px); transition: border-color .15s; }
.plugin-item:hover { border-color: color-mix(in srgb, var(--ac) 34%, transparent); }
.plugin-item-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.plugin-item-title { font-size: .92rem; font-weight: 600; flex: 1; min-width: 0; }
.plugin-item-title a { color: var(--t1); text-decoration: none; }
.plugin-item-title a:hover { color: var(--ac); }
.plugin-item-desc { font-size: .8rem; color: var(--t2); line-height: 1.5; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.plugin-item-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: .75rem; color: var(--t3); }
.plugin-item-meta > span { display: inline-flex; align-items: center; gap: 4px; }
.plugin-item-actions { display: flex; gap: 6px; margin-left: auto; flex-shrink: 0; }
.plugin-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
.plugin-badge.installed { background: rgba(74, 222, 128, .15); color: var(--green); }
.plugin-badge.update { background: rgba(251, 191, 36, .15); color: var(--amber); }
.plugin-badge.disabled { background: rgba(152, 152, 176, .15); color: var(--t3); }
.plugin-badge.not-installed { background: rgba(96, 165, 250, .15); color: var(--blue); }
.plugin-badge.pending { background: rgba(251, 146, 60, .15); color: var(--orange, var(--amber)); }
.plugin-item-error { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 8px 12px; border-radius: var(--rs, 6px); background: color-mix(in srgb, var(--c-negative) 8%, var(--bg3)); border: 1px solid color-mix(in srgb, var(--c-negative) 25%, var(--bd)); }
.plugin-item-error-msg { flex: 1; min-width: 0; font-size: .78rem; line-height: 1.45; color: var(--c-negative); word-break: break-word; white-space: pre-wrap; }
</style>
