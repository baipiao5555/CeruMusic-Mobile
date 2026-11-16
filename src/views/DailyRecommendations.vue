<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import Icon from '@/components/Icon.vue'
import { allProviders } from '@/core/plugin/manager'
import { isFavorite, toggleFavorite } from '@/core/library'
import { playTracks } from '@/core/playback/player'
import { dailyLiveTrack, dailyTrackKey, getDailyRecommendations, nextLocalMidnight, type DailySnapshot } from '@/core/dailyRecommendations'
import type { Track } from '@/core/track'

const router = useRouter()
const snapshot = ref<DailySnapshot>()
const warning = ref('')
const message = ref('')
const starting = ref(false)
const providers = computed(() => allProviders(true))
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
function unavailable(entry: Track): string {
  const live = dailyLiveTrack(entry)
  if (!live) return '本地记录已移除或待匹配，暂不能播放'
  if (live.pluginId === 'local') return Capacitor.isNativePlatform() ? '' : '本机曲目请在 Android 客户端播放'
  const provider = providers.value.find(p => p.pluginId === live.pluginId && p.providerId === live.providerId)
  return !provider ? '该音源已停用，请先在设置中启用' : !provider.methods.includes('tracks.resolve') ? '该音源暂不支持播放地址解析' : ''
}
const playable = computed(() => (snapshot.value?.entries || []).filter(entry => !unavailable(entry)))
function refresh(): void {
  if (disposed) return
  const result = getDailyRecommendations()
  snapshot.value = result.snapshot
  warning.value = result.warning
  if (timer) clearTimeout(timer)
  // Check clock/timezone changes too; local midnight can be 23 or 25 hours away.
  timer = setTimeout(refresh, Math.max(100, Math.min(60000, nextLocalMidnight() - Date.now() + 100)))
}
function foreground(): void { if (document.visibilityState === 'visible') refresh() }
onMounted(async () => {
  // App restores the library in its mounted hook, after child pages mount.
  await nextTick()
  if (disposed) return
  refresh()
  document.addEventListener('visibilitychange', foreground)
})
onBeforeUnmount(() => { disposed = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', foreground) })
async function play(entry?: Track): Promise<void> {
  if (starting.value) return
  message.value = ''
  const entries = playable.value
  const index = entry ? entries.findIndex(item => dailyTrackKey(item) === dailyTrackKey(entry)) : 0
  if (!entries.length || index < 0) { message.value = entry ? unavailable(entry) : '今日曲目暂不可播放，请检查本地记录和音源状态。'; return }
  const queue = entries.map(item => dailyLiveTrack(item)!).filter(Boolean)
  starting.value = true
  try { await playTracks(queue, index) } catch (e: any) { message.value = e?.message || '播放失败，请检查音源和网络。' }
  finally { starting.value = false }
}
function favorite(entry: Track): void {
  const live = dailyLiveTrack(entry)
  if (!live) { message.value = '本地原始记录已移除，无法添加收藏。'; return }
  toggleFavorite(live)
}
function back(): void { if (history.state?.back) router.back(); else void router.replace('/') }
function duration(ms: number): string { const seconds = Math.floor(ms / 1000); return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '' }
</script>

<template>
  <div class="screen daily-page">
    <div class="scroll safe-t daily-scroll">
      <div class="navrow"><button class="iconbtn quiet" aria-label="返回" @click="back"><Icon name="back" :size="20" /></button><span class="daily-nav-title">每日精选</span><span class="iconbtn" /></div>
      <header class="daily-hero pad">
        <div class="daily-date"><small>{{ snapshot?.day.slice(5, 7) || '—' }} 月</small><strong>{{ snapshot?.day.slice(8) || '—' }}</strong></div>
        <div><div class="eyebrow">LOCAL · DAILY</div><h1>澜音每日精选（本地）</h1><p>收藏、歌单与最近播放 · 今日固定</p><small v-if="snapshot">{{ snapshot.entries.length }} 首 · {{ snapshot.day }}</small></div>
      </header>
      <div class="daily-explanation pad"><p>从完整本地记录去重轮换，不是音乐平台个性化日推，也未使用播放时长。</p><p v-if="snapshot?.excluded">已跳过 {{ snapshot.excluded }} 条未绑定、无效或私有连接记录。</p><p v-if="warning" class="daily-warning" role="status">{{ warning }}</p><p v-if="message" class="daily-warning" role="status">{{ message }}</p></div>
      <div v-if="snapshot?.entries.length" class="daily-toolbar pad"><button class="btn btn-primary" :disabled="starting || !playable.length" @click="play()"><Icon name="play" :size="17" />{{ starting ? '正在起播…' : '播放全部' }}<span>({{ playable.length }})</span></button><small>{{ snapshot.candidates }} 首本地候选 · 自然日更新</small></div>
      <div v-if="snapshot && !snapshot.entries.length" class="empty daily-empty"><div class="glyph"><Icon name="playlist" :size="32" /></div><h2>还没有可精选的本地曲目</h2><p>先收藏、播放或导入并匹配歌曲；今日名单已固定，新增记录从下个本地自然日参与。</p><button class="btn btn-ghost" @click="router.push('/library')">查看本地记录</button></div>
      <div v-else class="pad daily-list">
        <div v-for="(entry, index) in snapshot?.entries || []" :key="dailyTrackKey(entry)" class="daily-row">
          <button class="daily-track" :disabled="Boolean(unavailable(entry))" :aria-label="`播放 ${entry.title}`" @click="play(entry)"><span class="daily-index">{{ String(index + 1).padStart(2, '0') }}</span><img :src="entry.artwork" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" /><span class="daily-meta"><strong>{{ entry.title }}</strong><small>{{ entry.artist }}</small></span><span class="daily-duration">{{ duration(entry.durationMs) }}</span></button>
          <button class="iconbtn quiet daily-favorite" :disabled="!dailyLiveTrack(entry)" :aria-label="`${isFavorite(entry) ? '取消收藏' : '收藏'} ${entry.title}`" @click="favorite(entry)"><Icon :name="isFavorite(entry) ? 'heart-filled' : 'heart'" :size="18" /></button>
          <p v-if="unavailable(entry)" class="daily-unavailable">{{ unavailable(entry) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.daily-nav-title{flex:1;text-align:center;font-size:17px;font-weight:650}.daily-hero{display:flex;align-items:center;gap:18px;padding-top:20px;padding-bottom:22px;background:linear-gradient(135deg,var(--tint-soft),var(--porcelain))}.daily-date{flex:none;width:72px;text-align:center;color:var(--brand-strong);border:1px solid var(--line-2);border-radius:14px;padding:9px 0;background:var(--surface)}.daily-date small{display:block;font-size:11px}.daily-date strong{font-size:36px;line-height:1.2;font-weight:650}.daily-hero h1{font-size:20px;line-height:1.5;margin:5px 0;word-break:break-word}.daily-hero p{font-size:11px;color:var(--ink-2);line-height:1.6}.daily-hero>div>small{font-size:11px;color:var(--ink-3);display:block;margin-top:8px}.daily-explanation{padding-top:14px;padding-bottom:8px;font-size:11px;line-height:1.8;color:var(--ink-3)}.daily-warning{color:var(--cinnabar);margin-top:6px}.daily-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:8px;padding-bottom:12px}.daily-toolbar .btn{gap:6px;font-size:13px;padding:0 14px}.daily-toolbar>small{font-size:10px;color:var(--ink-3);text-align:right}.daily-row{display:grid;grid-template-columns:minmax(0,1fr) 40px;border-bottom:1px solid var(--line);padding:8px 0}.daily-track{display:flex;align-items:center;gap:10px;min-width:0;min-height:56px;text-align:left}.daily-track:disabled{opacity:.65}.daily-index{font-size:11px;color:var(--ink-3);width:18px;flex:none}.daily-track img{width:44px;height:44px;border-radius:9px;object-fit:cover;flex:none}.daily-meta{flex:1;min-width:0}.daily-meta strong,.daily-meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.daily-meta strong{font-size:14px;font-weight:550}.daily-meta small{font-size:11px;color:var(--ink-3);margin-top:6px}.daily-duration{font-size:10px;color:var(--ink-3);flex:none}.daily-favorite{align-self:center;color:var(--brand-strong)}.daily-unavailable{grid-column:1/-1;padding-left:28px;font-size:10px;color:var(--ink-3);line-height:1.7}.daily-empty{padding-top:35px}.daily-empty h2{font-size:18px}.daily-empty p{max-width:290px;line-height:1.8;font-size:12px}@media(max-width:375px){.daily-hero{gap:12px}.daily-hero h1{font-size:18px}.daily-date{width:62px}.daily-duration{display:none}.daily-toolbar .btn{font-size:12px}.daily-toolbar>small{max-width:100px}}
</style>
