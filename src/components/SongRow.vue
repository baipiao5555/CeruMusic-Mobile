<script setup lang="ts">
defineOptions({ inheritAttrs: false })
import { computed, ref } from 'vue'
import TrackArtwork from '@/components/TrackArtwork.vue'
import SongSourcesSheet from './SongSourcesSheet.vue'
import { sourcesOf, trackKey, platformLabel, withSources } from '@/core/trackGrouping'
import Icon from './Icon.vue'
import SongActionsSheet from './SongActionsSheet.vue'
import { playerState, playTracks, type Track } from '@/core/playback/player'
import { notify } from '@/core/plugin/manager'
import { isFavorite } from '@/core/library'
import { isDownloaded, isDownloading } from '@/core/downloads'
import { highestQuality, qualityLabel } from '@/core/quality'
import { highlightParts } from '@/core/search'

const props = withDefaults(
  defineProps<{
    track: Track
    index?: number
    queue?: Track[]
    showIndex?: boolean
    showCover?: boolean
    /** Renders a checkbox and turns row taps into selection toggles. */
    selectable?: boolean
    selected?: boolean
    /** When set, the action sheet offers "remove from this playlist". */
    playlistId?: string
    /** Search keyword: matched fragments in title/artist get highlighted. */
    query?: string
  }>(),
  { index: 0, showIndex: false, showCover: true, selectable: false, selected: false, query: '' }
)

const showActions = ref(false), showSources = ref(false), chosenKey = ref('')
const sourceTracks = computed(()=>sourcesOf(props.track))
const sourcePlatforms = computed(()=>[...new Set(sourceTracks.value.map(platformLabel))])

const emit = defineEmits<{
  play: [queue: Track[], index: number]
  'toggle-select': []
}>()

const active = computed(() => { const current=playerState.queue[playerState.index]; return Boolean(current && sourceTracks.value.some(t=>trackKey(t)===trackKey(current))) })
function chooseSource(source:Track):void {
  chosenKey.value = trackKey(source); showSources.value=false
  const queue = [...(props.queue || [props.track])]
  queue[props.index] = withSources(source,sourceTracks.value)
  void playTracks(queue,props.index).catch(e=>notify(e.message || '该来源播放失败'))
}


const favorite = computed(() => isFavorite(props.track))
const downloaded = computed(() => isDownloaded(props.track))
const downloading = computed(() => isDownloading(props.track))
const bestQuality = computed(() => highestQuality(props.track.qualities))
const titleParts = computed(() =>
  props.query ? highlightParts(props.track.title, props.query) : [{ text: props.track.title, hit: false }]
)
const artistParts = computed(() =>
  props.query ? highlightParts(props.track.artist, props.query) : [{ text: props.track.artist, hit: false }]
)

/** 歌单多选：开模式时点击行变成选择，不再起播。 */
const selecting = computed(() => Boolean(props.selectable))

function play(): void {
  if (props.selectable) {
    emit('toggle-select')
    return
  }
  const chosen = sourceTracks.value.find(t=>trackKey(t)===chosenKey.value)
  if (chosen && trackKey(chosen)!==trackKey(props.track)) { chooseSource(chosen); return }
  emit('play', props.queue ?? [props.track], props.index)
}

