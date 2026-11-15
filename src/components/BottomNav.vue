<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'

const route = useRoute()
const router = useRouter()

const items = [
  { path: '/', label: '音乐', icon: 'music' },
  { path: '/playlists', label: '歌单', icon: 'playlist' },
  { path: '/library', label: '我的', icon: 'user' }
]

const activeIndex = computed(() => {
  const path = route.path
  if (path === '/playlists' || path.startsWith('/playlist/')) return 1
  if (
    path.startsWith('/library') ||
    path.startsWith('/settings') ||
    path.startsWith('/plugins') ||
    path.startsWith('/cloud') ||
    path.startsWith('/downloads') ||
    path.startsWith('/local') ||
    path.startsWith('/logs') ||
    path.startsWith('/update')
  ) {
    return 2
  }
  return 0
})

function go(path: string): void {
  if (route.path !== path) router.push(path)
}
</script>

<template>
  <nav class="tabbar" aria-label="主导航">
    <button
      v-for="(item, index) in items"
      :key="item.path"
      class="tab"
      :class="{ on: activeIndex === index }"
      :aria-current="activeIndex === index ? 'page' : undefined"
      @click="go(item.path)"
    >
      <span class="pillbg"><Icon :name="item.icon" :size="22" /></span>
      {{ item.label }}
    </button>
  </nav>
</template>
