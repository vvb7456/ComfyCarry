<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { switchLanguage } from '@/i18n/vue-i18n'
import { useTheme } from '@/composables/useTheme'
import MsIcon from '@/components/ui/MsIcon.vue'
import type { IconName } from '@/config/icon-codepoints'

defineOptions({ name: 'LoginApp' })

const { t, locale } = useI18n({ useScope: 'global' })
const theme = useTheme()

const themeIconMap: Record<string, IconName> = {
  dark: 'dark_mode',
  light: 'light_mode',
  system: 'contrast',
}
const themeIcon = computed(() => themeIconMap[theme.mode.value] || 'contrast')

const password = ref('')
const passwordVisible = ref(false)
const submitting = ref(false)
const errorKey = ref('')
const errorParams = ref<Record<string, unknown>>({})

const errorMessage = computed(() =>
  errorKey.value ? t(errorKey.value, errorParams.value) : '',
)

watch(locale, () => {
  document.documentElement.lang = locale.value
  document.title = t('auth.title')
}, { immediate: true })

function toggleLanguage() {
  switchLanguage(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}

function togglePassword() {
  passwordVisible.value = !passwordVisible.value
}

interface LoginResponse {
  ok?: boolean
  error_key?: string
  error_params?: Record<string, unknown>
}

async function submit() {
  if (submitting.value) return

  submitting.value = true
  errorKey.value = ''
  errorParams.value = {}

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ password: password.value }),
    })
    const data = await response.json().catch(() => null) as LoginResponse | null

    if (response.ok && data?.ok === true) {
      window.location.assign('/')
      return
    }

    if (data?.error_key) {
      errorKey.value = data.error_key
      errorParams.value = data.error_params || {}
    } else {
      errorKey.value = 'auth.err.network_error'
    }
  } catch {
    errorKey.value = 'auth.err.network_error'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="bg" aria-hidden="true">
      <div class="orb" />
      <div class="orb" />
      <div class="orb" />
    </div>

    <div class="top-controls">
      <button
        type="button"
        class="lang-toggle"
        :title="t('auth.toggle_lang')"
        :aria-label="t('auth.toggle_lang')"
        @click="toggleLanguage"
      >{{ locale === 'zh-CN' ? 'EN' : '中' }}</button>
      <button
        type="button"
        class="theme-toggle"
        :title="t('auth.toggle_theme')"
        :aria-label="t('auth.toggle_theme')"
        @click="theme.cycle()"
      >
        <MsIcon :name="themeIcon" color="none" class="theme-icon" />
      </button>
    </div>

    <div class="card">
      <div class="logo">
        <img src="/logo.png" alt="" width="64" height="64">
        <h1>Comfy<b>Carry</b></h1>
      </div>

      <form @submit.prevent="submit">
        <div v-if="errorMessage" class="err" role="alert" aria-live="polite">
          <MsIcon name="error" size="xs" color="none" /> {{ errorMessage }}
        </div>
        <div class="input-wrap">
          <MsIcon name="lock" class="input-icon" color="none" />
          <input
            id="pw"
            v-model="password"
            name="password"
            :type="passwordVisible ? 'text' : 'password'"
            :placeholder="t('auth.password_placeholder')"
            autocomplete="current-password"
            autofocus
            :disabled="submitting"
          >
          <button
            type="button"
            class="toggle-pw"
            tabindex="-1"
            :title="passwordVisible ? t('auth.hide') : t('auth.show')"
            :aria-label="passwordVisible ? t('auth.hide') : t('auth.show')"
            :disabled="submitting"
            @click="togglePassword"
          >
            <MsIcon :name="passwordVisible ? 'visibility_off' : 'visibility'" color="none" />
          </button>
        </div>
        <button type="submit" class="btn-login" :disabled="submitting">
          {{ t('auth.login') }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
@font-face {
  font-family: 'IBM Plex Sans';
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans/latin-400-normal.woff2') format('woff2');
}

@font-face {
  font-family: 'IBM Plex Sans';
  font-weight: 500;
  font-style: normal;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans/latin-500-normal.woff2') format('woff2');
}

@font-face {
  font-family: 'IBM Plex Sans';
  font-weight: 600;
  font-style: normal;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans/latin-600-normal.woff2') format('woff2');
}

@font-face {
  font-family: 'IBM Plex Sans';
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans/latin-700-normal.woff2') format('woff2');
}

@font-face {
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: 100 700;
  font-display: swap;
  src: url('/fonts/MaterialSymbolsOutlined.woff2') format('woff2');
}

:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

:global(body) {
  overflow: hidden;
}

.login-page,
.login-page * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.login-page {
  --l-bg: #06060c;
  --l-card: rgba(18, 18, 30, .75);
  --l-card-bd: rgba(84, 112, 234, .15);
  --l-input-bg: rgba(10, 10, 18, .7);
  --l-input-bd: #2a2a3e;
  --l-t1: #e8e8f0;
  --l-t3: #68688a;
  --l-orb-op: .15;
  --l-shadow: rgba(0, 0, 0, .4);
  width: 100%;
  min-height: 100vh;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--l-bg);
  color: var(--l-t1);
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: clamp(15px, 1.1vw, 21px);
}

.login-page :deep(.ms) {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  vertical-align: -3px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'liga';
  text-decoration: none !important;
}

html[data-theme="light"] .login-page {
  --l-bg: #f6f8fa;
  --l-card: rgba(255, 255, 255, .9);
  --l-card-bd: rgba(79, 70, 229, .18);
  --l-input-bg: rgba(241, 244, 248, .95);
  --l-input-bd: #d8dee4;
  --l-t1: #0f172a;
  --l-t3: #8c9ba5;
  --l-orb-op: .1;
  --l-shadow: rgba(15, 23, 42, .08);
}

.bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.bg .orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: var(--l-orb-op);
  animation: drift 20s ease-in-out infinite;
}

