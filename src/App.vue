<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { IonApp } from '@ionic/vue'
import BottomNav from '@/components/BottomNav.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import MiniPlayer from '@/components/MiniPlayer.vue'
import ThemeBackground from '@/components/ThemeBackground.vue'
import PluginAccountSurface from '@/components/PluginAccountSurface.vue'
import Discover from '@/views/Discover.vue'
import Search from '@/views/Search.vue'
import Playlists from '@/views/Playlists.vue'
import Library from '@/views/Library.vue'
import Browse from '@/views/Browse.vue'
import { getPluginAccountSurface, invalidatePluginAccountCache } from '@/core/plugin/manager'
import type { AccountSurfaceSpec } from '@/core/plugin/accountSurface'
import { backgroundAppliesToRoute, themeBackgroundScene, themeBackgroundState } from '@/core/themeBackground'
import { pluginToasts, permissionRequest, answerPermission, initPlugins, pluginState, selectProvider, installDemoPlugin, checkAllPluginUpdates, navigationRequest, notify } from '@/core/plugin/manager'
import { handleAuthCallback, initAuth } from '@/core/auth'
import { initDownloads } from '@/core/downloads'
import { registerDownloadHostHooks } from '@/core/downloadHost'
import { canAutoPromptUpdate, checkForUpdate, markAutoUpdatePromptShown, updateState } from '@/core/updater'
import { initPlayer, registerPlayerHostHooks, restorePlayer, currentTrack, resume, pause, next, previous, seek, refreshBackgroundLyrics, applyPlaybackRate, savePlaybackState } from '@/core/playback/player'
import { onMediaAction, stopBackgroundAudio } from '@/core/native/backgroundAudio'
import { runBackGuard } from '@/core/native/backGuard'
import { resolveBackAction } from '@/core/navigation/backNav'
import {
  applyNavigationBar,
  applySystemInsets,
  getNativeTheme,
  initSystemInsets,
  onNativeThemeChange
} from '@/core/native/systemBars'
import { registerLibraryHostHooks, restoreLibrary } from '@/core/library'
import {
  applyTheme,
  registerSettingsHostHooks,
  restoreSettings,
  setNativeDarkOverride,
  settingsState
} from '@/core/settings'
import { logEvent } from '@/core/logs'
import { cancelSearchEntryFocus, completeSearchEntryTransition } from '@/core/searchEntry'
import { installSheetFocusRestore } from '@/core/ui/sheetFocus'
import {
  cancelPlayerMorph,
  isCollapseMorphPending
} from '@/core/ui/playerMorph'
import { routeDirection } from '@/router/transition'

const router = useRouter()
const accountSurface = ref<AccountSurfaceSpec>()
function closeAccountSurface(): void { if (accountSurface.value) invalidatePluginAccountCache(accountSurface.value.pluginId); accountSurface.value = undefined }
const route = useRoute()
const backgroundScene = computed(() => route.path === '/player' ? themeBackgroundScene.value : 'main')
const customBackgroundActive = computed(() => Boolean(themeBackgroundState.url) && backgroundAppliesToRoute(route.path, backgroundScene.value))
const backgroundForeground = ref(document.visibilityState !== 'hidden')
const showNav = computed(() => route.path !== '/player' && !route.meta.hideBottomNav)
const hasTrack = computed(() => Boolean(currentTrack()))
const pageMotion = ref('')
let pageMotionTimer: ReturnType<typeof setTimeout> | undefined
let pageMotionSeq = 0
const showDock = computed(() => route.path !== '/player' && (showNav.value || hasTrack.value))
const dockStyle = computed(() => ({
  '--dock-h': showDock.value
    ? `calc(${showNav.value ? 'var(--tab-h) + ' : ''}${hasTrack.value ? 'var(--mini-h) + ' : ''}var(--safe-bottom) + var(--dock-gap, 0px) + 1px)`
    : '0px'
}))
/** 高频主页面常驻挂载，切换时只切显示状态，避免首次进入时重新挂载造成掉帧。 */
const PERSISTENT_PATHS = ['/', '/search', '/playlists', '/library', '/browse']
const isPersistentRoute = computed(() => PERSISTENT_PATHS.includes(route.path))
const warmedPages = ref<Record<string, boolean>>({})
function pageMounted(path: string): boolean {
  return route.path === path || warmedPages.value[path] === true
}
function warmPage(path: string): void {
  if (warmedPages.value[path]) return
  warmedPages.value = { ...warmedPages.value, [path]: true }
}
/**
 * 先把当前页显示出来，再利用空闲时间逐个挂载其余主页面。
 * 页面只在空闲时排版一次，之后切换 Tab 只改 visibility，不再临时排版整页。
 */
