import { createApp } from 'vue'
import { createPinia } from 'pinia'
import WizardApp from './components/wizard/WizardApp.vue'
import i18n from './i18n/vue-i18n'

// Global styles
import './css/base.css'
import './css/forms.css'

const app = createApp(WizardApp)

app.use(createPinia())
app.use(i18n)

app.mount('#app')
