<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import ProgressRing from '@/components/ui/ProgressRing.vue'
import { fmtSpeed } from '@/utils/format'

import type { VersionState } from '@/composables/useDownloads'

defineOptions({ name: 'DownloadButton' })

const props = withDefaults(defineProps<{
  state: VersionState | 'local'
  progress?: number
  speed?: number
  cancellable?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), {
  progress: 0,
  speed: 0,
  cancellable: false,
  size: 'sm',
})

const emit = defineEmits<{
  download: []
  cancel: []
}>()

const { t } = useI18n({ useScope: 'global' })

const hovering = ref(false)
function onEnter() { hovering.value = true }
function onLeave() { hovering.value = false }

const showCancel = computed(() =>
  hovering.value && props.cancellable && (props.state === 'downloading' || props.state === 'queued'),
)

const pctText = computed(() => `${Math.round(props.progress || 0)}%`)

const speedTitle = computed(() => {
  const s = fmtSpeed(props.speed || 0)
  return s ? `${pctText.value} · ${s}` : pctText.value
})
</script>

<template>
  <!-- Installed / local — 「已下载」是一个结果态, 不是被禁用的下载按钮:
       给对勾 + 成功色, 不用 disabled 的灰态 (那会读成"此处不可用")。
       模型卡传进来的 installed 仍由调用方判定 (聚合态 = 全部 version 都装了), 本组件只管呈现。 -->
  <span
    v-if="state === 'installed' || state === 'local'"
    class="dl-btn dl-done"
    :class="`dl-done--${size}`"
    :title="t('models.downloads.installed')"
  >
    <MsIcon name="check_circle" size="xs" />
    {{ t('models.downloads.installed') }}
  </span>

  <!-- Submitting: in-flight request, not cancellable -->
  <BaseButton
    v-else-if="state === 'submitting'"
    :size="size"
    loading
    class="dl-btn dl-btn--busy"
  >
    {{ t('models.downloads.resolving') }}
  </BaseButton>

  <!-- Queued / Downloading: progress ring + pct, hover→cancel when cancellable -->
  <BaseButton
    v-else-if="state === 'queued' || state === 'downloading'"
    :size="size"
    :variant="showCancel ? 'danger' : 'default'"
    :title="showCancel ? t('common.btn.cancel') : (state === 'queued' ? t('models.downloads.waiting') : speedTitle)"
    class="dl-btn dl-btn--busy"
    :class="{ 'dl-btn--cancellable': cancellable }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @click="showCancel && emit('cancel')"
  >
    <template v-if="showCancel">
      <MsIcon name="cancel" size="xs" />
      {{ t('common.btn.cancel') }}
    </template>
    <template v-else-if="state === 'queued'">
      <MsIcon name="hourglass_empty" size="xs" />
      {{ t('models.downloads.waiting') }}
    </template>
    <template v-else>
      <ProgressRing :progress="progress" :size="16" :stroke-width="2" />
      <span>{{ pctText }}</span>
    </template>
  </BaseButton>

  <!-- Verifying: full ring + pulse, not cancellable -->
  <BaseButton
    v-else-if="state === 'verifying'"
    :size="size"
    class="dl-btn dl-btn--busy"
    :title="t('models.downloads.verifying')"
  >
    <ProgressRing :progress="100" :size="16" :stroke-width="2" />
    {{ t('models.downloads.verifying') }}
  </BaseButton>

  <BaseButton
    v-else-if="state === 'paused'"
    :size="size"
    class="dl-btn dl-btn--paused"
  >
    <MsIcon name="pause" size="xs" />
    {{ t('models.downloads.paused') }}
  </BaseButton>

  <!-- Failed: allow retry via download event -->
  <BaseButton
    v-else-if="state === 'failed'"
    :size="size"
    class="dl-btn"
    @click="emit('download')"
  >
    <MsIcon name="replay" size="xs" />
    {{ t('models.downloads.download') }}
  </BaseButton>

  <BaseButton
    v-else
    :size="size"
    class="dl-btn"
    @click="emit('download')"
  >
    <MsIcon name="download" size="xs" />
    {{ t('models.downloads.download') }}
  </BaseButton>
</template>

<style scoped>
.dl-btn--busy {
  opacity: .5;
  cursor: default;
}

/* 已下载: 与按钮同高同圆角, 但不是按钮 —— 无边框、无 hover、不可点 */
.dl-done {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--r-sm);
  color: var(--green);
  background: color-mix(in srgb, var(--green) 12%, transparent);
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
  user-select: none;
  box-sizing: border-box;
}
.dl-done--xs { min-height: 22px; padding: 2px 8px; font-size: var(--text-xs); }
.dl-done--sm { min-height: 28px; padding: 4px 10px; font-size: var(--text-sm); }
.dl-done--md { min-height: 34px; padding: 6px 12px; font-size: var(--text-base); }
.dl-done--lg { min-height: 40px; padding: 8px 16px; font-size: var(--text-md); }
.dl-btn--busy.dl-btn--cancellable:hover {
  opacity: 1;
  cursor: pointer;
}
.dl-btn--paused {
  opacity: .7;
  cursor: default;
}
</style>
