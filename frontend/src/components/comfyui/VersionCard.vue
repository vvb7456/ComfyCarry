<script setup lang="ts">
/**
 * VersionCard — 「版本与启动」分区的只读展示 (C08, 需求 8.1)。
 *
 * 两行: 当前版本 (release / nightly 分类 + 切换入口) 与一行启动命令 (复制)。
 * 版本切换进入 VersionSwitchModal; 启动命令由主页按已保存配置生成后传入。
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import VersionSwitchModal from './VersionSwitchModal.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useClipboard } from '@/composables/useClipboard'
import type { ComfyVersionsResponse } from '@/types/comfyui'

defineOptions({ name: 'VersionCard' })

const props = defineProps<{ command: string }>()

const emit = defineEmits<{ switched: [] }>()

const { t } = useI18n({ useScope: 'global' })
const { get } = useApiFetch()
const { copy } = useClipboard()

const currentVersion = ref<string | null>(null)
const hasGit = ref(true)
const switchingOpen = ref(false)

const currentIsNightly = computed(() => currentVersion.value === 'nightly')
const currentIsRelease = computed(() => /^v\d+\.\d+\.\d+$/.test(currentVersion.value || ''))

async function loadVersions() {
  const d = await get<ComfyVersionsResponse>('/api/comfyui/versions')
  if (!d) return
  currentVersion.value = d.current
  hasGit.value = d.has_git
}

onMounted(loadVersions)

function onSwitched() {
  void loadVersions()
  emit('switched')
}

function copyCommand() {
  if (props.command) void copy(props.command)
}
</script>

<template>
  <div class="version-block">
    <div class="version-row">
      <span class="version-row__k">{{ t('comfyui.version.current') }}</span>
      <span class="version-row__v">
        <b>{{ currentVersion || 'unknown' }}</b>
        <Badge v-if="currentIsNightly" tone="caution">nightly</Badge>
        <Badge v-else-if="currentIsRelease" tone="neutral">release</Badge>
      </span>
      <div class="version-row__actions">
        <BaseButton
          size="sm"
          :disabled="!hasGit"
          @click="switchingOpen = true"
        >
          <MsIcon name="swap_horiz" size="xs" /> {{ t('comfyui.version.switch') }}
        </BaseButton>
      </div>
    </div>

    <div class="version-row">
      <span class="version-row__k">{{ t('comfyui.version.command') }}</span>
      <code class="version-row__code">{{ command || '—' }}</code>
      <div class="version-row__actions">
        <BaseButton
          variant="ghost"
          size="sm"
          icon-only
          :aria-label="t('comfyui.version.copy_command')"
          :disabled="!command"
          @click="copyCommand"
        >
          <MsIcon name="content_copy" />
        </BaseButton>
      </div>
    </div>

    <AlertBanner v-if="!hasGit" tone="danger" icon="error" dense class="version-block__banner">
      {{ t('comfyui.settings.no_git') }}
    </AlertBanner>

    <VersionSwitchModal v-model="switchingOpen" @saved="onSwitched" />
  </div>
</template>

<style scoped>
.version-block {
  display: grid;
}

.version-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px 0;
}

.version-row + .version-row {
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
}

.version-row__k {
  color: var(--t3);
  font-size: var(--text-xs);
}

.version-row__v {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  color: var(--t1);
  font-size: var(--text-md);
  font-weight: 600;
}

.version-row__v b {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-row__code {
  min-width: 0;
  color: var(--t2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.version-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.version-block__banner {
  margin-top: var(--sp-2);
}

@media (max-width: 600px) {
  .version-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .version-row__k {
    grid-column: 1 / -1;
  }
}
</style>