function scheduleTabWarm(): void {
  const queue = PERSISTENT_PATHS.filter((path) => path !== route.path)
  if (!queue.length) return
  const step = (): void => {
    const next = queue.shift()
    if (!next) return
    warmPage(next)
    if (!queue.length) return
    const later = (): void => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(step, { timeout: 2000 })
      } else {
        setTimeout(step, 200)
      }
    }
    setTimeout(later, 160)
  }
  const start = (): void => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(step, { timeout: 2000 })
    } else {
      setTimeout(step, 200)
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(start))
}
if (PERSISTENT_PATHS.includes(route.path)) warmPage(route.path)
const nativePlatform = Capacitor.isNativePlatform()
let appActive = true
let appDisposed = false
let autoUpdateRunning = false
let autoUpdateAwaitingDisplay = false
let disposeSheetFocus: (() => void) | undefined

function isAppForeground(): boolean {
  return !appDisposed && appActive && document.visibilityState !== 'hidden'
}

async function promptAvailableUpdate(): Promise<void> {
  if (!isAppForeground()) return
  if (autoUpdateAwaitingDisplay) {
    autoUpdateAwaitingDisplay = false
    if (route.path === '/update') {
      markAutoUpdatePromptShown()
      return
    }
  }
  if (autoUpdateRunning || !updateState.autoCheck) return
  autoUpdateRunning = true
  try {
    await router.isReady()
    await checkForUpdate({ silent: true })
    if (!isAppForeground() || !canAutoPromptUpdate() || route.path === '/update') return
    const failure = await router.push('/update')
    if (!failure && route.path === '/update' && !appDisposed) {
      // 懒加载/导航等待时可能退到后台；真正回前台展示后再记当天次数。
      autoUpdateAwaitingDisplay = !isAppForeground()
      if (!autoUpdateAwaitingDisplay) markAutoUpdatePromptShown()
    }
  } catch (error) {
    logEvent('warn', 'UPDATE', '自动更新提示未打开', String(error))
  } finally {
    autoUpdateRunning = false
  }
}

function onAppVisibilityChange(): void {
  backgroundForeground.value = appActive && document.visibilityState !== 'hidden'
  if (document.visibilityState === 'visible') void promptAvailableUpdate()
}

function openToastAction(toast: { id: number; actionTo?: string }): void {
  pluginToasts.value = pluginToasts.value.filter((item) => item.id !== toast.id)
  if (toast.actionTo) void router.push(toast.actionTo)
}

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
    appActive = isActive
    backgroundForeground.value = isActive && document.visibilityState !== 'hidden'
    if (isActive) {
      void syncStatusBar()
      void promptAvailableUpdate()
    } else {
      savePlaybackState()
    }
  })
}

function initNativeTheme(): void {
  if (!nativePlatform) return
  void getNativeTheme().then((dark) => {
    if (dark === null) return
    setNativeDarkOverride(dark)
    if (settingsState.theme === 'system') {
      applyTheme()
      void syncStatusBar()
    }
  })
  onNativeThemeChange((dark) => {
    setNativeDarkOverride(dark)
    if (settingsState.theme === 'system') {
      applyTheme()
      void syncStatusBar()
    }
  })
}

