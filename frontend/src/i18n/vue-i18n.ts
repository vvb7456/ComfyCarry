import { createI18n } from 'vue-i18n'

// ── Static locale imports ──
import zhCommon from './locales/zh-CN/common.json'
import zhNav from './locales/zh-CN/nav.json'
import zhDashboard from './locales/zh-CN/dashboard.json'
import zhComfyui from './locales/zh-CN/comfyui.json'
import zhModels from './locales/zh-CN/models.json'
import zhPlugins from './locales/zh-CN/plugins.json'
import zhTunnel from './locales/zh-CN/tunnel.json'
import zhJupyter from './locales/zh-CN/jupyter.json'
import zhSync from './locales/zh-CN/sync.json'
import zhSsh from './locales/zh-CN/ssh.json'
import zhSettings from './locales/zh-CN/settings.json'
import zhGenerate from './locales/zh-CN/generate.json'
import zhWizard from './locales/zh-CN/wizard.json'
import zhPromptLibrary from './locales/zh-CN/prompt-library.json'

import enCommon from './locales/en/common.json'
import enNav from './locales/en/nav.json'
import enDashboard from './locales/en/dashboard.json'
import enComfyui from './locales/en/comfyui.json'
import enModels from './locales/en/models.json'
import enPlugins from './locales/en/plugins.json'
import enTunnel from './locales/en/tunnel.json'
import enJupyter from './locales/en/jupyter.json'
import enSync from './locales/en/sync.json'
import enSsh from './locales/en/ssh.json'
import enSettings from './locales/en/settings.json'
import enGenerate from './locales/en/generate.json'
import enWizard from './locales/en/wizard.json'
import enPromptLibrary from './locales/en/prompt-library.json'

function detectLanguage(): string {
  const stored = localStorage.getItem('lang')
  if (stored) return stored
  const nav = navigator.language || ''
  return nav.startsWith('zh') ? 'zh-CN' : 'en'
}

const i18n = createI18n({
  legacy: false,
  locale: detectLanguage(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      common: zhCommon, nav: zhNav, dashboard: zhDashboard,
      comfyui: zhComfyui, models: zhModels, plugins: zhPlugins,
      tunnel: zhTunnel, jupyter: zhJupyter, sync: zhSync,
      ssh: zhSsh, settings: zhSettings, generate: zhGenerate,
      wizard: zhWizard, 'prompt-library': zhPromptLibrary,
    },
    en: {
      common: enCommon, nav: enNav, dashboard: enDashboard,
      comfyui: enComfyui, models: enModels, plugins: enPlugins,
      tunnel: enTunnel, jupyter: enJupyter, sync: enSync,
      ssh: enSsh, settings: enSettings, generate: enGenerate,
      wizard: enWizard, 'prompt-library': enPromptLibrary,
    },
  },
})

export default i18n

/** Switch language and persist to localStorage */
export function switchLanguage(lng: string) {
  const { locale } = i18n.global
  ;(locale as { value: string }).value = lng
  localStorage.setItem('lang', lng)
  document.documentElement.lang = lng === 'zh-CN' ? 'zh-CN' : 'en'
}
