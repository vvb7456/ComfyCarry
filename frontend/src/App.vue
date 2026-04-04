<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import ConfirmProvider from '@/components/ui/ConfirmProvider.vue'
import { provideToast } from '@/composables/useToast'
import { useTheme } from '@/composables/useTheme'
import { useAppStore } from '@/stores/app'

defineOptions({ name: 'App' })

provideToast()
useTheme() // initialize theme on app level

const app = useAppStore()

onMounted(() => {
  app.loadVersion()
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
  </ConfirmProvider>
</template>
