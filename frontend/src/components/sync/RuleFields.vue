<script setup lang="ts">
/**
 * 直接原地修改 props.rule (对象引用传递, 父组件持有同一 reactive 对象)。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import type { SelectOption } from '@/components/form/BaseSelect.vue'
import type { SyncRule } from '@/types/sync'

defineOptions({ name: 'RuleFields' })

const props = withDefaults(defineProps<{
  rule: Partial<SyncRule>
  remoteOptions: SelectOption[]
  fixedRemote?: string
}>(), {
  fixedRemote: '',
})

const emit = defineEmits<{
  browse: [mode: 'local' | 'remote', field: 'remote_path' | 'local_path']
}>()

const { t } = useI18n({ useScope: 'global' })

const directionOptions = computed<SelectOption[]>(() => [
  { value: 'pull', label: t('sync.rule.pull') },
  { value: 'push', label: t('sync.rule.push') },
])

const methodOptions = computed<SelectOption[]>(() => [
  { value: 'copy', label: t('sync.rules.method_short.copy') },
  { value: 'sync', label: t('sync.rules.method_short.sync') },
  { value: 'move', label: t('sync.rules.method_short.move') },
])

const triggerOptions = computed<SelectOption[]>(() => [
  { value: 'manual', label: t('sync.rule.trigger_manual') },
  { value: 'watch', label: t('sync.rule.trigger_watch') },
  { value: 'deploy', label: t('sync.rule.trigger_deploy') },
])
</script>

<template>
  <div class="rule-fields">
    <FormField :label="t('sync.rule.name')" density="compact">
      <template #default="{ id }">
        <input :id="id" v-model="rule.name" type="text" class="form-input">
      </template>
    </FormField>
    <div class="rule-fields__row">
      <FormField :label="t('sync.rule.direction')" density="compact">
        <template #default="{ id }">
          <BaseSelect :id="id" v-model="rule.direction!" :options="directionOptions" />
        </template>
      </FormField>
      <FormField density="compact">
        <template #label>
          {{ t('sync.rule.method') }}
          <HelpTip :text="t('sync.rule.method_help')" />
        </template>
        <template #default="{ id }">
          <BaseSelect :id="id" v-model="rule.method!" :options="methodOptions" />
        </template>
      </FormField>
    </div>
    <div class="rule-fields__row">
      <FormField :label="t('sync.rule.remote')" density="compact">
        <template #default="{ id }">
          <BaseSelect v-if="!fixedRemote" :id="id" v-model="rule.remote!" :options="remoteOptions" />
          <input v-else :id="id" type="text" class="form-input" :value="fixedRemote" disabled>
        </template>
      </FormField>
      <FormField :label="t('sync.rule.trigger')" density="compact">
        <template #default="{ id }">
          <BaseSelect :id="id" v-model="rule.trigger!" :options="triggerOptions" />
        </template>
      </FormField>
    </div>
    <FormField :label="t('sync.rule.remote_path')" density="compact">
      <template #default="{ id }">
        <FieldControlRow>
          <input :id="id" v-model="rule.remote_path" type="text" class="form-input" placeholder="MySync/models">
          <BaseButton size="sm" icon-only :aria-label="t('sync.browse.remote_title')" :title="t('sync.browse.remote_title')" @click="emit('browse', 'remote', 'remote_path')"><MsIcon name="folder_open" /></BaseButton>
        </FieldControlRow>
      </template>
    </FormField>
    <FormField :label="t('sync.rule.local_path')" density="compact">
      <template #default="{ id }">
        <FieldControlRow>
          <input :id="id" v-model="rule.local_path" type="text" class="form-input" placeholder="/ComfyUI/models/loras">
          <BaseButton size="sm" icon-only :aria-label="t('sync.browse.local_title')" :title="t('sync.browse.local_title')" @click="emit('browse', 'local', 'local_path')"><MsIcon name="folder_open" /></BaseButton>
        </FieldControlRow>
      </template>
    </FormField>
    <FormField :label="t('sync.rule.filters')" density="compact">
      <template #default="{ id }">
        <textarea :id="id" v-model="rule.filters" rows="3" class="form-textarea form-textarea--mono" :placeholder="t('sync.rule.filters_placeholder')"></textarea>
      </template>
    </FormField>
  </div>
</template>

<style scoped>
.rule-fields { display: grid; gap: 10px; }

.rule-fields__row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

@media (max-width: 640px) {
  .rule-fields__row { grid-template-columns: 1fr; }
}
</style>
