<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseCard from '@/components/ui/BaseCard.vue'
import type { GpuInfo, PrebuiltInfo } from '@/types/wizard'

const { t } = useI18n({ useScope: 'global' })

const props = defineProps<{
  gpuInfo?: GpuInfo | null
  prebuiltInfo?: PrebuiltInfo | null
}>()

const smArch = computed(() => {
  if (!props.gpuInfo?.cuda_cap) return ''
  return `sm_${props.gpuInfo.cuda_cap.replace('.', '')}`
})

const tags = computed(() => {
  if (!props.prebuiltInfo) return []
  const t: Array<{ text: string; green?: boolean }> = []
  if (props.prebuiltInfo.torch) t.push({ text: `PyTorch ${props.prebuiltInfo.torch}` })
  if (props.prebuiltInfo.cuda_toolkit) t.push({ text: `CUDA ${props.prebuiltInfo.cuda_toolkit}` })
  if (props.prebuiltInfo.fa2) t.push({ text: 'FA2 ✓', green: true })
  if (props.prebuiltInfo.build_date) t.push({ text: props.prebuiltInfo.build_date.slice(0, 10) })
  return t
})
</script>

<template>
  <BaseCard variant="bg3" density="roomy">
    <!-- GPU row -->
    <div class="env-row">
      <span class="env-label">{{ t('wizard.env.gpu_label') }}</span>
      <template v-if="gpuInfo">
        <span class="env-value">
          <span class="ms ms-xs">monitor</span> {{ gpuInfo.name }}
        </span>
        <span class="env-meta">{{ smArch }} · {{ gpuInfo.vram_gb }} GB VRAM</span>
      </template>
      <span v-else class="env-value env-value--error">{{ t('wizard.env.no_gpu') }}</span>
    </div>

    <!-- Divider + Image row -->
    <template v-if="prebuiltInfo">
      <hr class="env-divider">
      <div class="env-row">
        <span class="env-label">{{ t('wizard.env.image_label') }}</span>
        <span class="env-value env-value--green">
          <span class="ms ms-xs">bolt</span>
          {{ t('wizard.env.prebuilt_image') }}{{ prebuiltInfo.version !== 'unknown' ? ` v${prebuiltInfo.version}` : '' }}
        </span>
      </div>

      <div v-if="tags.length" class="env-tags">
        <span
          v-for="(tag, i) in tags"
          :key="i"
          class="env-tag"
          :class="{ 'env-tag--green': tag.green }"
        >{{ tag.text }}</span>
      </div>
    </template>
  </BaseCard>
</template>

<style scoped>
.env-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.env-row + .env-row {
  margin-top: 8px;
}

.env-label {
  color: var(--t3);
  font-size: .82rem;
  min-width: 60px;
  white-space: nowrap;
}

.env-value {
  font-weight: 600;
  font-size: 1rem;
}

.env-value--green {
  color: var(--green);
}

.env-value--error {
  color: var(--red);
}

.env-meta {
  margin-left: auto;
  color: var(--t3);
  font-size: .82rem;
  white-space: nowrap;
}

.env-divider {
  border: none;
  border-top: 1px solid var(--bd);
  margin: 10px 0;
}

.env-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  margin-left: 68px;
}

.env-tag {
  font-size: .75rem;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg4);
  color: var(--t2);
  border: 1px solid var(--bd);
}

.env-tag--green {
  color: var(--green);
  border-color: var(--green);
}
</style>
