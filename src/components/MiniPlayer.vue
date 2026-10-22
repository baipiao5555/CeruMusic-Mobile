<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { currentTrack, playerState, togglePlay, next } from '@/core/playback/player'

const router = useRouter()
const route = useRoute()

const track = computed(() => currentTrack())
const visible = computed(() => Boolean(track.value) && route.path !== '/player')
const progress = computed(() => {
  if (!playerState.duration) return 0
  return Math.min(100, (playerState.currentTime / playerState.duration) * 100)
})

function open(): void {
  if (track.value) router.push('/player')
}
</script>

<template>
  <transition name="fade">
    <div v-if="visible" class="mini-player" @click="open">
      <div class="progress-line"><i :style="{ width: progress + '%' }" /></div>
      <div class="cover">
        <img
          :src="track!.artwork"
          alt=""
          @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
        />
      </div>
      <div class="info">
        <h3>{{ track!.title }}</h3>
        <p>{{ track!.artist }}</p>
      </div>
      <button
        class="icon-action primary"
        aria-label="播放或暂停"
        @click.stop="togglePlay"
      >
        <span v-if="playerState.loading" class="loading-dots"><i /><i /><i /></span>
        <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="20" />
      </button>
      <button class="icon-action" aria-label="下一首" @click.stop="next">
        <Icon name="next" :size="19" />
      </button>
    </div>
  </transition>
</template>
