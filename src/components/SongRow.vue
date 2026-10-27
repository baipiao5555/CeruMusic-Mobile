<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import SongActionsSheet from './SongActionsSheet.vue'
import { playerState, type Track } from '@/core/playback/player'
import { isFavorite, toggleFavorite } from '@/core/library'
import { downloadTrack, isDownloaded, isDownloading } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'
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
const sourceTag = computed(() =>
  props.track.providerId && props.track.providerId !== 'local' ? props.track.providerId : ''
)
const titleParts = computed(() =>
  props.query ? highlightParts(props.track.title, props.query) : [{ text: props.track.title, hit: false }]
)
const artistParts = computed(() =>
  props.query ? highlightParts(props.track.artist, props.query) : [{ text: props.track.artist, hit: false }]
)

function play(): void {
  if (props.selectable) {
    emit('toggle-select')
    return
  }
  emit('play', props.queue ?? [props.track], props.index)
}

function download(): void {
  if (downloaded.value) {
    notify('这首歌已经下载好了')
    return
  }
  if (downloading.value) {
    notify('这首歌正在下载中')
    return
  }
  downloadTrack(props.track)
  notify('已加入下载队列')
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
    class="song-row"
    :class="{ playing: active, selecting: selectable, selected: selectable && selected }"
    @click="play"
  >
    <span v-if="selectable" class="select-check" :class="{ checked: selected }" aria-hidden="true">
      <Icon v-if="selected" name="check" :size="13" />
    </span>
    <span v-else-if="showIndex" class="song-index">{{ index + 1 }}</span>
    <div v-if="showCover" class="cover">
      <img :src="track.artwork" alt="" loading="lazy" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
    </div>
    <div class="info">
      <h3>
        <template v-for="(part, partIndex) in titleParts" :key="partIndex">
          <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </h3>
      <p class="song-meta">
        <span v-if="bestQuality" class="quality-tag">{{ qualityLabel(bestQuality) }}</span>
        <span v-if="sourceTag" class="source-tag">{{ sourceTag }}</span>
        <span class="song-artist">
          <template v-for="(part, partIndex) in artistParts" :key="partIndex">
            <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
      </p>
    </div>
    <div v-if="!selectable" class="row-actions" @click.stop>
      <span v-if="showIndex" class="duration">{{ formatDuration(track.durationMs) }}</span>
      <button
        class="icon-action"
        :class="{ active: favorite }"
        :aria-label="favorite ? '取消收藏' : '收藏'"
        @click="toggleFavorite(track)"
      >
        <Icon :name="favorite ? 'heart-filled' : 'heart'" :size="19" />
      </button>
      <button
        class="icon-action"
        :class="{ active: downloaded, busy: downloading }"
        :aria-label="downloaded ? '已下载' : '下载'"
        @click="download"
      >
        <Icon :name="downloaded ? 'check' : 'download'" :size="19" />
      </button>
      <button class="icon-action" aria-label="更多操作" @click="showActions = true">
        <Icon name="more" :size="19" />
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
.hl {
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 3px;
  font-weight: 700;
}
.song-index {
  width: 22px;
  text-align: center;
  font-size: 12px;
  color: var(--muted-2);
  font-variant-numeric: tabular-nums;
}
.select-check {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  color: #fff;
  background: var(--surface);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;
}
.select-check.checked {
  border-color: var(--brand);
  background: var(--brand);
}
.song-row.selecting.selected {
  background: var(--brand-softer);
}
.song-row.selecting:active .select-check {
  transform: scale(0.9);
}
.duration {
  font-size: 11px;
  color: var(--muted-2);
  margin-right: 2px;
  font-variant-numeric: tabular-nums;
}
.song-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.song-artist {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quality-tag,
.source-tag {
  flex: 0 0 auto;
  padding: 1px 4px;
  border-radius: 5px;
  font-size: 9.5px;
  font-weight: 650;
  line-height: 1.45;
}
.quality-tag {
  color: #f0a23a;
  background: rgba(240, 138, 36, 0.14);
}
.source-tag {
  color: #38d6e6;
  background: rgba(56, 214, 230, 0.12);
}
</style>
