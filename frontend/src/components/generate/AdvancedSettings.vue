<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseInput from '@/components/form/BaseInput.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import SeedInput from '@/components/generate/SeedInput.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineProps<{
  disabled?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

/* ── Format ── */
const formatOptions = [
  { value: 'png', label: '' },
  { value: 'jpeg', label: '' },
  { value: 'webp', label: '' },
  { value: 'tiff', label: '' },
  { value: 'bmp', label: '' },
]

function formatLabel(key: string): string {
  return t(`generate.advanced.format_${key}`)
}
</script>

<template>
  <details class="adv-settings" :class="{ 'adv-settings--disabled': disabled }" open>
    <summary class="adv-summary">
      <MsIcon name="expand_more" class="adv-summary__arrow" />
      {{ t('generate.advanced.title') }}
    </summary>

    <div class="adv-body">
      <!-- Row 1: Sampler + Scheduler -->
      <div class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.sampler') }}
            <HelpTip :text="t('generate.advanced.sampler_help')" />
          </label>
          <BaseSelect
            :model-value="state.sampler"
            :options="options.samplers.value"
            :disabled="disabled"
            @update:model-value="state.sampler = String($event)"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.scheduler') }}
            <HelpTip :text="t('generate.advanced.scheduler_help')" />
          </label>
          <BaseSelect
            :model-value="state.scheduler"
            :options="options.schedulers.value"
            :disabled="disabled"
            @update:model-value="state.scheduler = String($event)"
          />
        </div>
      </div>

      <!-- Row 2: Seed + Batch -->
      <div class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.seed') }}
            <HelpTip :text="t('generate.advanced.seed_help')" />
            <span class="seed-mode-badge">
              {{ state.seedMode === 'random' ? t('generate.advanced.seed_random') : t('generate.advanced.seed_fixed') }}
            </span>
          </label>
          <SeedInput
            :model-value="state.seedValue"
            :mode="state.seedMode"
            :disabled="disabled"
            @update:model-value="state.seedValue = $event"
            @update:mode="state.seedMode = $event"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.batch') }}
            <HelpTip :text="t('generate.advanced.batch_help')" />
          </label>
          <NumberInput
            :model-value="state.batch"
            :min="1"
            :max="16"
            :step="1"
            :disabled="disabled"
            @update:model-value="state.batch = $event"
          />
        </div>
      </div>

      <!-- Row 3: Format + Prefix -->
      <div class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">{{ t('generate.advanced.format') }}</label>
          <BaseSelect
            :model-value="state.format"
            :options="formatOptions.map(o => ({ ...o, label: formatLabel(o.value) }))"
            :disabled="disabled"
            @update:model-value="state.format = String($event)"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.prefix') }}
            <HelpTip :text="t('generate.advanced.prefix_help')" />
          </label>
          <BaseInput
            :model-value="state.prefix"
            :disabled="disabled"
            mono
            @update:model-value="state.prefix = $event"
          />
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.adv-settings {
  border-top: 1px solid var(--bd);
  padding-top: var(--sp-3);
}

.adv-settings--disabled {
  opacity: .55;
  pointer-events: none;
}

/* ── Summary ── */
.adv-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t2);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.adv-summary::-webkit-details-marker {
  display: none;
}

.adv-summary__arrow {
  font-size: .9rem;
  color: var(--t3);
  transition: transform .2s;
}

.adv-settings[open] .adv-summary__arrow {
  transform: rotate(0deg);
}

.adv-settings:not([open]) .adv-summary__arrow {
  transform: rotate(-90deg);
}

/* ── Body ── */
.adv-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
}

/* ── 2-col grid ── */
.adv-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

@media (max-width: 600px) {
  .adv-2col {
    grid-template-columns: 1fr;
  }
}

/* ── Field ── */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-lbl {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}

/* ── Seed mode badge ── */
.seed-mode-badge {
  font-size: .65rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg3);
  color: var(--t3);
  margin-left: 2px;
}
</style>
