<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import BackgroundRunBar from '@/components/layout/BackgroundRunBar.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import ConfirmProvider from '@/components/ui/ConfirmProvider.vue'
import { provideToast } from '@/composables/useToast'
import { useTheme } from '@/composables/useTheme'
import { useAppStore } from '@/stores/app'
import { useBackgroundRunStore } from '@/stores/backgroundRun'

defineOptions({ name: 'App' })

provideToast()
useTheme() // initialize theme on app level

const app = useAppStore()
const backgroundRun = useBackgroundRunStore()

onMounted(() => {
  app.loadVersion()
  backgroundRun.refresh()
})

onUnmounted(() => {
  backgroundRun.dispose()
})

function onOverlayClick() {
  app.closeMobileSidebar()
}
</script>

<template>
  <ConfirmProvider>
  <div
    class="mobile-overlay"
    :class="{ active: app.mobileSidebarOpen }"
    @click="onOverlayClick"
  />

  <AppSidebar />

  <main class="content" :class="{ 'sidebar-collapsed': app.sidebarCollapsed }">
    <RouterView v-slot="{ Component }">
      <KeepAlive include="GeneratePage">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
  </main>

  <ToastContainer />
  <BackgroundRunBar />
  </ConfirmProvider>
</template>
