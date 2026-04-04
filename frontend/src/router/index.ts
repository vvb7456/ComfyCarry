import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/pages/DashboardPage.vue'),
    },
    {
      path: '/comfyui',
      name: 'comfyui',
      component: () => import('@/pages/ComfyUIPage.vue'),
    },
    {
      path: '/generate',
      name: 'generate',
      component: () => import('@/pages/GeneratePage.vue'),
    },
    {
      path: '/models',
      name: 'models',
      component: () => import('@/pages/ModelsPage.vue'),
    },
    {
      path: '/tunnel',
      name: 'tunnel',
      component: () => import('@/pages/TunnelPage.vue'),
    },
    {
      path: '/jupyter',
      name: 'jupyter',
      component: () => import('@/pages/JupyterPage.vue'),
    },
    {
      path: '/sync',
      name: 'sync',
      component: () => import('@/pages/SyncPage.vue'),
    },
    {
      path: '/ssh',
      name: 'ssh',
      component: () => import('@/pages/SSHPage.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/SettingsPage.vue'),
    },
  ],
})

export default router