.bg .orb:nth-child(1) {
  width: 400px;
  height: 400px;
  background: #5470ea;
  top: -10%;
  left: -5%;
  animation-delay: 0s;
}

.bg .orb:nth-child(2) {
  width: 350px;
  height: 350px;
  background: #7a97ff;
  bottom: -10%;
  right: -5%;
  animation-delay: -7s;
}

.bg .orb:nth-child(3) {
  width: 300px;
  height: 300px;
  background: #38bdf8;
  top: 50%;
  left: 60%;
  animation-delay: -14s;
}

@keyframes drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(30px, -40px) scale(1.05); }
  50% { transform: translate(-20px, 30px) scale(.95); }
  75% { transform: translate(40px, 20px) scale(1.02); }
}

.top-controls {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-toggle {
  background: none;
  border: none;
  color: var(--l-t1);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 50%;
  transition: color .2s;
  appearance: none;
  -webkit-appearance: none;
}

.theme-toggle:hover {
  color: #5470ea;
}

.theme-toggle :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
}

.lang-toggle {
  background: rgba(255, 255, 255, .06);
  border: 1px solid var(--l-card-bd);
  color: var(--l-t1);
  border-radius: 4px;
  font-size: .68rem;
  font-weight: 600;
  padding: 4px 8px;
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
  letter-spacing: .03em;
  white-space: nowrap;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

html[data-theme="light"] .lang-toggle {
  background: rgba(241, 244, 248, .75);
}

.lang-toggle:hover {
  background: rgba(255, 255, 255, .12);
}

html[data-theme="light"] .lang-toggle:hover {
  background: rgba(241, 244, 248, .95);
}

.card {
  position: relative;
  z-index: 1;
  background: var(--l-card);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--l-card-bd);
  border-radius: 20px;
  padding: clamp(36px, 3.5vw, 56px);
  width: clamp(360px, 28vw, 440px);
  max-width: 92vw;
  box-shadow: 0 8px 32px var(--l-shadow);
}

.logo {
  text-align: center;
  margin-bottom: clamp(28px, 2.5vw, 40px);
}

.logo img {
  width: clamp(52px, 5vw, 64px);
  height: auto;
  display: block;
  margin: 0 auto 14px;
}

.logo h1 {
  font-size: clamp(1.6rem, 2vw, 2.1rem);
  font-weight: 700;
  letter-spacing: -.5px;
  color: var(--l-t1);
}

.logo h1 b {
  color: #7189f5;
  font-weight: inherit;
}

html[data-theme="light"] .logo h1 b {
  color: #4f46e5;
}

.input-wrap {
  position: relative;
  margin-bottom: clamp(18px, 1.5vw, 24px);
}

.input-wrap :deep(.ms.input-icon) {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 20px;
  color: var(--l-t3);
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
  pointer-events: none;
}

.input-wrap input {
  width: 100%;
  padding: clamp(11px, 1.2vw, 16px) 44px;
  background: var(--l-input-bg);
  color: var(--l-t1);
  border: 1px solid var(--l-input-bd);
  border-radius: 12px;
  font-size: clamp(.9rem, 1vw, 1.05rem);
  font-family: inherit;
  transition: border-color .2s, box-shadow .2s;
}

.input-wrap input:focus {
  border-color: #5470ea;
  outline: none;
  box-shadow: 0 0 0 3px rgba(84, 112, 234, .12);
}

.input-wrap .toggle-pw {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  color: var(--l-t3);
  opacity: .6;
  transition: opacity .15s;
}

.input-wrap .toggle-pw:hover {
  opacity: 1;
}

.toggle-pw :deep(.ms) {
  font-size: 20px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
}

.btn-login {
  width: 100%;
  padding: clamp(11px, 1.2vw, 16px);
  background: linear-gradient(135deg, #5470ea, #7189f5);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: clamp(.9rem, 1vw, 1.05rem);
  cursor: pointer;
  font-weight: 600;
  font-family: inherit;
  transition: opacity .15s, transform .1s;
  letter-spacing: .3px;
}

.btn-login:hover {
  opacity: .9;
}

.btn-login:active {
  transform: scale(.98);
}

.btn-login:disabled {
  cursor: wait;
  opacity: .7;
}

.err {
  color: #f87171;
  font-size: clamp(.8rem, .85vw, .92rem);
  text-align: center;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.err :deep(.ms) {
  font-size: 16px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 16;
}

.login-page input::-ms-reveal,
.login-page input::-ms-clear,
.login-page input::-webkit-credentials-auto-fill-button {
  display: none;
}

@media (max-width: 768px) {
  .top-controls {
    top: 12px;
    right: 12px;
  }
}
</style>
