import './shims/buffer'
import './styles/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import * as pluginManager from './core/plugin/manager'
import * as playback from './core/playback/player'

if (import.meta.env.DEV) {
  ;(window as any).__ceruDebug = {
    ...pluginManager,
    player: playback
  }
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
