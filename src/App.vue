<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BottomNav from '@/components/BottomNav.vue'
import MiniPlayer from '@/components/MiniPlayer.vue'
import { pluginToasts, permissionRequest, answerPermission, initPlugins, pluginState, selectProvider, installDemoPlugin, navigationRequest } from '@/core/plugin/manager'
import { initPlayer, registerPlayerHostHooks, restorePlayer, resume, pause, next, previous, seek } from '@/core/playback/player'
import { onMediaAction, stopBackgroundAudio } from '@/core/native/backgroundAudio'
import { registerLibraryHostHooks, restoreLibrary } from '@/core/library'
import { applyTheme, registerSettingsHostHooks, restoreSettings, settingsState } from '@/core/settings'

const router = useRouter()
const route = useRoute()
const showNav = computed(() => route.path !== '/player')

onMounted(async () => {
  restoreSettings()
  restoreLibrary()
  initPlayer()
  registerPlayerHostHooks()
  registerLibraryHostHooks()
  registerSettingsHostHooks()
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
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (settingsState.theme === 'system') applyTheme()
  })
})

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
  <div class="app-shell">
    <div class="app-bg" />
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
</template>
