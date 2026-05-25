<script setup lang="ts">
import { computed, watch, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import CheckpointSelector, { type CheckpointInfo } from '@/components/generate/CheckpointSelector.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import RangeField from '@/components/form/RangeField.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'AnimaBasicSettings' })

defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  'open-unet': []
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

/* ── UNet selected (复用 CheckpointSelector) ── */
const selectedUnet = computed<CheckpointInfo | null>(() => {
  const name = state.value.unet
  if (!name) return null
  const list = options.unets.value
  const item = list.find(x => x.name === name)
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  return {
    name,
    displayName: base.replace(/\.[^.]+$/, ''),
    previewUrl: item?.preview ? `/api/local_models/preview?path=${encodeURIComponent(item.preview)}` : null,
    arch: item?.arch || 'unknown',
    baseModel: (item?.info as { baseModel?: string } | null)?.baseModel || undefined,
  }
})

/* ── Resolution ── */
const resolutionPresets = computed(() => {
  const presets = store.currentConfig.resolutions.map(r => ({
    value: r.value,
    label: r.label,
  }))
  presets.push({ value: 'custom', label: t('generate.basic.custom') })
  return presets
})

const isCustomRes = computed(() => state.value.resolution === 'custom')

watch(() => state.value.resolution, (v) => {
  if (v !== 'custom') {
    const [w, h] = v.split('x').map(Number)
    if (w && h) {
      state.value.width = w
      state.value.height = h
    }
  }
})
</script>

<template>
  <div class="basic-settings" :class="{ 'basic-settings--disabled': disabled }">
    <div class="gen-s-hdr">
      <MsIcon name="tune" class="hdr-icon" />
      {{ t('generate.basic.title') }}
    </div>

    <div class="basic-grid">
      <!-- Left: UNet 主选择器（与 SDXL CheckpointSelector 同尺寸） -->
      <div class="basic-grid__model">
        <CheckpointSelector
          :selected="selectedUnet"
          :empty-label="t('generate.basic.select_unet')"
          :change-label="t('generate.basic.click_change')"
          :disabled="disabled"
          @open="emit('open-unet')"
        />
      </div>

      <!-- Right: Resolution + Steps/CFG -->
      <div class="basic-grid__params">
        <div class="field-group">
          <label class="field-lbl">{{ t('generate.basic.resolution') }}</label>
          <div class="res-row">
            <BaseSelect
              :model-value="state.resolution"
              :options="resolutionPresets"
              :disabled="disabled"
              @update:model-value="state.resolution = String($event)"
            />
            <div v-if="isCustomRes" class="custom-size">
              <NumberInput
                :model-value="state.width"
                :min="64"
                :max="4096"
                :step="8"
                :disabled="disabled"
                :placeholder="t('generate.basic.width')"
                center
                @update:model-value="state.width = $event"
              />
              <span class="custom-size__x">×</span>
              <NumberInput
                :model-value="state.height"
                :min="64"
                :max="4096"
                :step="8"
                :disabled="disabled"
                :placeholder="t('generate.basic.height')"
                center
                @update:model-value="state.height = $event"
              />
            </div>
          </div>
        </div>

        <div class="slider-row">
          <RangeField
            :model-value="state.steps"
            :min="1"
            :max="100"
            :step="1"
            :label="t('generate.basic.steps')"
            :marks="['1', '50', '100']"
            editable
            :disabled="disabled"
            @update:model-value="state.steps = $event"
          />
          <RangeField
            :model-value="state.cfg"
            :min="1"
            :max="20"
            :step="0.5"
            :label="t('generate.basic.cfg_scale')"
            :marks="['1', '10', '20']"
            :value-format="(v: number) => v.toFixed(1)"
            editable
            :disabled="disabled"
            @update:model-value="state.cfg = $event"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.basic-settings {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.basic-settings--disabled {
  opacity: .55;
  pointer-events: none;
}

.gen-s-hdr {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t2);
}

.hdr-icon {
  font-size: .9rem;
  color: var(--t3);
}

.basic-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  align-items: stretch;
}

@media (max-width: 600px) {
  .basic-grid {
    grid-template-columns: 1fr;
  }
}

.basic-grid__model {
  display: flex;
  min-width: 0;
  min-height: 90px;
}
.basic-grid__model :deep(.ckpt-selector) {
  flex: 1;
}

.basic-grid__params {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.field-lbl {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .72rem;
  font-weight: 500;
  color: var(--t2);
  margin-bottom: 2px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.res-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2);
  align-items: start;
}

.custom-size {
  display: flex;
  align-items: center;
  gap: 6px;
}

.custom-size__x {
  font-size: .78rem;
  color: var(--t3);
  flex-shrink: 0;
}

.slider-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

@media (max-width: 600px) {
  .slider-row {
    grid-template-columns: 1fr;
  }
}
</style>
