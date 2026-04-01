<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import FormField from '@/components/form/FormField.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  installed: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { post } = useApiFetch()
const { toast } = useToast()

const gitUrl = ref('')
const installing = ref(false)
const status = ref<{ ok?: boolean; message?: string } | null>(null)

async function install() {
  if (!gitUrl.value.trim()) { toast(t('plugins.git.empty_url'), 'warning'); return }
  if (!gitUrl.value.startsWith('http')) { toast(t('plugins.git.invalid_url'), 'warning'); return }
  installing.value = true
  status.value = null
  const d = await post<{ message: string }>('/api/plugins/install_git', { url: gitUrl.value })
  installing.value = false
  if (!d) {
    status.value = { ok: false, message: t('plugins.git.request_failed') }
    return
  }
  status.value = { ok: true, message: d.message }
  gitUrl.value = ''
  emit('installed')
}

function onClose(val: boolean) {
  emit('update:modelValue', val)
  if (!val) status.value = null
}
</script>

<template>
  <BaseModal :model-value="modelValue" :title="t('plugins.git.title')" width="560px" @update:modelValue="onClose">
    <p style="font-size:.82rem;color:var(--t2);margin-bottom:12px">
      <MsIcon name="link" /> {{ t('plugins.git.desc') }}
    </p>
    <FormField>
      <FieldControlRow>
        <input v-model="gitUrl" type="text" class="form-input" :placeholder="t('plugins.git.placeholder')" @keydown.enter="install">
        <BaseButton variant="primary" :disabled="installing" style="padding:8px 20px" @click="install">
          {{ installing ? t('plugins.git.installing_btn') : t('plugins.git.install') }}
        </BaseButton>
      </FieldControlRow>
    </FormField>
    <AlertBanner v-if="status" :tone="status.ok ? 'success' : 'danger'" dense style="margin-top:12px">{{ status.message }}</AlertBanner>
  </BaseModal>
</template>
