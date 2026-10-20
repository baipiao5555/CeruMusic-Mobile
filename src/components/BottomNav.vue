<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IonIcon } from '@ionic/vue'
import {
  compass,
  compassOutline,
  musicalNotes,
  musicalNotesOutline,
  person,
  personOutline,
  search,
  searchOutline
} from 'ionicons/icons'

const route = useRoute()
const router = useRouter()

const items = [
  { path: '/', label: '发现', icon: compassOutline, activeIcon: compass },
  { path: '/search', label: '搜索', icon: searchOutline, activeIcon: search },
  { path: '/playlists', label: '歌单', icon: musicalNotesOutline, activeIcon: musicalNotes },
  { path: '/library', label: '我的', icon: personOutline, activeIcon: person }
]

const activeIndex = computed(() => {
  const path = route.path
  if (path.startsWith('/search')) return 1
  if (path === '/playlists' || path.startsWith('/playlist/')) return 2
  if (
    path.startsWith('/library') ||
    path.startsWith('/settings') ||
    path.startsWith('/plugins')
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
  <nav class="bottom-nav">
    <button
      v-for="(item, index) in items"
      :key="item.path"
      class="nav-item"
      :class="{ active: activeIndex === index }"
      @click="go(item.path)"
    >
      <span class="nav-icon">
        <ion-icon :icon="activeIndex === index ? item.activeIcon : item.icon" />
      </span>
      {{ item.label }}
    </button>
  </nav>
</template>
