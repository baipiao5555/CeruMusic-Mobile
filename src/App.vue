<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { IonApp } from '@ionic/vue'
import BottomNav from '@/components/BottomNav.vue'
import MiniPlayer from '@/components/MiniPlayer.vue'
import { pluginToasts, permissionRequest, answerPermission, initPlugins, pluginState, selectProvider, installDemoPlugin, navigationRequest, notify } from '@/core/plugin/manager'
import { handleAuthCallback, initAuth } from '@/core/auth'
import { initDownloads } from '@/core/downloads'
import { registerDownloadHostHooks } from '@/core/downloadHost'
import { checkForUpdate, updateState } from '@/core/updater'
import { initPlayer, registerPlayerHostHooks, restorePlayer, resume, pause, next, previous, seek, currentTrack } from '@/core/playback/player'
import { onMediaAction, stopBackgroundAudio } from '@/core/native/backgroundAudio'
import { applyNavigationBar, applySystemInsets, initSystemInsets } from '@/core/native/systemBars'
import { registerLibraryHostHooks, restoreLibrary } from '@/core/library'
import { applyTheme, registerSettingsHostHooks, restoreSettings, settingsState } from '@/core/settings'

const router = useRouter()
const route = useRoute()
const showNav = computed(() => route.path !== '/player')
const showMini = computed(() => Boolean(currentTrack()) && route.path !== '/player')
const nativePlatform = Capacitor.isNativePlatform()

async function syncStatusBar(): Promise<void> {
  if (!nativePlatform) return
  const dark =
    route.path === '/player' || document.documentElement.classList.contains('dark')
  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
  } catch {}
  await applyNavigationBar(dark)
  await applySystemInsets()
}

// Android 上闪屏还没隐藏时调用 setStyle 会被系统丢弃，需要在隐藏后重试。
function scheduleStatusBarSync(): void {
  if (!nativePlatform) return
  for (const delay of [0, 350, 900, 1800, 3000]) {
    window.setTimeout(() => void syncStatusBar(), delay)
  }
  void SplashScreen.hide()
    .catch(() => undefined)
    .finally(() => window.setTimeout(() => void syncStatusBar(), 300))
  void NativeApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void syncStatusBar()
  })
}

async function handleDeepLink(url: string): Promise<void> {
  if (!url.startsWith('cerumusic://oauth')) return
  try {
    const user = await handleAuthCallback(url)
    if (user) {
      notify('登录成功，正在读取云歌单')
      router.replace('/cloud')
    }
  } catch (error: any) {
    notify(error?.message ?? '登录失败', 'error')
  }
}

onMounted(async () => {
  restoreSettings()
  initSystemInsets()
  void initAuth()
  void initDownloads()
  if (nativePlatform) {
    void NativeApp.getLaunchUrl().then((launch) => {
      if (launch?.url) void handleDeepLink(launch.url)
    })
    void NativeApp.addListener('appUrlOpen', ({ url }) => void handleDeepLink(url))
  }
  scheduleStatusBarSync()
  restoreLibrary()
  initPlayer()
  registerPlayerHostHooks()
  registerLibraryHostHooks()
  registerSettingsHostHooks()
  registerDownloadHostHooks()
  restorePlayer()
  onMediaAction((action) => {
    if (action === 'play') void resume()
    else if (action === 'pause') pause()
    else if (action === 'next') void next()
    else if (action === 'previous') void previous()
    else if (action.startsWith('seek:')) seek(Number(action.slice(5)) / 1000)
    else if (action === 'stop') {
      pause()
      stopBackgroundAudio()
    }
  })
  await initPlugins()
  if (!pluginState.plugins.length) {
    try {
      await installDemoPlugin()
    } catch (error) {
      console.warn('安装内置示例插件失败:', error)
    }
  }
  if (pluginState.selectedProvider) selectProvider(pluginState.selectedProvider)
  if (updateState.autoCheck) void checkForUpdate({ silent: false })
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (settingsState.theme === 'system') {
      applyTheme()
      void syncStatusBar()
    }
  })
})

watch(
  () => settingsState.theme,
  () => {
    applyTheme()
    void syncStatusBar()
  }
)

watch(
  () => route.path,
  () => void syncStatusBar()
)

watch(navigationRequest, (request) => {
  if (!request) return
  navigationRequest.value = null
  if (request.type === 'navigate') {
    const page = request.request?.page
    if (page === 'search') router.push({ path: '/search', query: { q: request.request?.query ?? '' } })
    else if (page === 'settings') router.push('/settings')
  }
})
</script>

<template>
  <ion-app>
    <div class="app-shell" :class="{ 'has-mini': showMini }">
    <div class="app-bg" />
    <div class="status-scrim" />
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
    <MiniPlayer />
    <BottomNav v-if="showNav" />

    <div class="toast-stack">
      <div
        v-for="toast in pluginToasts"
        :key="toast.id"
        class="toast"
        :class="toast.level"
      >
        {{ toast.message }}
      </div>
    </div>

    <div v-if="permissionRequest" class="sheet-mask" @click.self="answerPermission(false)">
      <div class="sheet">
        <h2>权限请求</h2>
        <p class="sub">
          {{ permissionRequest.pluginName }} 请求「{{ permissionRequest.name }}」权限。
          {{ permissionRequest.reason }}
        </p>
        <div class="sheet-actions">
          <button class="btn secondary" @click="answerPermission(false)">拒绝</button>
          <button class="btn" @click="answerPermission(true)">允许</button>
        </div>
      </div>
    </div>
    </div>
  </ion-app>
</template>
