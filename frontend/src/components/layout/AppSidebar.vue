<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { switchLanguage } from '@/i18n/vue-i18n'
import { computed } from 'vue'
import MsIcon from '../ui/MsIcon.vue'
// 主题切换是全局偏好, 与页面无关 —— 从每页的 PageHeader 移到这里,
// 和同为全局偏好的语言切换放在一起
import ThemeToggle from '../ui/ThemeToggle.vue'

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
  { page: 'generate',  icon: 'palette',      labelKey: 'nav.generate' },
  { page: 'models',    icon: 'extension',    labelKey: 'nav.models' },
  { page: 'comfyui',   icon: 'terminal',     label: 'ComfyUI' },
  { page: 'sync',      icon: 'cloud_sync',   labelKey: 'nav.sync' },
  { page: 'tunnel',    icon: 'language',     labelKey: 'nav.tunnel' },
  { page: 'jupyter',   icon: 'book_2',       label: 'Jupyter' },
  { page: 'ssh',       icon: 'key',          label: 'SSH' },
]

const settingsItem: NavItem = {
  page: 'settings', icon: 'settings', labelKey: 'nav.settings',
}

const currentPage = computed(() => route.name as string)

// 激活态匹配: 'generate' 入口需兼容子路径 (/generate/image, /generate/video 等);
// 其余按 route.name 精确匹配
function isNavActive(item: NavItem): boolean {
  if (item.page === 'generate') return route.path.startsWith('/generate')
  return currentPage.value === item.page
}

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
      <img src="/logo-mark.svg" alt="ComfyCarry" class="logo-icon" width="28" height="28" />
      <span class="logo-text" aria-hidden="true">Comfy<span class="logo-text__b">Carry</span></span>
    </div>

    <div class="sidebar-nav">
      <button
        v-for="item in navItems"
        :key="item.page"
        class="nav-item"
        :class="{ active: isNavActive(item) }"
        @click="navTo(item)"
      >
        <span class="icon"><MsIcon :name="item.icon" size="md" /></span>
        <span class="nav-label">{{ getLabel(item) }}</span>
      </button>

      <div style="flex: 1" />

      <button
        class="nav-item"
        :class="{ active: isNavActive(settingsItem) }"
        @click="navTo(settingsItem)"
      >
        <span class="icon"><MsIcon :name="settingsItem.icon" size="md" /></span>
        <span class="nav-label">{{ getLabel(settingsItem) }}</span>
      </button>
    </div>

    <div class="sidebar-footer">
      <div class="footer-expanded">
        <div class="footer-tools">
          <button
            class="tool-btn"
            :title="locale === 'zh-CN' ? t('common.lang.switch_en') : t('common.lang.switch_zh')"
            @click="toggleLang()"
          >{{ locale === 'zh-CN' ? 'EN' : '中' }}</button>
          <ThemeToggle class="tool-btn" />
          <a class="tool-btn" href="/logout" :title="t('common.btn.logout')">
            <MsIcon name="logout" />
          </a>
          <a
            class="ver"
            :href="commitUrl"
            target="_blank"
            :title="shortCommit ? `${app.branch}@${shortCommit} ${app.version || ''}`.trim() : ''"
          >{{ app.version || shortCommit }}</a>
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
        <div class="footer-theme-collapsed"><ThemeToggle /></div>
        <a href="/logout" :title="t('common.btn.logout')" style="color:var(--t3);font-size:.9rem">
          <MsIcon name="logout" />
        </a>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.footer-theme-collapsed {
  display: flex;
  justify-content: center;
  margin-bottom: 6px;
}
</style>
