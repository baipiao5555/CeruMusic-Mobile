<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import SongActionsSheet from './SongActionsSheet.vue'
import { playerState, type Track } from '@/core/playback/player'
import { isFavorite, toggleFavorite } from '@/core/library'
import { downloadTrack, isDownloaded, isDownloading } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'

const props = withDefaults(
  defineProps<{
    track: Track
    index?: number
    queue?: Track[]
    showIndex?: boolean
    showCover?: boolean
    /** When set, the action sheet offers "remove from this playlist". */
    playlistId?: string
  }>(),
  { index: 0, showIndex: false, showCover: true }
)

const showActions = ref(false)

const emit = defineEmits<{ play: [queue: Track[], index: number] }>()

const active = computed(
  () =>
    playerState.queue[playerState.index]?.id === props.track.id &&
    playerState.queue[playerState.index]?.providerId === props.track.providerId
)

const favorite = computed(() => isFavorite(props.track))
const downloaded = computed(() => isDownloaded(props.track))
const downloading = computed(() => isDownloading(props.track))

function play(): void {
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
  <div class="song-row" :class="{ playing: active }" @click="play">
    <span v-if="showIndex" class="song-index">{{ index + 1 }}</span>
    <div v-if="showCover" class="cover">
      <img :src="track.artwork" alt="" loading="lazy" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
    </div>
    <div class="info">
      <h3>{{ track.title }}</h3>
      <p>{{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template></p>
    </div>
    <div class="row-actions" @click.stop>
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
.song-index {
  width: 22px;
  text-align: center;
  font-size: 12px;
  color: var(--muted-2);
  font-variant-numeric: tabular-nums;
}
.duration {
  font-size: 11px;
  color: var(--muted-2);
  margin-right: 2px;
  font-variant-numeric: tabular-nums;
}
</style>
