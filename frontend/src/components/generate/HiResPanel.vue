<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type HiResState } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import SeedInput from '@/components/generate/SeedInput.vue'

defineOptions({ name: 'HiResPanel' })

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const options = inject(GenerateOptionsKey)!

const config = computed<HiResState>(() => store.currentState.hires)

const samplerOptions = computed(() => options.samplers.value)
const schedulerOptions = computed(() => options.schedulers.value)
</script>

<template>
  <div class="hires-grid">
    <!-- Row 1: Denoise + Steps -->
    <div class="hires-grid__row">
      <div class="hr-cell">
        <RangeField
          :model-value="config.denoise"
          :min="0.1"
          :max="0.8"
          :step="0.05"
          :label="t('generate.hires.denoise')"
          :marks="['0.1', '0.45', '0.8']"
          :value-format="(v: number) => v.toFixed(2)"
          editable
          @update:model-value="config.denoise = $event"
        >
          <template #label-append>
            <HelpTip :text="t('generate.hires.denoise_help')" />
          </template>
        </RangeField>
      </div>
      <div class="hr-cell">
        <RangeField
          :model-value="config.steps"
          :min="5"
          :max="50"
          :step="1"
          :label="t('generate.hires.steps')"
          :marks="['5', '27', '50']"
          editable
          @update:model-value="config.steps = $event"
        >
          <template #label-append>
            <HelpTip :text="t('generate.hires.steps_help')" />
          </template>
        </RangeField>
      </div>
    </div>

    <!-- Row 2: CFG + Sampler -->
    <div class="hires-grid__row">
      <div class="hr-cell">
        <RangeField
          :model-value="config.cfg"
          :min="1"
          :max="20"
          :step="0.5"
          :label="'CFG'"
          :marks="['1', '10', '20']"
          :value-format="(v: number) => v.toFixed(1)"
          editable
          @update:model-value="config.cfg = $event"
        />
      </div>
      <div class="hr-cell">
        <div class="hr-field">
          <label class="field-lbl">{{ t('generate.hires.sampler') }}</label>
          <BaseSelect
            :model-value="config.sampler"
            :options="samplerOptions"
            :disabled="samplerOptions.length === 0"
            teleport
            @update:model-value="config.sampler = String($event)"
          />
        </div>
      </div>
    </div>

    <!-- Row 3: Scheduler + Seed -->
    <div class="hires-grid__row">
      <div class="hr-cell">
        <div class="hr-field">
          <label class="field-lbl">{{ t('generate.hires.scheduler') }}</label>
          <BaseSelect
            :model-value="config.scheduler"
            :options="schedulerOptions"
            :disabled="schedulerOptions.length === 0"
            teleport
            @update:model-value="config.scheduler = String($event)"
          />
        </div>
      </div>
      <div class="hr-cell">
        <div class="hr-field">
          <label class="field-lbl">{{ t('generate.hires.seed') }}</label>
          <SeedInput
            :model-value="config.seedValue"
            :mode="config.seedMode"
            @update:model-value="config.seedValue = $event"
            @update:mode="config.seedMode = $event"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hires-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-width: 700px;
}

.hires-grid__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

.hr-field {
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
  .hires-grid__row {
    grid-template-columns: 1fr;
  }
}
</style>
