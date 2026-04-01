import { ref, watch } from 'vue'

export type ThemeMode = 'dark' | 'light' | 'system'

const THEME_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

const mode = ref<ThemeMode>('system')

let initialized = false
let mediaQuery: MediaQueryList | null = null

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system'
}

function applyTheme() {
  if (typeof document === 'undefined') return
  const isDark =
    mode.value === 'dark' ||
    (mode.value === 'system' && !!mediaQuery?.matches)
  document.documentElement.dataset.theme = isDark ? '' : 'light'
}

function handleSystemThemeChange() {
  if (mode.value === 'system') applyTheme()
}

function initTheme() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const saved = window.localStorage.getItem(THEME_KEY)
  if (isThemeMode(saved)) mode.value = saved

  mediaQuery = window.matchMedia(DARK_QUERY)

  watch(mode, (value) => {
    window.localStorage.setItem(THEME_KEY, value)
    applyTheme()
  }, { immediate: true })

  mediaQuery.addEventListener('change', handleSystemThemeChange)
}

/**
 * Theme management composable.
 * Syncs with localStorage and system preference.
 */
export function useTheme() {
  initTheme()

  function cycle() {
    const order: ThemeMode[] = ['dark', 'light', 'system']
    const idx = order.indexOf(mode.value)
    mode.value = order[(idx + 1) % order.length]
  }

  return { mode, cycle, apply: applyTheme }
}
