<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import WizardStepLayout from './WizardStepLayout.vue'
import FormField from '@/components/form/FormField.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'StepPlugins' })

const { t } = useI18n({ useScope: 'global' })
const { config, pluginData, prebuiltInfo, nextStep, prevStep } = useWizardState()

const extraPluginsText = ref('')

const isPrebuilt = computed(() => !!prebuiltInfo.value)

const sortedPlugins = computed(() =>
  [...pluginData.value].sort((a, b) =>
    (b.required ? 1 : 0) - (a.required ? 1 : 0),
  ),
)

function isSelected(url: string): boolean {
  return config.plugins.includes(url)
}

function togglePlugin(url: string) {
  const idx = config.plugins.indexOf(url)
  if (idx >= 0) {
    config.plugins.splice(idx, 1)
  } else {
    config.plugins.push(url)
  }
}

function onNext() {
  // Append extra plugin URLs
  const extra = extraPluginsText.value.trim()
  if (extra) {
    extra.split('\n').forEach(u => {
      u = u.trim()
      if (u && u.startsWith('http') && !config.plugins.includes(u)) {
        config.plugins.push(u)
      }
    })
  }
  nextStep()
}

function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step7.title')"
    icon="extension"
    icon-color="#a78bfa"
    :description="isPrebuilt ? t('wizard.step7.prebuilt_subtitle') : t('wizard.step7.desc')"
    @prev="onPrev"
    @next="onNext"
  >
    <div v-if="isPrebuilt" class="step-plugins__prebuilt-group">
      <CollapsibleGroup
        :title="t('wizard.step7.prebuilt_plugins')"
        :default-open="true"
      >
        <BaseCard variant="bg3" radius="md" :padding="false">
          <div class="step-plugins__list step-plugins__list--framed">
            <div
              v-for="p in sortedPlugins"
              :key="p.url"
              class="step-plugins__item step-plugins__item--prebuilt"
            >
              <MsIcon name="check_circle" size="xs" class="step-plugins__prebuilt-icon" />
              <span class="step-plugins__name">
                {{ p.name }}
                <span class="step-plugins__tag">{{ t('wizard.step7.preinstalled') }}</span>
              </span>
            </div>
          </div>
        </BaseCard>
      </CollapsibleGroup>
    </div>

    <BaseCard v-else variant="bg3" radius="md" :padding="false" class="step-plugins__select-card">
      <div class="step-plugins__list step-plugins__list--framed">
        <label
          v-for="p in sortedPlugins"
          :key="p.url"
          class="step-plugins__item"
        >
          <input
            type="checkbox"
            :checked="isSelected(p.url)"
            :disabled="p.required"
            class="step-plugins__checkbox"
            @change="togglePlugin(p.url)"
          />
          <span class="step-plugins__name">
            {{ p.name }}
            <span v-if="p.required" class="step-plugins__required">*</span>
          </span>
        </label>
      </div>
    </BaseCard>

    <FormField :label="t('wizard.step7.extra_plugins')">
      <textarea
        v-model="extraPluginsText"
        class="form-input form-input--textarea"
        :placeholder="t('wizard.step7.extra_plugins_placeholder')"
        rows="3"
      />
    </FormField>
  </WizardStepLayout>
</template>

<style scoped>
.step-plugins__prebuilt-group {
  margin-bottom: 16px;
}

.step-plugins__select-card {
  margin-bottom: 16px;
}

.step-plugins__list {
  display: flex;
  flex-direction: column;
}

.step-plugins__list--framed {
  max-height: 260px;
  overflow-y: auto;
}

.step-plugins__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--bd);
  cursor: pointer;
  user-select: none;
  font-size: .88rem;
}

.step-plugins__item:last-child {
  border-bottom: none;
}

.step-plugins__item--prebuilt {
  cursor: default;
}

.step-plugins__checkbox {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.step-plugins__prebuilt-icon {
  color: var(--green);
  flex-shrink: 0;
}

.step-plugins__name {
  color: var(--t1);
}

.step-plugins__tag {
  font-size: .72rem;
  color: var(--t3);
  margin-left: 4px;
}

.step-plugins__required {
  color: var(--red);
  font-weight: 600;
}
</style>
