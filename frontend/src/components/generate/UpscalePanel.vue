<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type UpscaleState } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'UpscalePanel' })

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const options = inject(GenerateOptionsKey)!

const config = computed<UpscaleState>(() => store.currentState.upscale)

const isSeedVR2 = computed(() => config.value.engine === 'seedvr2')

/** 两个引擎各自的权重是否在磁盘 —— 未装的那一侧禁止切过去 (照面部面板 SAM 成例) */
const aurasrInstalled = computed(() => options.aurasrInstalled.value)
const seedvr2Installed = computed(() => options.seedvr2Models.value.length > 0)

const engineOptions = computed(() => [
  { value: 'aurasr', label: t('generate.upscale.engine_aurasr'), disabled: !aurasrInstalled.value },
  { value: 'seedvr2', label: t('generate.upscale.engine_seedvr2'), disabled: !seedvr2Installed.value },
])

// 刻意不做引擎自动切换: 原来"权重被删 → 切到装了的那个"会静默改变放大结果,
// 用户无从察觉。现在保留用户选择, 由 engineMissing 标警示、提交时拦下。
// 两个都没装时模块开关本身就打不开, 不必处理。

/** 当前选中的引擎在本机缺权重 (供面板标警示 + 提交拦截) */
const engineMissing = computed(() => {
  if (config.value.engine === 'aurasr') return !aurasrInstalled.value
  if (config.value.engine === 'seedvr2') return !seedvr2Installed.value
  return false
})

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

const SEEDVR2_MODEL_LABELS: Record<string, string> = {
  'seedvr2_ema_3b_fp8_e4m3fn.safetensors': 'SeedVR2 3B FP8 · 3.4GB',
  'seedvr2_ema_3b_fp16.safetensors': 'SeedVR2 3B FP16 · 6.8GB',
  'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors': 'SeedVR2 7B FP8 · 10GB',
  'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors': 'SeedVR2 7B-sharp FP8 · 10GB',
}

const svrModelOptions = computed(() =>
  options.seedvr2Models.value.map(f => ({
    value: f,
    label: SEEDVR2_MODEL_LABELS[f] ?? f,
  })),
)

const svrColorOptions = computed(() => [
  { value: 'lab', label: 'LAB' },
  { value: 'wavelet', label: 'Wavelet' },
  { value: 'wavelet_adaptive', label: 'Wavelet Adaptive' },
  { value: 'hsv', label: 'HSV' },
  { value: 'adain', label: 'AdaIN' },
  { value: 'none', label: t('generate.upscale.svr_color_none') },
])

const is4x = computed(() => config.value.factor >= 4)

const sizeHint = computed(() => {
  const s = store.currentState
  // 二次采样开启且带倍率时, 放大模块的输入已放大过 -> 目标尺寸按叠乘
  const hiresMul = s.hires.enabled ? s.hires.scale : 1
  const w = Math.round(s.width * hiresMul * config.value.factor)
  const h = Math.round(s.height * hiresMul * config.value.factor)
  return `${w} × ${h}`
})
</script>

