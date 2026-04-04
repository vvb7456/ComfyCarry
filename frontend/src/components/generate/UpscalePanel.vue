<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type UpscaleState } from '@/stores/generate'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'UpscalePanel' })

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()

const config = computed<UpscaleState>(() => store.currentState.upscale)

// ── Computed ─────────────────────────────────────────────────────────────

const modeOptions = computed(() => [
  { value: '4x_overlapped_checkboard', label: t('generate.upscale.mode_checkboard') },
  { value: '4x_overlapped_constant', label: t('generate.upscale.mode_constant') },
  { value: '4x', label: t('generate.upscale.mode_standard') },
])

const downscaleOptions = computed(() => [
  { value: 'lanczos', label: 'Lanczos' },
  { value: 'bicubic', label: 'Bicubic' },
  { value: 'bilinear', label: 'Bilinear' },
  { value: 'area', label: 'Area' },
  { value: 'nearest-exact', label: 'Nearest' },
])

const is4x = computed(() => config.value.factor >= 4)

const sizeHint = computed(() => {
  const s = store.currentState
  const w = Math.round(s.width * config.value.factor)
  const h = Math.round(s.height * config.value.factor)
  return `${w} × ${h}`
})
</script>

<template>
  <div class="upscale-grid">
    <!-- Row 1 -->
    <div class="upscale-grid__row">
      <!-- Factor slider -->
      <div class="up-cell">
        <RangeField
          :model-value="config.factor"
          :min="1.5"
          :max="4"
          :step="0.5"
          :label="t('generate.upscale.scale')"
          :marks="['1.5', '2', '2.5', '3', '3.5', '4']"
          :value-format="(v: number) => v.toFixed(1) + 'x'"
          @update:model-value="config.factor = $event"
        >
          <template #label-append>
            <span class="upscale-size-hint">{{ sizeHint }}</span>
          </template>
        </RangeField>
      </div>

      <!-- Mode select -->
      <div class="up-cell">
        <div class="up-field">
          <label class="field-lbl">
            {{ t('generate.upscale.method') }}
            <HelpTip :text="t('generate.upscale.method_help')" />
          </label>
          <BaseSelect
            :model-value="config.mode"
            :options="modeOptions"
            teleport
            @update:model-value="config.mode = String($event)"
          />
        </div>
      </div>
    </div>

    <!-- Row 2 -->
    <div class="upscale-grid__row">
      <!-- Tile size slider -->
      <div class="up-cell">
        <RangeField
          :model-value="config.tile"
          :min="1"
          :max="32"
          :step="1"
          :label="t('generate.upscale.tile_size')"
          :marks="['1', '16', '32']"
          @update:model-value="config.tile = $event"
        >
          <template #label-append>
            <HelpTip :text="t('generate.upscale.tile_size_help')" />
          </template>
        </RangeField>
      </div>

      <!-- Downscale method (disabled at 4x) -->
      <div class="up-cell" :class="{ 'up-cell--disabled': is4x }">
        <div class="up-field">
          <label class="field-lbl">
            {{ t('generate.upscale.downscale_method') }}
            <HelpTip :text="t('generate.upscale.downscale_method_help')" />
          </label>
          <BaseSelect
            :model-value="config.downscale"
            :options="downscaleOptions"
            :disabled="is4x"
            teleport
            @update:model-value="config.downscale = String($event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upscale-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-width: 700px;
}

.upscale-grid__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

.upscale-size-hint {
  color: var(--t3);
  font-size: var(--text-xs);
  margin-left: auto;
}

.up-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.up-cell--disabled {
  opacity: .4;
  pointer-events: none;
}

.field-lbl {
  color: var(--t2);
  font-size: var(--text-xs);
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 768px) {
  .upscale-grid__row {
    grid-template-columns: 1fr;
  }
}
</style>
