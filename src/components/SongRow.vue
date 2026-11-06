<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import SongActionsSheet from './SongActionsSheet.vue'
import { playerState, type Track } from '@/core/playback/player'
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

const showActions = ref(false)

const emit = defineEmits<{
  play: [queue: Track[], index: number]
  'toggle-select': []
}>()

const active = computed(
  () =>
    playerState.queue[playerState.index]?.id === props.track.id &&
    playerState.queue[playerState.index]?.providerId === props.track.providerId
)

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
    class="songrow"
    :class="{ active, selecting, selected: selectable && selected }"
    @click="play"
  >
    <span v-if="selecting" class="sel" :class="{ on: selected }" aria-hidden="true">
      <Icon v-if="selected" name="check" :size="12" />
    </span>
    <span v-else-if="showIndex" class="idx">{{ String(index + 1).padStart(2, '0') }}</span>

    <div v-if="showCover" class="cover">
      <img
        :src="track.artwork"
        alt=""
        loading="lazy"
        @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
      />
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
    </div>

    <div v-if="!selecting" class="r" @click.stop>
      <div v-if="active" class="wave" aria-label="正在播放">
        <i /><i /><i /><i />
      </div>
      <span v-else class="dur">{{ formatDuration(track.durationMs) }}</span>
      <button class="iconbtn quiet" aria-label="更多操作" @click="showActions = true">
        <Icon name="more" :size="18" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <SongActionsSheet
      v-if="showActions"
      :track="track"
      :playlist-id="playlistId"
      @close="showActions = false"
    />
  </Teleport>
</template>

<style scoped>
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
</style>
