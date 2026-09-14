<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import BackgroundRunBar from '@/components/layout/BackgroundRunBar.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import ConfirmProvider from '@/components/ui/ConfirmProvider.vue'
import TunnelSwitchOverlay from '@/components/ui/TunnelSwitchOverlay.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { provideToast } from '@/composables/useToast'
import { useExecNotifications } from '@/composables/useExecNotifications'
import { useTheme } from '@/composables/useTheme'
import { useAppStore } from '@/stores/app'
import { useBackgroundRunStore } from '@/stores/backgroundRun'

defineOptions({ name: 'App' })

provideToast()
useTheme() // initialize theme on app level
// 执行终态通知器: App 级常驻, 全站唯一的完成/中断/出错提示出口 (与页面无关)
useExecNotifications()

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
    <RouterView v-slot="{ Component, route }">
      <Transition name="page-fade" mode="out-in">
        <KeepAlive include="GeneratePage">
          <component :is="Component" :key="route.name || route.path" />
        </KeepAlive>
      </Transition>
    </RouterView>
  </main>

  <ToastContainer />
  <BackgroundRunBar />
  <TunnelSwitchOverlay />
  </ConfirmProvider>
</template>
