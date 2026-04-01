import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Global application state — theme, sidebar, version.
 */
export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(localStorage.getItem('sidebar_collapsed') === '1')
  const mobileSidebarOpen = ref(false)
  const version = ref('')
  const branch = ref('')
  const commit = ref('')

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
        version.value = data.version || ''
        branch.value = data.branch || ''
        commit.value = data.commit || ''
      }
    } catch { /* ignore */ }
  }

  return {
    sidebarCollapsed,
    mobileSidebarOpen,
    version,
    branch,
    commit,
    toggleSidebar,
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,
    loadVersion,
  }
})
