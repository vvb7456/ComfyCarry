<script setup lang="ts">
/**
 * 设置分区: 关于 — 与原版 (SettingsTabComfyCarry 的 About 区) 视觉/功能完全一致。
 * 结构 = about-identity / desc / about-update-block (检查更新 + 重新初始化) /
 * about-project (链接 / 署名)。更新与重新初始化逻辑自原组件原样迁移。
 * 差异: 独立特殊尾分区 (无 L1 标题, 上方 72px 间距顶替原分区标题)。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText, type ApiErrorBody } from '@/utils/apiError'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'

defineOptions({ name: 'SettingsAboutFooter' })

const { t, te } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()
const app = useAppStore()

const repoUrl = 'https://github.com/vvb7456/ComfyCarry'
const dockerHubUrl = 'https://hub.docker.com/r/erocraft/comfycarry'
const erocraftUrl = 'https://www.erocraft.com/'
const copyrightRange = `2015–${new Date().getFullYear()}`

// ─── 更新 (自原 SettingsTabComfyCarry 迁移) ──────────────────────────────────

const updateChecking = ref(false)
const updateApplying = ref(false)
const updateInfo = ref<{
  current_version?: string
  current_commit?: string
  latest_version?: string
  latest_name?: string
  latest_message?: string
  has_update?: boolean
} | null>(null)
const updatePhase = ref('')
const updateActionLabel = computed(() => {
  if (updateChecking.value) return t('settings.update.checking')
  if (updateApplying.value) return t('settings.update.applying')
  return updateInfo.value?.has_update
    ? t('settings.update.apply_btn')
    : t('settings.update.check_btn')
})

function localizedUpdatePhase(phase: string, fallback = '') {
  const key = `settings.update.phase.${phase}`
  return te(key) ? t(key) : (fallback || phase)
}

async function runUpdateAction() {
  if (updateChecking.value || updateApplying.value) return
  if (updateInfo.value?.has_update) {
    await applyUpdate()
  } else {
    await checkUpdate()
  }
}

async function checkUpdate() {
  updateChecking.value = true
  updateInfo.value = null
  updatePhase.value = ''
  const data = await get<{
    current_version: string
    current_commit: string
    latest_version: string
    latest_name: string
    latest_message: string
    has_update: boolean
  }>('/api/update/check')
  updateChecking.value = false
  if (!data) return
  updateInfo.value = data
}

async function applyUpdate() {
  if (!await confirm({
    title: t('settings.confirm.update.title'),
    message: t('settings.confirm.update.message', {
      current: updateInfo.value?.current_version || '—',
      latest: updateInfo.value?.latest_version || '—',
    }),
    confirmText: t('settings.confirm.update.button'),
  })) return
  updateApplying.value = true
  updatePhase.value = t('settings.update.applying')
  let terminalPhase = false
  let updateCompleted = false
  try {
    const resp = await fetch('/api/update/apply', { method: 'POST' })
    if (!resp.ok) {
      let message = t('settings.update.error')
      try { message = apiErrorText(await resp.json(), message) } catch { /* ignore parse errors */ }
      toast(message, 'error')
      return
    }
    if (!resp.body) {
      toast(t('settings.update.error'), 'error')
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const ev = JSON.parse(line.slice(6))
          updatePhase.value = localizedUpdatePhase(ev.phase, ev.message)
          if (ev.phase === 'done') {
            terminalPhase = true
            updateCompleted = true
            toast(t('settings.update.done'), 'success')
            setTimeout(() => {
              updateApplying.value = false
              location.reload()
            }, 4000)
          } else if (ev.phase === 'error') {
            terminalPhase = true
            toast(`${t('settings.update.error')}: ${ev.message}`, 'error')
          }
        } catch { /* ignore parse errors */ }
      }
    }
    if (!terminalPhase) toast(t('settings.update.error'), 'error')
  } catch (e: any) {
    toast(`${t('settings.update.error')}: ${e.message}`, 'error')
  } finally {
    if (!updateCompleted) {
      updateApplying.value = false
      updatePhase.value = ''
    }
  }
}

// ─── 重新初始化 (自原 SettingsTabComfyCarry 迁移) ────────────────────────────

const reinitKeepModels = ref(true)
const reinitLoading = ref(false)

async function reinitialize() {
  if (!await confirm({
    title: t('settings.confirm.reinit.title'),
    message: t('settings.confirm.reinit.message'),
    confirmText: t('settings.confirm.reinit.button'),
    checkboxLabel: t('settings.confirm.reinit.checkbox'),
    checkboxDefault: true,
    checkboxRef: reinitKeepModels,
    variant: 'danger',
  })) return
  reinitLoading.value = true
  toast(t('settings.reinit.in_progress'), 'info')
  const data = await post<{ ok?: boolean; errors?: ApiErrorBody[] }>('/api/settings/reinitialize', { keep_models: reinitKeepModels.value })
  reinitLoading.value = false
  if (!data) return
  if (data.ok) {
    toast(t('settings.reinit.success'), 'success')
    setTimeout(() => location.reload(), 1500)
  } else {
    // 每步各自成败 → errors 是内嵌的 key + params 数组 (settings.py _err_item)
    const detail = (data.errors || []).map(e => apiErrorText(e)).join('; ')
    toast(`${t('settings.reinit.partial_fail')}: ${detail}`, 'error')
  }
}
</script>

