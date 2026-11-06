<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'

const route = useRoute()
const router = useRouter()

const items = [
  { path: '/', label: '发现', icon: 'compass' },
  { path: '/search', label: '搜索', icon: 'search' },
  { path: '/playlists', label: '歌单', icon: 'playlist' },
  { path: '/library', label: '我的', icon: 'user' }
]

const activeIndex = computed(() => {
  const path = route.path
  if (path.startsWith('/search')) return 1
  if (path === '/playlists' || path.startsWith('/playlist/')) return 2
  if (
    path.startsWith('/library') ||
    path.startsWith('/settings') ||
    path.startsWith('/plugins') ||
    path.startsWith('/cloud') ||
    path.startsWith('/downloads') ||
    path.startsWith('/logs') ||
    path.startsWith('/update')
  ) {
    return 3
  }
  return 0
})

function go(path: string): void {
  if (route.path !== path) router.push(path)
}
</script>

<template>
  <nav class="tabbar">
    <button
      v-for="(item, index) in items"
      :key="item.path"
      class="tab"
      :class="{ on: activeIndex === index }"
      @click="go(item.path)"
    >
      <span class="pillbg"><Icon :name="item.icon" :size="19" /></span>
      {{ item.label }}
    </button>
  </nav>
</template>
