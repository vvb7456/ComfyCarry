<script setup lang="ts">
/**
 * TunnelSwitchOverlay — 隧道切换全屏遮罩。
 *
 * 挂在 App.vue (ConfirmProvider 内、页面之上)。切换进行中冻结页面交互, 展示
 * 切换进度与新地址 (完整域名, 不脱敏); 失败态提供手动刷新与复制新地址入口。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Spinner from '@/components/ui/Spinner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useTunnelSwitch } from '@/composables/useTunnelSwitch'
import { useClipboard } from '@/composables/useClipboard'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'TunnelSwitchOverlay' })

const { t } = useI18n({ useScope: 'global' })
const { copy } = useClipboard()
const { visible, phase, newUrl, directMode, error, errorParams, unreachable, dismiss } = useTunnelSwitch()

const failed = computed(() => phase.value === 'failed')

const fullHost = computed(() => {
  try {
    return new URL(newUrl.value).hostname
  } catch {
    return ''
  }
})

const title = computed(() => (failed.value ? t('tunnel.switch.failed_title') : t('tunnel.switch.title')))

const description = computed(() => {
  if (failed.value) {
    if (unreachable.value) return t('tunnel.switch.unreachable')
    if (error.value) return apiErrorText({ error_key: error.value, error_params: errorParams.value }, t('tunnel.switch.failed_hint'))
    return t('tunnel.switch.failed_hint')
  }
  if (directMode.value) return t('tunnel.switch.direct_hint')
  return t('tunnel.switch.progress')
})

function reload() {
  window.location.reload()
}

function copyNew() {
  void copy(newUrl.value)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="tunnel-switch-overlay"
      role="alertdialog"
      aria-modal="true"
      :aria-label="title"
    >
      <div class="tunnel-switch-card">
        <div class="tunnel-switch-icon" :class="{ 'tunnel-switch-icon--error': failed }">
          <Spinner v-if="!failed" size="lg" />
          <MsIcon v-else name="error_outline" size="lg" color="none" />
        </div>

        <h2 class="tunnel-switch-title">{{ title }}</h2>
        <p class="tunnel-switch-desc">{{ description }}</p>
        <p v-if="!failed && fullHost" class="tunnel-switch-host">
          {{ t('tunnel.switch.new_host', { host: fullHost }) }}
        </p>

        <div v-if="failed" class="tunnel-switch-actions">
          <BaseButton variant="primary" size="sm" @click="reload">
            {{ t('tunnel.switch.reload') }}
          </BaseButton>
          <BaseButton v-if="newUrl" size="sm" @click="copyNew">
            {{ t('tunnel.switch.copy_new') }}
          </BaseButton>
          <BaseButton size="sm" @click="dismiss">
            {{ t('tunnel.switch.dismiss') }}
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tunnel-switch-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: color-mix(in srgb, var(--bg1) 78%, transparent);
  backdrop-filter: blur(3px);
}

.tunnel-switch-card {
  width: 100%;
  max-width: 380px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  box-shadow: var(--sh);
  padding: 28px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.tunnel-switch-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ac) 12%, transparent);
  color: var(--ac);
}

.tunnel-switch-icon--error {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
}

.tunnel-switch-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
  margin: 0;
}

.tunnel-switch-desc {
  font-size: .84rem;
  color: var(--t2);
  line-height: 1.55;
  margin: 0;
}

.tunnel-switch-host {
  font-size: .78rem;
  color: var(--t3);
  margin: 0;
  word-break: break-all;
}

.tunnel-switch-actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: 6px;
}
</style>
