<script setup lang="ts">
import { computed, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type FaceDetailerState } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseTextarea from '@/components/form/BaseTextarea.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'FaceDetailerPanel' })

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const options = inject(GenerateOptionsKey)!

const config = computed<FaceDetailerState>(() => store.currentState.faceDetailer)

const detectionOptions = computed(() =>
  options.ultralyticsBboxModels.value.map(f => ({ value: f, label: f })),
)

/** SAM 权重是否已在磁盘（可选依赖：未装时 SAM 段置灰） */
const samInstalled = computed(() =>
  options.samModels.value.includes('sam_vit_b_01ec64.pth'),
)

// 掩码方式：矩形框 (bbox) / SAM 轮廓 — SegmentedControl 模式开关惯例
const maskOptions = computed(() => [
  { value: 'bbox', label: t('generate.face.mask_bbox') },
  { value: 'sam', label: t('generate.face.mask_sam'), disabled: !samInstalled.value },
])

// SAM 权重被移除而持久化 state 仍为 true 时归位，避免置灰段呈选中态
watch(samInstalled, (ok) => {
  if (!ok && config.value.useSam) config.value.useSam = false
}, { immediate: true })
</script>

<template>
  <div class="face-grid">
    <!-- Row 1: 重绘强度 + 采样步数 -->
    <div class="face-grid__row">
      <div class="fd-cell">
        <RangeField
          :model-value="config.denoise"
          :min="0.1"
          :max="1"
          :step="0.05"
          :label="t('generate.face.denoise')"
          :marks="2"
          :value-format="(v: number) => v.toFixed(2)"
          editable
          @update:model-value="config.denoise = $event"
        >
          <template #label-append>
            <HelpTip :text="t('generate.face.denoise_help')" />
          </template>
        </RangeField>
      </div>
      <div class="fd-cell">
        <RangeField
          :model-value="config.steps"
          :min="1"
          :max="100"
          :step="1"
          :label="t('generate.face.steps')"
          :marks="2"
          editable
          @update:model-value="config.steps = $event"
        />
      </div>
    </div>

    <!-- Row 2: 检测模型 + 掩码方式 -->
    <div class="face-grid__row">
      <div class="fd-cell">
        <div class="fd-field">
          <label class="field-lbl">{{ t('generate.face.detection_model') }}</label>
          <BaseSelect
            :model-value="config.detectionModel"
            :options="detectionOptions"
            :disabled="detectionOptions.length === 0"
            teleport
            @update:model-value="config.detectionModel = String($event)"
          />
        </div>
      </div>
      <div class="fd-cell">
        <div class="fd-field">
          <label class="field-lbl">
            {{ t('generate.face.mask_mode') }}
            <HelpTip :text="t('generate.face.mask_mode_help')" />
          </label>
          <SegmentedControl
            :options="maskOptions"
            :model-value="config.useSam ? 'sam' : 'bbox'"
            block
            @update:model-value="config.useSam = $event === 'sam'"
          />
        </div>
      </div>
    </div>

    <!-- Row 3: 面部提示词 -->
    <div class="fd-field">
      <label class="field-lbl">
        {{ t('generate.face.prompt') }}
        <HelpTip :text="t('generate.face.prompt_help')" />
      </label>
      <BaseTextarea
        :model-value="config.prompt"
        :placeholder="t('generate.face.prompt_placeholder')"
        :rows="2"
        @update:model-value="config.prompt = $event"
      />
    </div>

    <!-- 高级参数 (折叠) -->
    <CollapsibleGroup :title="t('generate.face.advanced')" :default-open="false">
      <div class="face-grid__row">
        <div class="fd-cell">
          <RangeField
            :model-value="config.cfg"
            :min="1"
            :max="20"
            :step="0.5"
            :label="'CFG'"
            :marks="2"
            :value-format="(v: number) => v.toFixed(1)"
            editable
            @update:model-value="config.cfg = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.face.cfg_help')" />
            </template>
          </RangeField>
        </div>
        <div class="fd-cell">
          <RangeField
            :model-value="config.guideSize"
            :min="256"
            :max="2048"
            :step="64"
            :label="t('generate.face.guide_size')"
            :marks="2"
            editable
            @update:model-value="config.guideSize = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.face.guide_size_help')" />
            </template>
          </RangeField>
        </div>
      </div>
      <div class="face-grid__row">
        <div class="fd-cell">
          <RangeField
            :model-value="config.cropFactor"
            :min="1"
            :max="4"
            :step="0.1"
            :label="t('generate.face.crop_factor')"
            :marks="2"
            :value-format="(v: number) => v.toFixed(1)"
            editable
            @update:model-value="config.cropFactor = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.face.crop_factor_help')" />
            </template>
          </RangeField>
        </div>
        <div class="fd-cell">
          <RangeField
            :model-value="config.bboxThreshold"
            :min="0.1"
            :max="0.9"
            :step="0.05"
            :label="t('generate.face.bbox_threshold')"
            :marks="2"
            :value-format="(v: number) => v.toFixed(2)"
            editable
            @update:model-value="config.bboxThreshold = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.face.bbox_threshold_help')" />
            </template>
          </RangeField>
        </div>
      </div>
      <div class="face-grid__row">
        <div class="fd-cell">
          <RangeField
            :model-value="config.feather"
            :min="0"
            :max="100"
            :step="1"
            :label="t('generate.face.feather')"
            :marks="2"
            editable
            @update:model-value="config.feather = $event"
          >
            <template #label-append>
              <HelpTip :text="t('generate.face.feather_help')" />
            </template>
          </RangeField>
        </div>
        <div class="fd-cell" />
      </div>
    </CollapsibleGroup>
  </div>
</template>

<style scoped>
.face-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-width: var(--gen-module-w);
  margin: 0 auto;
}

.face-grid__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

.fd-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-lbl {
  color: var(--t2);
  font-size: var(--text-xs);
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 768px) {
  .face-grid__row {
    grid-template-columns: 1fr;
  }
}
</style>
