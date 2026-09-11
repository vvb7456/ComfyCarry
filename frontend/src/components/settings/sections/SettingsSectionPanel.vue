<script setup lang="ts">
/**
 * 设置分区: 面板 — 两个即时动作模块 (单页 v3: L2 模块 + 行, 无草稿态无守卫):
 *   1. 登录与认证: 修改登录密码 (modal) / API Key (只读+重生成)
 *   2. 配置管理: 导出配置 / 导入配置
 * 重新初始化已归位 About 区 (SettingsAboutFooter, 与原版一致)。
 * SSH 密码跟随已迁入 SSH 页页内设置 (C05), 此处不再保留。
 * onMounted 加载 /api/settings; API Key 行失败就地重试。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsModule from '@/components/settings/SettingsModule.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FormField from '@/components/form/FormField.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText, apiMessageText, type ApiErrorBody } from '@/utils/apiError'

defineOptions({ name: 'SettingsSectionPanel' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ─── Password state (modal) ──────────────────────────────────────────────────

const pwModalOpen = ref(false)
const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwSubmitting = ref(false)

function openPwModal() {
  pwCurrent.value = ''
  pwNew.value = ''
  pwConfirm.value = ''
  pwModalOpen.value = true
}

// ─── API Key state ───────────────────────────────────────────────────────────

const apiKey = ref('')
const apiKeyRevealed = ref(false)
const regenLoading = ref(false)
const apiKeyLoading = ref(true)
const apiKeyError = ref(false)

// ─── Load / actions ──────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await get<{ api_key?: string }>('/api/settings')
  if (!data) {
    apiKeyError.value = true
    return
  }
  apiKeyError.value = false
  if (data.api_key) apiKey.value = data.api_key
}

async function changePassword() {
  if (!pwCurrent.value) { toast(t('settings.password.err_current'), 'error'); return }
  if (!pwNew.value) { toast(t('settings.password.err_new'), 'error'); return }
  if (pwNew.value.length < 4) { toast(t('settings.password.err_min_length'), 'error'); return }
  if (pwNew.value !== pwConfirm.value) { toast(t('settings.password.err_mismatch'), 'error'); return }
  pwSubmitting.value = true
  const data = await post<ApiErrorBody & { message?: string; error?: string }>('/api/settings/password', {
    current: pwCurrent.value,
    new: pwNew.value,
  })
  pwSubmitting.value = false
  if (!data) return
  if (data.error_key || data.error) {
    toast(apiErrorText(data, t('settings.password.err_current')), 'error')
  } else {
    toast(apiMessageText(data), 'success')
    pwModalOpen.value = false
  }
}

async function regenerateApiKey() {
  if (!await confirm({ message: t('settings.api_key.regenerate_confirm') })) return
  regenLoading.value = true
  const data = await post<{ ok?: boolean; api_key?: string; error?: string }>('/api/settings/api-key', {})
  regenLoading.value = false
  if (!data) return
  if (data.ok && data.api_key) {
    apiKey.value = data.api_key
    apiKeyRevealed.value = true
    toast(t('settings.api_key.regenerated'), 'success')
  } else {
    toast(apiErrorText(data, t('settings.api_key.regenerate_failed')), 'error')
  }
}

async function exportConfig() {
  try {
    const res = await fetch('/api/settings/export-config')
    if (!res.ok) { toast(t('settings.config.export_failed'), 'error'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `comfycarry-config-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(t('settings.config.exported'), 'success')
  } catch (e: any) {
    toast(`${t('settings.config.export_failed')}: ${e.message}`, 'error')
  }
}

async function importConfig(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(event.target as HTMLInputElement).value = ''
  try {
    const text = await file.text()
    const config = JSON.parse(text)
    if (!config._version) { toast(t('settings.config.invalid_format'), 'error'); return }
    if (!await confirm({ message: t('settings.config.import_confirm', { date: config._exported_at || t('settings.config.unknown_date') }) })) return
    const data = await post<{ message?: string }>('/api/settings/import-config', JSON.parse(text))
    if (!data) return
    toast(apiMessageText(data), 'success')
    await loadSettings()
  } catch (e: any) {
    toast(`${t('settings.config.import_failed')}: ${e.message}`, 'error')
  }
}

onMounted(() => {
  void loadSettings().finally(() => { apiKeyLoading.value = false })
})
</script>

<template>
  <!-- 模块 1: 登录与认证 (即时动作, 无 dirty) -->
    <SettingsModule id="settings-focus-password" :title="t('settings.domains.auth')">
      <div v-if="apiKeyError" class="settings-lines">
        <EmptyState icon="cloud_off" :message="t('common.load_failed')">
          <BaseButton size="sm" @click="loadSettings">{{ t('common.btn.retry') }}</BaseButton>
        </EmptyState>
      </div>

      <div v-else class="settings-lines">
        <!-- 修改登录密码 (modal 即时动作) -->
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.password.row_label') }}</div>
            <div class="settings-row__desc">{{ t('settings.password.row_desc') }}</div>
          </div>
          <div class="settings-row__control">
            <BaseButton size="sm" @click="pwModalOpen = true">
              {{ t('settings.password.change_btn') }}
            </BaseButton>
          </div>
        </div>

        <!-- API Key (只读 + 重新生成) -->
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">
              {{ t('settings.api_key.title') }}
              <HelpTip :text="t('settings.api_key.help')" />
            </div>
            <div class="settings-row__desc">{{ t('settings.api_key.row_desc') }}</div>
          </div>
          <div class="settings-row__control settings-row__control--stack">
            <div class="settings-row__control-row">
              <SecretInput
                v-if="!apiKeyLoading"
                v-model="apiKey"
                v-model:revealed="apiKeyRevealed"
                readonly
                copyable
                input-class="form-input mono-input"
              />
              <div v-else class="settings-skeleton__line settings-skeleton__line--control" />
              <BaseButton
                size="sm"
                :loading="regenLoading"
                :title="t('settings.api_key.regenerate')"
                @click="regenerateApiKey"
              >
                <MsIcon name="autorenew" />
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </SettingsModule>

    <!-- 模块 2: 配置管理 (即时动作, 无 dirty) -->
    <SettingsModule id="settings-focus-config" :title="t('settings.domains.configmgmt')">
      <div class="settings-lines">
        <div class="settings-action">
          <div class="settings-action__text">
            <div class="settings-action__title">{{ t('settings.config.export_title') }}</div>
            <div class="settings-row__desc">{{ t('settings.config.export_desc') }}</div>
          </div>
          <BaseButton size="sm" @click="exportConfig">
            <MsIcon name="download" /> {{ t('settings.config.export_btn') }}
          </BaseButton>
        </div>
        <div class="settings-action">
          <div class="settings-action__text">
            <div class="settings-action__title">{{ t('settings.config.import_title') }}</div>
            <div class="settings-row__desc">{{ t('settings.config.import_desc') }}</div>
          </div>
          <BaseButton size="sm" @click="($refs.importFileInput as HTMLInputElement)?.click()">
            <MsIcon name="upload" /> {{ t('settings.config.import_btn') }}
          </BaseButton>
          <input ref="importFileInput" type="file" accept=".json" @change="importConfig" style="display:none" />
        </div>
      </div>
  </SettingsModule>

  <!-- 改密 modal -->
  <BaseModal v-model="pwModalOpen" :title="t('settings.password.title')" icon="lock">
    <form @submit.prevent="changePassword" autocomplete="off">
      <input
        type="text"
        name="username"
        autocomplete="username"
        tabindex="-1"
        aria-hidden="true"
        style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
      />
      <FormField :label="t('settings.password.current')">
        <SecretInput
          v-model="pwCurrent"
          is-password
          :placeholder="t('settings.password.current_placeholder')"
          autocomplete="current-password"
          input-class="form-input"
        />
      </FormField>
      <FormField :label="t('settings.password.new')">
        <SecretInput
          v-model="pwNew"
          is-password
          :placeholder="t('settings.password.new_placeholder')"
          autocomplete="new-password"
          input-class="form-input"
        />
      </FormField>
      <FormField :label="t('settings.password.confirm')">
        <SecretInput
          v-model="pwConfirm"
          is-password
          :placeholder="t('settings.password.confirm_placeholder')"
          autocomplete="new-password"
          input-class="form-input"
        />
      </FormField>
    </form>
    <template #footer>
      <BaseButton variant="primary" :loading="pwSubmitting" @click="changePassword">
        {{ t('settings.password.update_btn') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/* Vue-unique: mono variant for API key display */
.mono-input {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .82rem;
  letter-spacing: .5px;
  padding-right: 72px;
}
</style>