const ROOT_PATHS = ['/', '/playlists', '/library']
const EXIT_ANIMATION_MS = 260
/** 连按两次退出的时间窗。 */
const EXIT_CONFIRM_MS = 2200
let lastExitPress = 0
let tabSwipe: { x: number; y: number; time: number; path: string } | null = null
let appExiting = false
let touchClickSequence = 0
let touchClickStartedAt = 0
let touchClickTarget: Element | null = null
let handledTouchClickSequence = -1
let handledTouchClickTarget: Element | null = null

function clickableElement(target: EventTarget | null): Element | null {
  return target instanceof Element
    ? target.closest('button, a[href], [role="button"], [role="checkbox"]')
    : null
}

function onTouchClickStart(event: TouchEvent): void {
  if (event.touches.length !== 1) {
    touchClickTarget = null
    return
  }
  touchClickSequence += 1
  touchClickStartedAt = performance.now()
  touchClickTarget = clickableElement(event.target)
}

/** Some WebViews emit two click events for one tap; a real second tap has a new touch sequence. */
function onDuplicateTouchClick(event: MouseEvent): void {
  if (event.detail === 0 || !touchClickTarget || performance.now() - touchClickStartedAt > 800) return
  const target = clickableElement(event.target)
  if (target !== touchClickTarget) return
  if (handledTouchClickSequence === touchClickSequence && handledTouchClickTarget === target) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  handledTouchClickSequence = touchClickSequence
  handledTouchClickTarget = target
}

function onTabTouchStart(event: TouchEvent): void {
  if (!settingsState.swipeTabs || event.touches.length !== 1) return
  if (!ROOT_PATHS.includes(route.path)) return
  if (document.querySelector('.sheet-mask')) return
  const target = event.target as HTMLElement
  if (
    target.closest(
      'input, textarea, button, .chips, .song-list, .playlist-list, .task-list, .mini, .tabbar, .cover-strip, .media-strip'
    )
  ) {
    return
  }
  tabSwipe = {
    x: event.touches[0].clientX,
    y: event.touches[0].clientY,
    time: Date.now(),
    path: route.path
  }
}

function onTabTouchEnd(event: TouchEvent): void {
  if (!tabSwipe) return
  const start = tabSwipe
  tabSwipe = null
  if (!settingsState.swipeTabs || event.changedTouches.length !== 1) return
  if (route.path !== start.path || Date.now() - start.time > 900) return
  const dx = event.changedTouches[0].clientX - start.x
  const dy = event.changedTouches[0].clientY - start.y
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.4) return
  const index = ROOT_PATHS.indexOf(start.path)
  if (index < 0) return
  const nextIndex = dx < 0 ? index + 1 : index - 1
  if (nextIndex < 0 || nextIndex >= ROOT_PATHS.length) return
  router.push(ROOT_PATHS[nextIndex])
}

