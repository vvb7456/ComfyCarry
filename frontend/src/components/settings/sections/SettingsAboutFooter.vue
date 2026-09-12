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
import BrandIcon from '@/components/ui/BrandIcon.vue'
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    toast(`${t('settings.update.error')}: ${message}`, 'error')
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
          <BrandIcon name="github" :size="16" />
          <span>{{ t('settings.about.github') }}</span>
        </a>
        <a class="link about-project-link" :href="dockerHubUrl" target="_blank" rel="noopener noreferrer">
          <BrandIcon name="docker" :size="16" />
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