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
      // 任务维度子路由骨架 (本期只搭壳): /generate → /generate/image
      // 未来 /generate/video, /generate/edit 落地后, GeneratePage 拆为 shell + 子任务页
      path: '/generate',
      redirect: '/generate/image',
    },
    {
      path: '/generate/image',
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
      children: [
        { path: '', redirect: { name: 'settings-comfycarry' } },
        { path: 'comfycarry', name: 'settings-comfycarry', component: () => import('@/pages/settings/SettingsTabComfyCarry.vue') },
        { path: 'prompt', name: 'settings-prompt', component: () => import('@/pages/settings/SettingsTabPrompt.vue') },
        { path: 'civitai', name: 'settings-civitai', component: () => import('@/pages/settings/SettingsTabCivitai.vue') },
        { path: 'llm', name: 'settings-llm', component: () => import('@/pages/settings/SettingsTabLlm.vue') },
        { path: 'sync', name: 'settings-sync', component: () => import('@/pages/settings/SettingsTabSync.vue') },
        { path: 'tunnel', name: 'settings-tunnel', component: () => import('@/pages/settings/SettingsTabTunnel.vue') },
      ],
    },
  ],
})

export default router