/** Android back gesture/button: close sheets, walk up the tab chain, exit only from 发现. */
function handleBackNavigation(): void {
  const masks = document.querySelectorAll<HTMLElement>('.sheet-mask')
  const mask = masks[masks.length - 1]
  if (mask) {
    mask.click()
    return
  }
  if (runBackGuard()) return
  const hasHistoryBack = Boolean(window.history.state && window.history.state.back != null)
  const action = resolveBackAction(route.path, hasHistoryBack)
  if (action.type === 'parent') {
    void router.replace(action.path)
    return
  }
  if (action.type === 'history') {
    router.back()
    return
  }
  if (action.type === 'home') {
    void router.replace('/')
    return
  }
  if (appExiting) return
  const now = Date.now()
  if (now - lastExitPress > EXIT_CONFIRM_MS) {
    lastExitPress = now
    notify('再按一次退出应用')
    return
  }
  lastExitPress = 0
  appExiting = true
  const shell = document.querySelector('.app-shell') as HTMLElement | null
  if (shell) {
    shell.classList.add('app-exiting')
    window.setTimeout(() => {
      savePlaybackState()
      void NativeApp.exitApp()
    }, EXIT_ANIMATION_MS)
  } else {
    savePlaybackState()
    void NativeApp.exitApp()
  }
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
  logEvent('info', 'APP', '应用启动', `${__APP_VERSION__} · ${Capacitor.getPlatform()}`)
  disposeSheetFocus = installSheetFocusRestore()
  restoreSettings()
  initSystemInsets()
  initNativeTheme()
  window.addEventListener('touchstart', onTouchClickStart, { passive: true, capture: true })
  document.addEventListener('click', onDuplicateTouchClick, true)
  window.addEventListener('touchstart', onTabTouchStart, { passive: true })
  window.addEventListener('touchend', onTabTouchEnd, { passive: true })
  document.addEventListener('visibilitychange', onAppVisibilityChange)
  void initAuth()
  void initDownloads()
  if (nativePlatform) {
    void NativeApp.getLaunchUrl().then((launch) => {
      if (launch?.url) void handleDeepLink(launch.url)
    })
    void NativeApp.addListener('appUrlOpen', ({ url }) => void handleDeepLink(url))
    void NativeApp.addListener('backButton', () => handleBackNavigation())
  }
  scheduleStatusBarSync()
  scheduleTabWarm()
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
  // 不等音源插件加载，启动更新与播放器/插件初始化互不阻塞。
  void promptAvailableUpdate()
  await initPlugins()
  if (!pluginState.plugins.length) {
    try {
      await installDemoPlugin()
    } catch (error) {
      console.warn('安装内置示例插件失败:', error)
    } finally {
      pluginState.loading = false
    }
  } else {
    pluginState.loading = false
  }
  if (pluginState.selectedProvider) selectProvider(pluginState.selectedProvider)
  // 带更新地址的音源插件：启动后静默安装安全更新（6 小时内不重复）。
  if (settingsState.pluginAutoUpdate) void checkAllPluginUpdates()
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
  () => [settingsState.systemLyrics, settingsState.systemLyricsTranslation],
  () => refreshBackgroundLyrics()
)

watch(
  () => settingsState.playbackRate,
  () => applyPlaybackRate()
)

/**
 * 页面切换只给新页面做一次很短的 transform 入场，旧页面直接隐藏。
 * 不再让两张全屏页面同时做 opacity 合成，避免中低端安卓 WebView 掉帧。
 */
async function playRouteMotion(): Promise<void> {
  const seq = ++pageMotionSeq
  if (pageMotionTimer) clearTimeout(pageMotionTimer)
  if (route.path === '/player') {
    pageMotion.value = ''
    return
  }
  const kind =
    route.path === '/search'
      ? 'search'
      : routeDirection.value === 'tab'
        ? 'tab'
        : routeDirection.value === 'back'
          ? 'back'
          : 'forward'
  await nextTick()
  if (seq !== pageMotionSeq) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    pageMotion.value = ''
    if (route.path === '/search') completeSearchEntryTransition()
    return
  }
  pageMotion.value = `route-motion-${kind}`
  pageMotionTimer = setTimeout(() => {
    if (seq !== pageMotionSeq) return
    pageMotion.value = ''
    if (route.path === '/search') completeSearchEntryTransition()
  }, 190)
}

watch(
  () => route.path,
  (path) => {
    if (PERSISTENT_PATHS.includes(path)) warmPage(path)
    if (path !== '/search') cancelSearchEntryFocus()
    if (path !== '/player' && !isCollapseMorphPending()) cancelPlayerMorph()
    void syncStatusBar()
    void playRouteMotion()
  }
)

onUnmounted(() => {
  appDisposed = true
  pageMotionSeq += 1
  if (pageMotionTimer) clearTimeout(pageMotionTimer)
  pageMotionTimer = undefined
  disposeSheetFocus?.()
  disposeSheetFocus = undefined
  document.removeEventListener('visibilitychange', onAppVisibilityChange)
  window.removeEventListener('touchstart', onTouchClickStart, true)
  document.removeEventListener('click', onDuplicateTouchClick, true)
  window.removeEventListener('touchstart', onTabTouchStart)
  window.removeEventListener('touchend', onTabTouchEnd)
})

