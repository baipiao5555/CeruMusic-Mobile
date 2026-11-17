<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { backgroundAppliesToRoute, disposeThemeBackground, restoreThemeBackground, themeBackgroundScene, themeBackgroundState, type ThemeBackgroundScene } from '@/core/themeBackground'

defineOptions({ name: 'ThemeBackgroundLayer' })
const props = withDefaults(defineProps<{ pagePath: string; scene?: ThemeBackgroundScene; foreground?: boolean }>(), { foreground: true })
const video = ref<HTMLVideoElement | null>(null)
const visible = ref(document.visibilityState !== 'hidden')
const activated = ref(true)
const reduced = ref(false)
const savingData = ref(false)
const failed = ref(false)
const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection
let playToken = 0
let playTimer: ReturnType<typeof setTimeout> | null = null
const applies = computed(() => backgroundAppliesToRoute(props.pagePath, props.scene ?? themeBackgroundScene.value))
const moving = computed(() => applies.value && props.foreground && visible.value && activated.value && !reduced.value && !savingData.value && !failed.value && !themeBackgroundState.probing && !themeBackgroundState.playbackUnavailable && themeBackgroundState.config?.motion !== 'poster')
const renderVideo = computed(() => themeBackgroundState.config?.kind === 'video' && moving.value)
const imageUrl = computed(() => themeBackgroundState.config?.kind === 'video' ? themeBackgroundState.posterUrl : themeBackgroundState.url)
const mediaStyle = computed(() => ({ objectFit: themeBackgroundState.config?.fit ?? 'cover', filter: `blur(${themeBackgroundState.config?.blur ?? 0}px)`, transform: themeBackgroundState.config?.blur ? 'scale(1.08)' : 'none' }))
const maskStyle = computed(() => ({ background: themeBackgroundState.config?.dark ? '#000' : '#fff', opacity: themeBackgroundState.config?.mask ?? 0.6 }))

function stopVideo(): void {
  if (playTimer) { clearTimeout(playTimer); playTimer = null }
  playToken++
  if (!video.value) return
  video.value.pause()
  video.value.removeAttribute('src')
  video.value.load()
}

function schedulePlay(): void {
  if (playTimer) clearTimeout(playTimer)
  // Sync computed watchers can run before Vue queues the new video DOM. One
  // macrotask also preserves a same-tick foreground false -> true round trip.
  playTimer = setTimeout(() => { playTimer = null; void playVideo() }, 0)
}

async function playVideo(): Promise<void> {
  await nextTick()
  const element = video.value
  if (!element || !renderVideo.value) return
  const token = ++playToken
  element.defaultMuted = true; element.muted = true; element.volume = 0; element.playsInline = true
  if (element.getAttribute('src') !== themeBackgroundState.url) element.src = themeBackgroundState.url
  try {
    await element.play()
    // A newer play request for this same video must not be cancelled by an
    // older promise completing. Only a changed owner/visibility stops it.
    if (!moving.value || element !== video.value) element.pause()
  } catch {
    if (token !== playToken || !moving.value) return
    failed.value = true
    themeBackgroundState.error = '背景视频无法自动播放，已退回静态首帧；音乐播放不受影响。'
  }
}

function videoError(): void {
  if (!renderVideo.value) return
  failed.value = true
  stopVideo()
  themeBackgroundState.error = '背景视频播放/解码失败，已退回保存的首帧；请换文件。'
}
function updateVisibility(): void { visible.value = document.visibilityState !== 'hidden'; if (!visible.value) stopVideo() }
function pageHide(): void { visible.value = false; stopVideo() }
function updateMotion(): void { reduced.value = mediaQuery.matches }
function updateData(): void { savingData.value = connection?.saveData === true }

watch(() => themeBackgroundState.url, () => { stopVideo(); failed.value = false }, { flush: 'sync' })
watch(moving, active => { if (!active) stopVideo(); else if (themeBackgroundState.config?.kind === 'video') schedulePlay() }, { flush: 'sync', immediate: true })
onMounted(() => {
  updateMotion(); updateData()
  document.addEventListener('visibilitychange', updateVisibility)
  window.addEventListener('pagehide', pageHide)
  window.addEventListener('pageshow', updateVisibility)
  if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', updateMotion)
  else mediaQuery.addListener(updateMotion)
  connection?.addEventListener('change', updateData)
  void restoreThemeBackground()
})
onActivated(() => { activated.value = true; updateVisibility(); if (renderVideo.value) void playVideo() })
onDeactivated(() => { activated.value = false; stopVideo() })
onBeforeUnmount(() => {
  stopVideo()
  document.removeEventListener('visibilitychange', updateVisibility)
  window.removeEventListener('pagehide', pageHide)
  window.removeEventListener('pageshow', updateVisibility)
  if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', updateMotion)
  else mediaQuery.removeListener(updateMotion)
  connection?.removeEventListener('change', updateData)
  disposeThemeBackground()
})
</script>

<template>
  <div v-if="applies && themeBackgroundState.config" class="theme-background-layer" aria-hidden="true" :data-kind="themeBackgroundState.config.kind" :data-moving="renderVideo">
    <video v-if="renderVideo" ref="video" :key="themeBackgroundState.url" class="theme-background-media" :src="themeBackgroundState.url" :poster="themeBackgroundState.posterUrl" :style="mediaStyle" muted loop playsinline preload="auto" disablepictureinpicture disableremoteplayback @error="videoError" />
    <img v-else-if="imageUrl" class="theme-background-media theme-background-poster" :src="imageUrl" :style="mediaStyle" alt="" />
    <div class="theme-background-mask" :style="maskStyle" />
  </div>
</template>

<style scoped>
.theme-background-layer { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; background: var(--porcelain); }
.theme-background-media { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.theme-background-mask { position: absolute; inset: 0; }
</style>
