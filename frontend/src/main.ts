import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { preloadRoutes } from './router/preload'
import i18n from './i18n/vue-i18n'

import './css/base.css'
import './css/layout.css'
import './css/dashboard.css'
import './css/forms.css'
import './css/settings.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')

void router.isReady().then(() => {
  // 首屏先完成渲染，再预加载页面模块；组件实例与数据请求仍按导航创建。
  requestAnimationFrame(() => {
    setTimeout(() => { void preloadRoutes(router) }, 0)
  })
})
