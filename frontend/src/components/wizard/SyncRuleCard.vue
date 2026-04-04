<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import type { SyncTemplate } from '@/types/wizard'

defineOptions({ name: 'SyncRuleCard' })

const { t } = useI18n({ useScope: 'global' })

const props = defineProps<{
  template: SyncTemplate
  selected: boolean
  remote: string
  remotePath: string
  remoteOptions: string[]
}>()

const emit = defineEmits<{
  toggle: []
  'update:remote': [value: string]
  'update:remotePath': [value: string]
}>()

const shortName = computed(() =>
  props.template.name.replace(/^[\u2B07\uFE0F\u2B06\u{1F4E5}\u{1F4E4}]+\s*/u, ''),
)

const methodLabel = computed(() =>
  props.template.method === 'move' ? t('wizard.step4.method_move') : t('wizard.step4.method_keep'),
)

const triggerLabel = computed(() => {
  switch (props.template.trigger) {
    case 'deploy': return t('wizard.step4.trigger_deploy')
    case 'watch': return t('wizard.step4.trigger_watch')
    case 'manual': return t('wizard.step4.trigger_manual')
    default: return props.template.trigger
  }
})

function onToggle() {
  emit('toggle')
}

function onPathChange(e: Event) {
  const val = (e.target as HTMLInputElement).value
  emit('update:remotePath', val)
}
</script>

<template>
  <div
    class="sync-rule-card"
    :class="{ 'sync-rule-card--selected': selected }"
    @click="onToggle"
  >
    <div class="sync-rule-card__check">
      <MsIcon v-if="selected" name="check" size="xs" color="none" />
    </div>
    <div class="sync-rule-card__name text-truncate">{{ shortName }}</div>
    <div class="sync-rule-card__method">{{ triggerLabel }} · {{ methodLabel }}</div>

    <div class="sync-rule-card__field" @click.stop>
      <label>{{ t('wizard.step4.remote_label') }}</label>
      <BaseSelect
        v-if="remoteOptions.length > 0"
        :model-value="remote"
        :options="remoteOptions"
        size="sm"
        teleport
        @update:model-value="(v: string | number | boolean) => emit('update:remote', String(v))"
      />
      <input
        v-else
        type="text"
        class="form-input sync-rule-card__input"
        :value="remote"
        :placeholder="t('wizard.step4.remote_placeholder')"
        @input="(e: Event) => emit('update:remote', (e.target as HTMLInputElement).value)"
        @click.stop
      />
    </div>

    <div class="sync-rule-card__field" @click.stop>
      <label>{{ t('wizard.step4.remote_path_label') }}</label>
      <input
        type="text"
        class="form-input sync-rule-card__input"
        :value="remotePath"
        :placeholder="t('wizard.step4.remote_path_placeholder')"
        @input="onPathChange"
        @click.stop
      />
    </div>

    <div class="sync-rule-card__local text-truncate" :title="template.local_path">
      <MsIcon name="folder_open" size="xs" />
      {{ template.local_path }}
    </div>
  </div>
</template>

<style scoped>
.sync-rule-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 200px;
  max-width: 240px;
  flex-shrink: 0;
  padding: 14px;
  background: var(--bg3);
  border: 2px solid var(--bd);
  border-radius: var(--r);
  cursor: pointer;
  transition: border-color .2s, background .2s;
  user-select: none;
}

.sync-rule-card:hover {
  border-color: var(--ac);
}

.sync-rule-card--selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 10%, var(--bg3));
}

.sync-rule-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--t3);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  background: var(--bg2);
  transition: all .2s;
  font-size: 12px;
}

.sync-rule-card__check:hover {
  border-color: var(--ac);
}

.sync-rule-card--selected .sync-rule-card__check {
  background: var(--ac);
  border-color: var(--ac);
  color: #fff;
}

.sync-rule-card__name {
  font-weight: 600;
  font-size: .88rem;
  color: var(--t1);
  padding-right: 24px;
}

.sync-rule-card__method {
  font-size: .72rem;
  color: var(--t3);
  margin-bottom: 2px;
}

.sync-rule-card__field {
  margin-bottom: 2px;
}

.sync-rule-card__field label {
  font-size: .72rem;
  color: var(--t3);
  display: block;
  margin-bottom: 2px;
}

.sync-rule-card__input {
  padding: 4px 8px !important;
  font-size: .80rem !important;
}

.sync-rule-card__local {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .70rem;
  color: var(--t3);
  margin-top: 2px;
}
</style>
