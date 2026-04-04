<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { switchLanguage } from '@/i18n/vue-i18n'
import { computed } from 'vue'
import MsIcon from '../ui/MsIcon.vue'
import BaseButton from '../ui/BaseButton.vue'

defineOptions({ name: 'AppSidebar' })

const { t, locale } = useI18n({ useScope: 'global' })
const router = useRouter()
const route = useRoute()
const app = useAppStore()

const shortCommit = computed(() => (app.commit || '').substring(0, 7))
const commitUrl = computed(() =>
  shortCommit.value
    ? `https://github.com/vvb7456/ComfyCarry/commit/${app.commit}`
    : 'https://github.com/vvb7456/ComfyCarry'
)

interface NavItem {
  page: string
  icon: string
  labelKey?: string
  label?: string
}

const navItems: NavItem[] = [
  { page: 'dashboard', icon: 'dashboard',    labelKey: 'nav.dashboard' },
  { page: 'comfyui',   icon: 'terminal',     label: 'ComfyUI' },
  { page: 'generate',  icon: 'palette',      labelKey: 'nav.generate' },
  { page: 'models',    icon: 'extension',    labelKey: 'nav.models' },
  { page: 'tunnel',    icon: 'language',     labelKey: 'nav.tunnel' },
  { page: 'jupyter',   icon: 'book_2',       label: 'Jupyter' },
  { page: 'sync',      icon: 'cloud_sync',   labelKey: 'nav.sync' },
  { page: 'ssh',       icon: 'key',          label: 'SSH' },
]

const settingsItem: NavItem = {
  page: 'settings', icon: 'settings', labelKey: 'nav.settings',
}

const currentPage = computed(() => route.name as string)

function navTo(item: NavItem) {
  router.push({ name: item.page })
  if (window.innerWidth <= 768) {
    app.closeMobileSidebar()
  }
}

function getLabel(item: NavItem) {
  return item.labelKey ? t(item.labelKey) : (item.label ?? '')
}

function setLang(lng: string) {
  switchLanguage(lng)
}

function toggleLang() {
  switchLanguage(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}
</script>

<template>
  <nav class="sidebar" :class="{ collapsed: app.sidebarCollapsed, 'mobile-open': app.mobileSidebarOpen }">
    <button
      class="sidebar-toggle"
      :title="t('common.sidebar.toggle')"
      @click="app.toggleSidebar()"
    >◀</button>

    <div class="sidebar-logo">
      <img src="/logo.png" alt="ComfyCarry" class="logo-icon" width="36" height="36" />
      <span class="logo-text">ComfyCarry</span>
    </div>

    <div class="sidebar-nav">
      <button
        v-for="item in navItems"
        :key="item.page"
        class="nav-item"
        :class="{ active: currentPage === item.page }"
        @click="navTo(item)"
      >
        <span class="icon"><MsIcon :name="item.icon" size="md" /></span>
        <span class="nav-label">{{ getLabel(item) }}</span>
      </button>

      <div style="flex: 1" />

      <button
        class="nav-item"
        :class="{ active: currentPage === 'settings' }"
        @click="navTo(settingsItem)"
      >
        <span class="icon"><MsIcon :name="settingsItem.icon" size="md" /></span>
        <span class="nav-label">{{ getLabel(settingsItem) }}</span>
      </button>
    </div>

    <div class="sidebar-footer">
      <div class="footer-expanded">
        <div class="footer-logout-row">
          <button
            class="lang-toggle"
            :title="locale === 'zh-CN' ? t('common.lang.switch_en') : t('common.lang.switch_zh')"
            @click="toggleLang()"
          >{{ locale === 'zh-CN' ? 'EN' : '中' }}</button>
          <BaseButton href="/logout" size="sm" style="font-size:.72rem;flex:1;text-align:center;justify-content:center">
            <MsIcon name="logout" />
            {{ t('common.btn.logout') }}
          </BaseButton>
        </div>
        <div style="text-align:center">
          <a :href="commitUrl" target="_blank" style="font-size:.68rem;color:var(--t3);text-decoration:none;font-family:'IBM Plex Mono',monospace" :title="shortCommit ? `${app.branch}@${shortCommit}` : ''">
            <template v-if="shortCommit">
              <span style="background:rgba(124,92,252,.15);padding:1px 5px;border-radius:3px;color:var(--ac)">{{ app.branch || 'main' }}</span>
              <span style="margin-left:3px">{{ shortCommit }}</span>
              <span style="margin-left:3px;color:var(--t3)">{{ app.version || 'v2.5' }}</span>
            </template>
            <template v-else>{{ app.version || 'v2.5' }}</template>
          </a>
        </div>
      </div>
      <div class="footer-collapsed">
        <div class="lang-switcher-collapsed">
          <button
            class="lang-btn-mini"
            :class="{ active: locale === 'zh-CN' }"
            :title="t('common.lang.switch_zh')"
            @click="setLang('zh-CN')"
          >中</button>
          <button
            class="lang-btn-mini"
            :class="{ active: locale === 'en' }"
            :title="t('common.lang.switch_en')"
            @click="setLang('en')"
          >EN</button>
        </div>
        <a href="/logout" :title="t('common.btn.logout')" style="color:var(--t3);font-size:.9rem">
          <MsIcon name="logout" />
        </a>
      </div>
    </div>
  </nav>
</template>
