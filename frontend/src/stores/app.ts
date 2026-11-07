import { defineStore } from 'pinia'
import { ref } from 'vue'

interface BootstrapEnv {
  version?: string
  branch?: string
  commit?: string
  managed?: boolean
  gpu_name?: string
}

function readBootstrapEnv(): BootstrapEnv {
  if (typeof window === 'undefined') return {}
  const raw = (window as Window & { __CC_ENV__?: BootstrapEnv }).__CC_ENV__
  return raw && typeof raw === 'object' ? raw : {}
}

export const useAppStore = defineStore('app', () => {
  const boot = readBootstrapEnv()
  const sidebarCollapsed = ref(localStorage.getItem('sidebar_collapsed') === '1')
  const mobileSidebarOpen = ref(false)
  const version = ref(boot.version || '')
  const branch = ref(boot.branch || '')
  const commit = ref(boot.commit || '')
  // 实例级环境属性: 优先从 HTML 同步注入读取, 未注入时为 null (未就绪态)
  const managed = ref<boolean | null>(typeof boot.managed === 'boolean' ? boot.managed : null)
  const gpuName = ref(boot.gpu_name || '')

  function setRuntimeEnv(info: { managed?: boolean; gpu_name?: string }) {
    if (typeof info.managed === 'boolean') {
      managed.value = info.managed
    }
    if (typeof info.gpu_name === 'string' && info.gpu_name) {
      gpuName.value = info.gpu_name
    }
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
    localStorage.setItem('sidebar_collapsed', sidebarCollapsed.value ? '1' : '0')
  }

  function openMobileSidebar() {
    mobileSidebarOpen.value = true
  }

  function closeMobileSidebar() {
    mobileSidebarOpen.value = false
  }

  function toggleMobileSidebar() {
    mobileSidebarOpen.value = !mobileSidebarOpen.value
  }

  async function loadVersion() {
    try {
      const res = await fetch('/api/version')
      if (res.ok) {
        const data = await res.json()
        version.value = data.version || version.value
        branch.value = data.branch || branch.value
        commit.value = data.commit || commit.value
        setRuntimeEnv(data)
      }
    } catch { /* ignore */ }
  }

  return {
    sidebarCollapsed,
    mobileSidebarOpen,
    version,
    branch,
    commit,
    managed,
    gpuName,
    setRuntimeEnv,
    toggleSidebar,
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,
    loadVersion,
  }
})
