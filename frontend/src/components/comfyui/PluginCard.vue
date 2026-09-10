<script setup lang="ts">
/**
 * PluginCard — 插件对象行 (C08, 需求 8.3)。
 *
 * 对齐 ListRow 骨架: 图标 + 主行 (名称链接 / 分类徽章) + 描述 + 事实行 + 行尾纯图标操作。
 * 危险操作 (删除) 置于末位; 进行中的操作转 spinner 并禁用其余按钮。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
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

const facts = computed<string[]>(() => {
  const p = props.plugin
  const out: string[] = []
  const source = p.id || p.dirName
  if (source) out.push(source)
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
</script>

<template>
  <li class="plugin-row">
    <span class="plugin-row__icon" aria-hidden="true"><MsIcon name="extension" size="md" /></span>

    <div class="plugin-row__main">
      <div class="plugin-row__head">
        <a
          v-if="plugin.repository"
          class="plugin-row__title"
          :href="plugin.repository"
          target="_blank"
          rel="noopener"
        >{{ plugin.title }}</a>
        <span v-else class="plugin-row__title">{{ plugin.title }}</span>

        <Badge v-if="pending" tone="caution">{{ t('plugins.restart.pending_badge') }}</Badge>
        <Badge v-if="plugin.updateState" tone="caution">{{ t('plugins.installed.has_update') }}</Badge>
        <template v-if="plugin.installed">
          <Badge v-if="!plugin.enabled" tone="neutral">{{ t('plugins.installed.disabled') }}</Badge>
          <Badge v-else tone="positive">{{ t('plugins.installed.installed_badge') }}</Badge>
        </template>
        <Badge v-else tone="neutral">{{ t('plugins.browse.not_installed') }}</Badge>
      </div>

      <div v-if="plugin.description" class="plugin-row__desc">{{ plugin.description }}</div>

      <div v-if="facts.length" class="plugin-row__facts">
        <span v-for="fact in facts" :key="fact">{{ fact }}</span>
      </div>
    </div>

    <div class="plugin-row__actions">
      <template v-if="plugin.installed">
        <BaseButton
          v-if="plugin.updateState"
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.installed.update')"
          :loading="op === 'update'"
          :disabled="busy"
          @click="emit('update')"
        >
          <MsIcon name="update" />
        </BaseButton>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.installed.version')"
          :disabled="busy"
          @click="emit('version')"
        >
          <MsIcon name="swap_horiz" />
        </BaseButton>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="plugin.enabled ? t('plugins.installed.disable') : t('plugins.installed.enable')"
          :loading="op === 'toggle'"
          :disabled="busy"
          @click="emit('toggle')"
        >
          <MsIcon :name="plugin.enabled ? 'pause' : 'play_arrow'" />
        </BaseButton>
        <BaseButton
          variant="danger" size="sm" icon-only
          :aria-label="t('plugins.installed.remove')"
          :loading="op === 'uninstall'"
          :disabled="busy"
          @click="emit('uninstall')"
        >
          <MsIcon name="delete" />
        </BaseButton>
      </template>
      <template v-else>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.browse.install')"
          :loading="op === 'install'"
          :disabled="busy"
          @click="emit('install')"
        >
          <MsIcon name="download" />
        </BaseButton>
        <BaseButton
          variant="ghost" size="sm" icon-only
          :aria-label="t('plugins.installed.version')"
          :disabled="busy"
          @click="emit('version')"
        >
          <MsIcon name="swap_horiz" />
        </BaseButton>
      </template>
    </div>

    <div v-if="errVisible && error" class="plugin-row__error">
      <span class="plugin-row__error-msg">{{ error }}</span>
      <BaseButton size="sm" @click="errVisible = false">{{ t('plugins.row.dismiss_error') }}</BaseButton>
    </div>
  </li>
</template>

<style scoped>
.plugin-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 14px 0;
}

.plugin-row + .plugin-row {
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
}

.plugin-row__icon {
  display: inline-flex;
  color: var(--t2);
  line-height: 1;
  margin-top: 3px;
}

.plugin-row__icon :deep(.ms) {
  font-size: 22px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 22;
}

.plugin-row__main {
  min-width: 0;
}

.plugin-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.plugin-row__title {
  color: var(--t1);
  font-size: var(--text-md);
  font-weight: 600;
  text-decoration: none;
}

a.plugin-row__title:hover {
  color: var(--ac);
}

.plugin-row__desc {
  color: var(--t2);
  font-size: var(--text-sm);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plugin-row__facts {
  display: flex;
  flex-wrap: wrap;
  margin-top: 4px;
  color: var(--t3);
  font-size: var(--text-xs);
  font-family: var(--font-tabular);
}

.plugin-row__facts > span + span::before {
  content: '·';
  margin: 0 6px;
}

.plugin-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.plugin-row__error {
  grid-column: 2 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--c-negative) 8%, var(--bg3));
  border: 1px solid color-mix(in srgb, var(--c-negative) 25%, var(--bd));
}

.plugin-row__error-msg {
  flex: 1;
  min-width: 0;
  color: var(--c-negative);
  font-size: var(--text-xs);
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
}

@media (max-width: 768px) {
  .plugin-row {
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 8px;
  }

  .plugin-row__actions {
    grid-column: 2;
    justify-content: flex-end;
  }

  .plugin-row__error {
    grid-column: 1 / -1;
  }
}
</style>
