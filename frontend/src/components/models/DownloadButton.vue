<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

import type { VersionState } from '@/composables/useDownloads'

defineOptions({ name: 'DownloadButton' })

withDefaults(defineProps<{
  state: VersionState | 'local' | 'downloading'
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), {
  size: 'sm',
})

const emit = defineEmits<{ download: [] }>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <!-- Installed / local -->
  <BaseButton
    v-if="state === 'installed' || state === 'local'"
    :size="size"
    disabled
    class="dl-btn dl-btn--done"
  >
    {{ t('models.civitai.already_local') }}
  </BaseButton>
  <!-- Submitting / downloading -->
  <BaseButton
    v-else-if="state === 'submitting' || state === 'downloading'"
    :size="size"
    loading
    class="dl-btn dl-btn--busy"
  >
    {{ t('models.civitai.downloading') }}
  </BaseButton>
  <!-- Paused -->
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
    variant="danger"
    class="dl-btn"
    @click="emit('download')"
  >
    <MsIcon name="refresh" size="xs" />
    {{ t('models.downloads.download') }}
  </BaseButton>
  <!-- Idle -->
  <BaseButton
    v-else
    :size="size"
    variant="primary"
    class="dl-btn"
    @click="emit('download')"
  >
    <MsIcon name="download" size="xs" />
    {{ t('models.downloads.download') }}
  </BaseButton>
</template>

<style scoped>
.dl-btn--done,
.dl-btn--busy {
  opacity: .5;
  cursor: default;
}
.dl-btn--paused {
  opacity: .7;
  cursor: default;
}
</style>
