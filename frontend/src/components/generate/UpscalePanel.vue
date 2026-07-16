<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type UpscaleState } from '@/stores/generate'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'UpscalePanel' })

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()

const config = computed<UpscaleState>(() => store.currentState.upscale)

// ── Engine switch ────────────────────────────────────────────────────────

const isSeedVR2 = computed(() => config.value.engine === 'seedvr2')

// ── AuraSR options ──────────────────────────────────────────────────────

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

// ── SeedVR2 options ──────────────────────────────────────────────────────

const svrModelOptions = computed(() => [
  { value: 'seedvr2_ema_3b_fp8_e4m3fn.safetensors', label: 'SeedVR2 3B FP8 · 3.4GB' },
  { value: 'seedvr2_ema_3b_fp16.safetensors', label: 'SeedVR2 3B FP16 · 6.8GB' },
  { value: 'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors', label: 'SeedVR2 7B FP8 · 10GB' },
  { value: 'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors', label: 'SeedVR2 7B-sharp FP8 · 10GB' },
])

const svrColorOptions = computed(() => [
  { value: 'lab', label: 'LAB' },
  { value: 'wavelet', label: 'Wavelet' },
  { value: 'wavelet_adaptive', label: 'Wavelet Adaptive' },
  { value: 'hsv', label: 'HSV' },
  { value: 'adain', label: 'AdaIN' },
  { value: 'none', label: t('generate.upscale.svr_color_none') },
])

// ── Shared ──────────────────────────────────────────────────────────────

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
    <!-- Engine switch: AuraSR ⇄ SeedVR2 -->
    <div class="up-engine-switch">
      <span
        class="up-engine-label"
        :class="{ active: !isSeedVR2 }"
        @click="config.engine = 'aurasr'"
      >{{ t('generate.upscale.engine_aurasr') }}</span>
      <ToggleSwitch
        :model-value="isSeedVR2"
        @update:model-value="config.engine = $event ? 'seedvr2' : 'aurasr'"
      />
      <span
        class="up-engine-label"
        :class="{ active: isSeedVR2 }"
        @click="config.engine = 'seedvr2'"
      >{{ t('generate.upscale.engine_seedvr2') }}</span>
    </div>

    <!-- ── AuraSR: 上排两个滑条 / 下排两个下拉 ── -->
    <template v-if="!isSeedVR2">
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
      </div>

      <div class="upscale-grid__row">
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
    </template>

    <!-- ── SeedVR2: 倍率+VAE开关 / 两个下拉 / 两个噪声滑条 ── -->
    <template v-else>
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

        <!-- VAE tiled toggle -->
        <div class="up-cell">
          <div class="up-field up-field--switch">
            <label class="field-lbl">
              {{ t('generate.upscale.svr_tiled_vae') }}
              <HelpTip :text="t('generate.upscale.svr_tiled_vae_help')" />
            </label>
            <ToggleSwitch
              :model-value="config.svrTiledVae"
              @update:model-value="config.svrTiledVae = $event"
            />
          </div>
        </div>
      </div>

      <div class="upscale-grid__row">
        <!-- Model select -->
        <div class="up-cell">
          <div class="up-field">
            <label class="field-lbl">{{ t('generate.upscale.svr_model') }}</label>
            <BaseSelect
              :model-value="config.svrModel"
              :options="svrModelOptions"
              teleport
              @update:model-value="config.svrModel = String($event)"
            />
          </div>
        </div>

        <!-- Color correction -->
        <div class="up-cell">
          <div class="up-field">
            <label class="field-lbl">
              {{ t('generate.upscale.svr_color') }}
              <HelpTip :text="t('generate.upscale.svr_color_help')" />
            </label>
            <BaseSelect
              :model-value="config.svrColorCorrection"
              :options="svrColorOptions"
              teleport
              @update:model-value="config.svrColorCorrection = String($event)"
            />
          </div>
        </div>
      </div>

      <div class="upscale-grid__row">
        <!-- Input noise -->
        <div class="up-cell">
          <RangeField
            :model-value="config.svrInputNoise"
            :min="0"
            :max="1"
            :step="0.05"
            :label="t('generate.upscale.svr_input_noise')"
            :marks="['0', '0.5', '1']"
            :value-format="(v: number) => v.toFixed(2)"
            @update:model-value="config.svrInputNoise = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.upscale.svr_input_noise_help')" />
            </template>
          </RangeField>
        </div>

        <!-- Latent noise -->
        <div class="up-cell">
          <RangeField
            :model-value="config.svrLatentNoise"
            :min="0"
            :max="1"
            :step="0.05"
            :label="t('generate.upscale.svr_latent_noise')"
            :marks="['0', '0.5', '1']"
            :value-format="(v: number) => v.toFixed(2)"
            @update:model-value="config.svrLatentNoise = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.upscale.svr_latent_noise_help')" />
            </template>
          </RangeField>
        </div>
      </div>
    </template>
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

.up-engine-switch {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.up-engine-label {
  font-size: var(--text-xs);
  color: var(--t3);
  transition: color .15s;
  cursor: pointer;
  user-select: none;
}

.up-engine-label.active {
  color: var(--t1);
  font-weight: 500;
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

/* VAE 分块开关: 与同排滑条等高, 水平排布垂直居中 */
.up-field--switch {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  height: 100%;
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