watch(navigationRequest, (request) => {
  if (!request) return
  navigationRequest.value = null
  if (request.type === 'navigate') {
    const page = request.request?.page
    if (page === 'search') router.push({ path: '/search', query: { q: request.request?.query ?? '' } })
    else if (page === 'settings') router.push('/settings')
    else if (page === 'account') router.push('/cloud')
  } else if (request.type === 'open-view') {
    const owner = pluginState.plugins.find(p => p.pluginId === request.pluginId && p.enabled && p.running)
    const item = owner?.accountItems.find(a => a.view === request.surfaceId)
    if (owner && item) {
      try { accountSurface.value = getPluginAccountSurface(owner.pluginId, item.id) }
      catch { notify('音源账号界面无法打开', 'error') }
    }
  }
})
</script>

<template>
  <ion-app>
    <div class="app-shell" :class="{ 'custom-theme-active': customBackgroundActive }" :style="dockStyle">
    <ThemeBackground :page-path="route.path" :scene="backgroundScene" :foreground="backgroundForeground" />
    <Discover
      v-if="pageMounted('/')"
      :class="[route.path === '/' ? pageMotion : '', { 'tab-screen-hidden': route.path !== '/' }]"
      :aria-hidden="route.path !== '/'"
    />
    <Search
      v-if="pageMounted('/search')"
      :class="[route.path === '/search' ? pageMotion : '', { 'tab-screen-hidden': route.path !== '/search' }]"
      :aria-hidden="route.path !== '/search'"
    />
    <Playlists
      v-if="pageMounted('/playlists')"
      :class="[route.path === '/playlists' ? pageMotion : '', { 'tab-screen-hidden': route.path !== '/playlists' }]"
      :aria-hidden="route.path !== '/playlists'"
    />
    <Library
      v-if="pageMounted('/library')"
      :class="[route.path === '/library' ? pageMotion : '', { 'tab-screen-hidden': route.path !== '/library' }]"
      :aria-hidden="route.path !== '/library'"
    />
    <Browse
      v-if="pageMounted('/browse')"
      :class="[route.path === '/browse' ? pageMotion : '', { 'tab-screen-hidden': route.path !== '/browse' }]"
      :aria-hidden="route.path !== '/browse'"
    />
    <router-view v-if="!isPersistentRoute" v-slot="{ Component }">
      <component :is="Component" :class="pageMotion" />
    </router-view>
    <div v-if="showDock" class="dock">
      <div class="dock-inner">
        <MiniPlayer />
        <BottomNav v-if="showNav" />
      </div>
    </div>

    <div class="toast-stack">
      <div
        v-for="toast in pluginToasts"
        :key="toast.id"
        class="toast"
        :class="toast.level"
      >
        <span class="toast-message">{{ toast.message }}</span>
        <button
          v-if="toast.actionLabel"
          class="toast-action"
          @click.stop="openToastAction(toast)"
        >
          {{ toast.actionLabel }}
        </button>
      </div>
    </div>

    <transition name="sheet-pop">
      <div v-if="permissionRequest" class="sheet-mask" @click.self="answerPermission(false)">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="权限请求">
          <div class="grab" />
          <div class="sh-head">
            <span class="sh-title">权限请求</span>
          </div>
          <p class="meta pad" style="margin: -4px 0 14px">
            {{ permissionRequest.pluginName }} 请求「{{ permissionRequest.name }}」权限。
            {{ permissionRequest.reason }}
          </p>
          <div class="row g10 pad">
            <button class="btn btn-ghost f1" @click="answerPermission(false)">拒绝</button>
            <button class="btn btn-primary f1" @click="answerPermission(true)">允许</button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="sheet-pop">
      <PluginAccountSurface v-if="accountSurface" :spec="accountSurface" @close="closeAccountSurface" />
    </transition>
    <ConfirmSheet />
    </div>
  </ion-app>
</template>

<style>
.app-shell.custom-theme-active > .screen{background:transparent}
.app-shell.custom-theme-active .screen.player .p-bg,.app-shell.custom-theme-active .screen.player .ly-bg{display:none}
.app-shell.custom-theme-active .screen.player .ly{background:transparent}
</style>
