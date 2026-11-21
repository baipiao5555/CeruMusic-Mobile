import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { currentTrack } from '../playback/player'
import { notify } from '../plugin/manager'
import { trackKey } from '../trackGrouping'
import type { Track } from '../track'

export function normalizeTrackSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}
export function matchesTrackQuery(track: Track, query: string): boolean {
  const q = normalizeTrackSearch(query)
  return !q || [track.title, track.artist, track.album].some(value => normalizeTrackSearch(value).includes(q))
}
export function orderedTracks(tracks: Track[], sort: 'saved' | 'name' | 'artist'): Track[] {
  if (sort === 'saved') return [...tracks]
  return tracks.map((track, index) => ({track,index})).sort((a,b) => {
    const key = sort === 'name' ? 'title' : 'artist'
    return a.track[key].localeCompare(b.track[key], 'zh-CN') || a.track.title.localeCompare(b.track.title, 'zh-CN') || a.index - b.index
  }).map(item => item.track)
}

/** Navigation only: never substitutes a loose title match for the current provider-owned track. */
export function useTrackNavigation(options: {
  scrollTarget: Ref<HTMLElement | null>
  tracks: () => readonly Track[]
  visibleTracks: () => readonly Track[]
  ensureVisible: (index: number) => Promise<void>
  beforeLocate: () => void | Promise<void>
  label: () => string
  disabled?: () => boolean
}) {
  const scrolled = ref(false)
  const locatedKey = ref('')
  const playingHere = computed(() => {
    const track=currentTrack()
    return Boolean(track && options.tracks().some(item=>trackKey(item)===trackKey(track)))
  })
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  function onScroll(event: Event): void { scrolled.value = (event.target as HTMLElement).scrollTop > 300 }
  function clearHighlight(): void { locatedKey.value=''; if(highlightTimer)clearTimeout(highlightTimer) }
  function toTop(): void {
    const target=options.scrollTarget.value
    target?.scrollTo({top:0,behavior:'auto'})
    if(target)target.scrollTop=0
    clearHighlight()
  }
  async function toPlaying(): Promise<void> {
    if (options.disabled?.()) return
    const playing=currentTrack()
    if (!playing) { notify('当前没有播放歌曲'); return }
    const key=trackKey(playing)
    if (!options.tracks().some(track=>trackKey(track)===key)) { notify(`当前播放的歌曲不在${options.label()}里`); return }
    await options.beforeLocate()
    await nextTick()
    const index=options.visibleTracks().findIndex(track=>trackKey(track)===key)
    if (index<0) return
    await options.ensureVisible(index)
    await nextTick()
    const root=options.scrollTarget.value
    const row=root ? [...root.querySelectorAll<HTMLElement>('[data-track-key]')].find(el=>el.dataset.trackKey===key) : undefined
    if (!root || !row) { notify('正在显示当前歌曲，请稍候重试'); return }
    locatedKey.value=key
    const toolbar=root.querySelector<HTMLElement>('.list-sticky-tools')
    const stickyBottom=toolbar?.getBoundingClientRect().bottom ?? root.getBoundingClientRect().top
    const target=root.scrollTop+row.getBoundingClientRect().top-stickyBottom-8
    root.scrollTo({top:Math.max(0,target),behavior:'auto'})
    if(highlightTimer)clearTimeout(highlightTimer)
    highlightTimer=setTimeout(clearHighlight,2500)
  }
  watch(()=>{const current=currentTrack();return current?trackKey(current):''},()=>clearHighlight())
  onBeforeUnmount(() => { if(highlightTimer)clearTimeout(highlightTimer) })
  return {scrolled,locatedKey,playingHere,onScroll,toTop,toPlaying,clearHighlight}
}
