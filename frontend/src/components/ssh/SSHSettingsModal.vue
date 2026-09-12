<script setup lang="ts">
/**
 * SSHSettingsModal — SSH 页内设置弹窗 (C05)。
 *
 * 由设置页「登录与认证」面板迁入这里的唯一一项: SSH 密码跟随面板密码。
 * 保留原即时开关语义 (无草稿 / 无保存按钮): 拨动即请求, 失败或取消按需回弹;
 * 打开时先拉 /api/ssh/status 读取 pw_follow 初始态。
 *
 * 关键保留点: 「无公钥时关闭密码登录」由后端 409 + error_key=ssh.err.lockout_risk
 * 触发 danger 确认, 确认后带 force 重发。该请求不走 useApiFetch, 因为要读取 409
 * 状态码做分支, 同时避免 useApiFetch 的自动 toast 在确认流程里双重弹出。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText, type ApiErrorBody } from '@/utils/apiError'
import type { SSHStatus } from '@/types/ssh'

defineOptions({ name: 'SSHSettingsModal' })

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 开关实际变更成功: 页面刷新认证事实 */
  changed: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const follow = ref(false)
const loading = ref(true)
const loadError = ref(false)
const submitting = ref(false)

/** 打开弹窗时读取开关初始态 */
async function loadState(): Promise<void> {
  loading.value = true
  loadError.value = false
  const data = await get<SSHStatus>('/api/ssh/status')
  loading.value = false
  if (!data) {
    loadError.value = true
    return
  }
  follow.value = !!data.pw_follow
}

watch(() => props.modelValue, (open) => {
  if (open) void loadState()
})

type PwFollowResponse = ApiErrorBody & { ok?: boolean; password_auth_enabled?: boolean }

/** password-follow 专用请求。封装方式同 OAuthWizard 的 oauthFetch。 */
async function pwFollowFetch(body: { enabled: boolean; force?: boolean }) {
  try {
    const res = await fetch('/api/ssh/password-follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      window.location.href = '/login'
      return { status: 401, data: null as PwFollowResponse | null }
    }
    let data: PwFollowResponse | null = null
    try { data = await res.json() as PwFollowResponse } catch { /* 空响应体 */ }
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null as PwFollowResponse | null }
  }
}

/** 应用开关。UI 已乐观更新, 失败/取消在这里回弹。 */
async function applyPwFollow(enabled: boolean, force = false): Promise<void> {
  submitting.value = true
  const { status, data } = await pwFollowFetch({ enabled, force })
  submitting.value = false

  // 无公钥锁死防护: 后端 409 未做任何变更 → 确认后 force 重发, 取消回弹
  if (status === 409 && data?.error_key === 'ssh.err.lockout_risk') {
    const go = await confirm({
      title: t('ssh.confirm.lockout.title'),
      message: t('ssh.confirm.lockout.message'),
      confirmText: t('ssh.confirm.lockout.button'),
    })
    if (go) { await applyPwFollow(false, true); return }
    follow.value = true
    return
  }

  if (status !== 200 || !data?.ok) {
    // 后端 error_key (ssh.err.*) 已接 i18n, apiErrorText 翻译; 网络层失败落回兜底
    toast(apiErrorText(data, t('ssh.err.fallback')), 'error')
    follow.value = !enabled
    return
  }
  follow.value = data.password_auth_enabled ?? enabled
  toast(t(enabled ? 'ssh.settings.enabled_toast' : 'ssh.settings.disabled_toast'), 'success')
  emit('changed')
}

function onToggle(enabled: boolean): void {
  if (submitting.value) return
  follow.value = enabled
  void applyPwFollow(enabled)
}

function close(): void {
  if (!submitting.value) emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('ssh.settings.title')"
    width="600px"
    :close-on-overlay="!submitting"
    :close-on-esc="!submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="settings-skeleton" aria-hidden="true">
      <div class="settings-skeleton__row">
        <div class="settings-skeleton__lines">
          <div class="settings-skeleton__line settings-skeleton__line--text" />
          <div class="settings-skeleton__line settings-skeleton__line--text-sm" />
        </div>
        <div class="settings-skeleton__line settings-skeleton__line--control" />
      </div>
    </div>

    <!-- 加载失败: 错误 + 重试 (不渲染开关, 防止初值冒充服务端值) -->
    <EmptyState v-else-if="loadError" icon="error_outline" :message="t('common.load_failed')">
      <BaseButton size="sm" @click="loadState">{{ t('common.btn.retry') }}</BaseButton>
    </EmptyState>

    <div v-else class="settings-lines">
      <SettingsGroupToggleRow
        :label="t('ssh.settings.label')"
        :desc="t('ssh.settings.desc')"
        :help="t('ssh.settings.help')"
        :model-value="follow"
        :disabled="loading || submitting"
        @update:model-value="onToggle"
      />
    </div>

    <template #footer>
      <BaseButton :disabled="submitting" @click="close">{{ t('common.btn.close') }}</BaseButton>
    </template>
  </BaseModal>
</template>
