import './shims/buffer'
import '@ionic/vue/css/core.css'
import '@ionic/vue/css/normalize.css'
import '@ionic/vue/css/structure.css'
import '@ionic/vue/css/typography.css'
import '@ionic/vue/css/padding.css'
import '@ionic/vue/css/flex-utils.css'
import '@ionic/vue/css/display.css'
import './styles/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'
import App from './App.vue'
import router from './router'
import * as pluginManager from './core/plugin/manager'
import * as playback from './core/playback/player'
import * as auth from './core/auth'
import * as downloads from './core/downloads'
import * as cloud from './core/cloud'
import * as updater from './core/updater'
import * as lyrics from './core/lyrics/cloud'
import { installLogCapture } from './core/logs'

installLogCapture()

if (import.meta.env.DEV) {
  ;(window as any).__ceruDebug = {
    ...pluginManager,
    player: playback,
    auth,
    downloads,
    cloud,
    updater,
    lyrics
  }
}

const app = createApp(App)
app.use(createPinia())
app.use(IonicVue, { mode: 'md' })
app.use(router)
app.mount('#app')