<template>
  <div class="upscale-grid">
    <div class="up-field">
      <div class="field-lbl">
        {{ t('generate.upscale.engine') }}
        <HelpTip :text="t('generate.upscale.engine_help')" />
        <span v-if="engineMissing" class="up-missing" :title="t('generate.missing.tag_hint')">
          <MsIcon name="error_outline" size="xs" />
          {{ t('generate.missing.tag') }}
        </span>
      </div>
      <SegmentedControl
        :options="engineOptions"
        :model-value="config.engine"
        block
        @update:model-value="config.engine = $event as 'aurasr' | 'seedvr2'"
      />
    </div>
    <template v-if="!isSeedVR2">
      <div class="upscale-grid__row">
        <div class="up-cell">
          <RangeField
            :model-value="config.factor"
            :min="1.5"
            :max="4"
            :step="0.5"
            :label="t('generate.upscale.scale')"
            :marks="5"
            :value-format="(v: number) => v.toFixed(1) + 'x'"
            @update:model-value="config.factor = $event"
          >
            <template #label-append>
              <span class="upscale-size-hint">{{ sizeHint }}</span>
            </template>
          </RangeField>
        </div>

        <div class="up-cell">
          <RangeField
            :model-value="config.tile"
            :min="1"
            :max="32"
            :step="1"
            :label="t('generate.upscale.tile_size')"
            :marks="2"
            @update:model-value="config.tile = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.upscale.tile_size_help')" />
            </template>
          </RangeField>
        </div>
      </div>

      <div class="upscale-grid__row">
        <div class="up-cell">
          <div class="up-field">
            <div class="field-lbl">
              {{ t('generate.upscale.method') }}
              <HelpTip :text="t('generate.upscale.method_help')" />
            </div>
            <BaseSelect
              :model-value="config.mode"
              :options="modeOptions"
              @update:model-value="config.mode = String($event)"
            />
          </div>
        </div>

        <div class="up-cell" :class="{ 'up-cell--disabled': is4x }">
          <div class="up-field">
            <div class="field-lbl">
              {{ t('generate.upscale.downscale_method') }}
              <HelpTip :text="t('generate.upscale.downscale_method_help')" />
            </div>
            <BaseSelect
              :model-value="config.downscale"
              :options="downscaleOptions"
              :disabled="is4x"
              @update:model-value="config.downscale = String($event)"
            />
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="upscale-grid__row">
        <div class="up-cell">
          <RangeField
            :model-value="config.factor"
            :min="1.5"
            :max="4"
            :step="0.5"
            :label="t('generate.upscale.scale')"
            :marks="5"
            :value-format="(v: number) => v.toFixed(1) + 'x'"
            @update:model-value="config.factor = $event"
          >
            <template #label-append>
              <span class="upscale-size-hint">{{ sizeHint }}</span>
            </template>
          </RangeField>
        </div>

        <div class="up-cell">
          <div class="up-field up-field--switch">
            <div class="field-lbl">
              {{ t('generate.upscale.svr_tiled_vae') }}
              <HelpTip :text="t('generate.upscale.svr_tiled_vae_help')" />
            </div>
            <ToggleSwitch
              :model-value="config.svrTiledVae"
              :label="t('generate.upscale.svr_tiled_vae')"
              @update:model-value="config.svrTiledVae = $event"
            />
          </div>
        </div>
      </div>

      <div class="upscale-grid__row">
        <div class="up-cell">
          <div class="up-field">
            <div class="field-lbl">{{ t('generate.upscale.svr_model') }}</div>
            <BaseSelect
              :model-value="config.svrModel"
              :options="svrModelOptions"
              @update:model-value="config.svrModel = String($event)"
            />
          </div>
        </div>

        <div class="up-cell">
          <div class="up-field">
            <div class="field-lbl">
              {{ t('generate.upscale.svr_color') }}
              <HelpTip :text="t('generate.upscale.svr_color_help')" />
            </div>
            <BaseSelect
              :model-value="config.svrColorCorrection"
              :options="svrColorOptions"
              @update:model-value="config.svrColorCorrection = String($event)"
            />
          </div>
        </div>
      </div>

      <div class="upscale-grid__row">
        <div class="up-cell">
          <RangeField
            :model-value="config.svrInputNoise"
            :min="0"
            :max="1"
            :step="0.05"
            :label="t('generate.upscale.svr_input_noise')"
            :marks="2"
            :value-format="(v: number) => v.toFixed(2)"
            @update:model-value="config.svrInputNoise = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.upscale.svr_input_noise_help')" />
            </template>
          </RangeField>
        </div>

        <div class="up-cell">
          <RangeField
            :model-value="config.svrLatentNoise"
            :min="0"
            :max="1"
            :step="0.05"
            :label="t('generate.upscale.svr_latent_noise')"
            :marks="2"
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
  max-width: var(--gen-module-w);
  margin: 0 auto;
  container: gen-upscale / inline-size;
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

@container gen-upscale (max-width: 520px) {
  .upscale-grid__row {
    grid-template-columns: 1fr;
  }
}

.up-missing {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: var(--sp-2);
  font-size: var(--text-xs);
  color: var(--c-caution);
  font-weight: 500;
}
</style>
