/**
 * 提示词编辑器设置 — 全局共享 composable
 *
 * 模块级 ref，多组件导入同一份状态。
 * SettingsPage 和 PromptEditorModal 都可读写。
 */
import { reactive, readonly, ref } from 'vue'

import type { PromptEditorSettings } from '@/types/prompt-library'
import { useApiFetch } from '@/composables'

// ── 默认值 ────────────────────────────────────────────────────

const DEFAULTS: PromptEditorSettings = {
  show_translation: true,
  show_nsfw: false,
  normalize_comma: true,
  normalize_period: true,
  normalize_bracket: true,
  normalize_underscore: false,
  comma_close_autocomplete: false,
  escape_bracket: false,
  autocomplete_limit: 20,
  translate_provider: '',
}

// ── 模块级共享状态 ─────────────────────────────────────────────

const settings = reactive<PromptEditorSettings>({ ...DEFAULTS })
const loaded = ref(false)
const saving = ref(false)
const translateProviders = ref<string[]>([])
const translateDefaultChain = ref<string[]>([])

// ── composable ────────────────────────────────────────────────

export function usePromptSettings() {
  const { get, put } = useApiFetch()

  /** 从后端加载设置 (首次调用时执行，后续跳过) */
  async function load(force = false) {
    if (loaded.value && !force) return
    const res = await get<PromptEditorSettings & {
      translate_providers?: string[]
      translate_default_chain?: string[]
    }>('/api/prompt-library/settings')
    if (res) {
      Object.assign(settings, {
        show_translation: res.show_translation ?? DEFAULTS.show_translation,
        show_nsfw: res.show_nsfw ?? DEFAULTS.show_nsfw,
        normalize_comma: res.normalize_comma ?? DEFAULTS.normalize_comma,
        normalize_period: res.normalize_period ?? DEFAULTS.normalize_period,
        normalize_bracket: res.normalize_bracket ?? DEFAULTS.normalize_bracket,
        normalize_underscore: res.normalize_underscore ?? DEFAULTS.normalize_underscore,
        comma_close_autocomplete: res.comma_close_autocomplete ?? DEFAULTS.comma_close_autocomplete,
        escape_bracket: res.escape_bracket ?? DEFAULTS.escape_bracket,
        autocomplete_limit: res.autocomplete_limit ?? DEFAULTS.autocomplete_limit,
        translate_provider: res.translate_provider ?? DEFAULTS.translate_provider,
      })
      translateProviders.value = res.translate_providers ?? []
      translateDefaultChain.value = res.translate_default_chain ?? []
      loaded.value = true
    }
  }

  /** 保存设置到后端 */
  async function save(): Promise<boolean> {
    saving.value = true
    try {
      const res = await put<{ ok: boolean }>('/api/prompt-library/settings', {
        show_translation: settings.show_translation,
        show_nsfw: settings.show_nsfw,
        normalize_comma: settings.normalize_comma,
        normalize_period: settings.normalize_period,
        normalize_bracket: settings.normalize_bracket,
        normalize_underscore: settings.normalize_underscore,
        comma_close_autocomplete: settings.comma_close_autocomplete,
        escape_bracket: settings.escape_bracket,
        autocomplete_limit: settings.autocomplete_limit,
        translate_provider: settings.translate_provider,
      })
      return !!res?.ok
    } finally {
      saving.value = false
    }
  }

  return {
    settings,
    loaded: readonly(loaded),
    saving: readonly(saving),
    translateProviders: readonly(translateProviders),
    translateDefaultChain: readonly(translateDefaultChain),
    load,
    save,
  }
}