<template>
  <!-- 视觉/结构与原版 About 区完全一致 (class 名自原组件迁移) -->
  <div class="about-content" aria-labelledby="about-product-name">
    <header class="about-identity">
      <img class="about-logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
      <h3 id="about-product-name" class="about-product-name">Comfy<span class="about-product-name__b">Carry</span></h3>
      <div class="about-build">
        <span>{{ t('settings.about.version') }} {{ app.version || '—' }}</span>
        <span class="about-meta-sep" aria-hidden="true">·</span>
        <code>{{ (app.commit || '').substring(0, 8) || '—' }}</code>
      </div>
    </header>

    <p class="about-desc">{{ t('settings.about.desc') }}</p>

    <div class="about-update-block">
      <div class="about-actions">
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="updateChecking || updateApplying"
          :loading="updateChecking || updateApplying"
          :aria-label="updateActionLabel"
          @click="runUpdateAction"
        >
          {{ updateActionLabel }}
        </BaseButton>
        <BaseButton size="sm" :loading="reinitLoading" @click="reinitialize">
          {{ t('settings.reinit.btn') }}
        </BaseButton>
      </div>
      <div
        class="about-update-status"
        aria-live="polite"
        :aria-busy="updateChecking || updateApplying"
      >
        <template v-if="updateChecking || updateApplying">
          <span>{{ updateApplying ? updatePhase : t('settings.update.checking') }}</span>
        </template>
        <template v-else-if="updateInfo">
          <StatusDot :status="updateInfo.has_update ? 'pending' : 'success'" size="sm" />
          <span>{{ updateInfo.has_update ? t('settings.update.update_available') : t('settings.update.up_to_date') }}</span>
          <span v-if="updateInfo.has_update && updateInfo.latest_version" class="about-update-target">
            <span>{{ updateInfo.latest_version }}</span>
          </span>
        </template>
      </div>
    </div>

    <footer class="about-project" :aria-label="t('settings.about.project_info')">
      <p class="about-project-label">{{ t('settings.about.project_info') }}</p>
      <div class="about-project-links">
        <a class="link about-project-link" :href="repoUrl" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
          <span>{{ t('settings.about.github') }}</span>
        </a>
        <a class="link about-project-link" :href="dockerHubUrl" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z" /></svg>
          <span>{{ t('settings.about.dockerhub') }}</span>
        </a>
      </div>
      <p class="about-credit">
        <i18n-t keypath="settings.about.credit" tag="span">
          <template #link>
            <a class="about-author" :href="erocraftUrl" target="_blank" rel="noopener noreferrer" lang="zh-CN">艾萝工坊</a>
          </template>
        </i18n-t>
      </p>
      <p class="about-copyright" lang="en">© {{ copyrightRange }} Erocraft</p>
    </footer>
  </div>
</template>

<style scoped>
/* Vue-unique: centered About identity block (样式自原 SettingsTabComfyCarry 原样迁移) */
.about-content {
  text-align: center;
}
.about-logo {
  display: block;
  width: 60px;
  height: 60px;
  margin: 0 auto 16px;
}
.about-product-name {
  margin: 0;
  color: var(--t1);
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -.015em;
}
.about-product-name__b {
  color: var(--ac);
}
.about-build {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
  color: var(--t2);
  font-size: .76rem;
  line-height: 1.5;
}
.about-build code {
  padding: 1px 5px;
  border-radius: var(--r-xs);
  background: var(--bg2);
  color: var(--t2);
  font-family: 'IBM Plex Mono', monospace;
  font-size: .7rem;
}
.about-meta-sep {
  color: var(--t3);
}
.about-desc {
  max-width: 50ch;
  margin: 20px auto 0;
  color: var(--t2);
  font-size: .86rem;
  line-height: 1.7;
}
.about-update-block {
  margin-top: 22px;
}
.about-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.about-update-status {
  display: flex;
  min-height: 1.5em;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
  color: var(--t2);
  font-size: .76rem;
  line-height: 1.5;
}
.about-update-target {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--t3);
}
/* "项目信息"靠留白与自身小标签分段, 不再画全宽线 (上方已有 footer hairline) */
.about-project {
  margin-top: 32px;
}
.about-project-label {
  margin: 0 0 11px;
  color: var(--t3);
  font-size: .72rem;
  font-weight: 600;
  letter-spacing: .06em;
}
.about-project-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px 18px;
  flex-wrap: wrap;
}
.about-project-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: .79rem;
  font-weight: 500;
}
.about-author:hover {
  color: var(--ac2);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.about-project-link svg {
  width: 15px;
  height: 15px;
  flex: none;
}
.about-credit {
  margin: 14px 0 0;
  color: var(--t2);
  font-size: .76rem;
  line-height: 1.55;
}
.about-author {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}
.about-copyright {
  margin: 3px 0 0;
  color: var(--t3);
  font-size: .72rem;
  line-height: 1.5;
}
</style>