function formatDuration(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return ''
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
</script>

<template>
  <div
    v-bind="$attrs"
    class="songrow"
    :class="{ active, selecting, selected: selectable && selected }"
    :role="selectable ? 'checkbox' : 'button'"
    :aria-checked="selectable ? selected : undefined"
    :aria-label="`${selectable ? '选择' : '播放'} ${track.title} · ${track.artist}`"
    tabindex="0"
    @click="play"
    @keydown.enter.self.prevent="play"
    @keydown.space.self.prevent="play"
  >
    <span v-if="selecting" class="sel" :class="{ on: selected }" aria-hidden="true">
      <Icon v-if="selected" name="check" :size="12" />
    </span>
    <span v-else-if="showIndex" class="idx">{{ String(index + 1).padStart(2, '0') }}</span>

    <div v-if="showCover" class="cover">
      <TrackArtwork :track="track" />
    </div>

    <div class="meta-wrap">
      <div class="t truncate">
        <template v-for="(part, partIndex) in titleParts" :key="partIndex">
          <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </div>
      <div class="a">
        <span class="artist truncate">
          <template v-for="(part, partIndex) in artistParts" :key="partIndex">
            <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
        <span v-if="bestQuality" class="q">{{ qualityLabel(bestQuality) }}</span>
        <span v-if="favorite" class="mk fav" aria-label="已收藏">
          <Icon name="heart-filled" :size="11" />
        </span>
        <span v-if="downloaded" class="mk dl" aria-label="已下载">
          <Icon name="check" :size="11" />
        </span>
        <span v-if="downloading" class="mk busy" aria-label="下载中">
          <Icon name="download" :size="11" />
        </span>
      </div>
      <div class="song-sources" v-if="track.pluginId !== 'local'">
        <span v-for="name in sourcePlatforms.slice(0,3)" :key="name" class="platform-tag">{{ name }}</span><span v-if="sourcePlatforms.length>3" class="platform-tag">+{{ sourcePlatforms.length-3 }}</span>
        <button v-if="sourceTracks.length>1 && !selecting" class="song-sources-button" :aria-label="'查看 '+track.title+' 的 '+sourceTracks.length+' 个来源'" @click.stop="showSources=true">{{ sourceTracks.length }} 个来源 <Icon name="chevron-down" :size="11" /></button>
        <small v-else-if="track.providerName !== sourcePlatforms[0]">{{ track.providerName }}</small>
      </div>
    </div>

    <div v-if="!selecting" class="r" @click.stop>
      <div v-if="active" class="wave" :class="{ paused: !playerState.playing || playerState.loading }" :aria-label="playerState.playing && !playerState.loading ? '正在播放' : '当前歌曲'">
        <i /><i /><i /><i />
      </div>
      <span v-else class="dur">{{ formatDuration(track.durationMs) }}</span>
      <button class="iconbtn quiet" aria-label="更多操作" @click="showActions = true">
        <Icon name="more" :size="18" />
      </button>
    </div>
  </div>

  <Teleport to="body"><SongSourcesSheet v-if="showSources" :track="track" :selected="chosenKey || (active ? trackKey(playerState.queue[playerState.index]) : trackKey(track))" @choose="chooseSource" @close="showSources=false" />
    <transition name="sheet-pop">
      <SongActionsSheet
        v-if="showActions"
        :track="track"
        :playlist-id="playlistId"
        @close="showActions = false"
      />
    </transition>
  </Teleport>
</template>

<style scoped>
.song-sources{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:5px}.platform-tag{font-size:9px;color:var(--brand-strong);background:var(--tint-soft);border-radius:4px;padding:3px 5px}.song-sources small{font-size:9px;color:var(--ink-3)}.song-sources-button{display:flex;align-items:center;gap:3px;font-size:10px;color:var(--ink-3);background:none;border:0;min-height:30px;padding:4px 6px}.song-sources-button:focus-visible{outline:2px solid var(--tint)}

.songrow.selecting.selected {
  background: var(--tint-soft);
}
.sel {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--line-2);
  color: var(--surface);
  background: var(--surface);
  transition:
    background 0.15s var(--e-out),
    border-color 0.15s var(--e-out),
    transform 0.15s var(--e-out);
}
.sel.on {
  border-color: var(--tint);
  background: var(--tint);
}
.songrow.selecting:active .sel {
  transform: scale(0.9);
}
.artist {
  min-width: 0;
}
.src {
  flex: none;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ink-4);
}
.mk {
  display: inline-flex;
  flex: none;
  align-items: center;
}
.mk.fav {
  color: var(--cinnabar);
}
.mk.dl {
  color: var(--tint);
}
.mk.busy {
  color: var(--ink-4);
  animation: mk-pulse 1.1s var(--e-inout) infinite;
}
@keyframes mk-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.r {
  flex: none;
  min-height: 44px;
}
.dur {
  padding-right: 4px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-4);
}
.wave {
  margin-right: 6px;
}
.wave.paused i {
  animation-play-state: paused;
}
</style>
