<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'

const route = useRoute()
const router = useRouter()

const items = [
  { path: '/', label: '发现', icon: 'discover' },
  { path: '/search', label: '搜索', icon: 'search' },
  { path: '/library', label: '我的', icon: 'library' }
]

const activeIndex = computed(() => {
  const path = route.path
  if (path.startsWith('/search')) return 1
  if (path.startsWith('/library') || path.startsWith('/settings') || path.startsWith('/plugins') || path.startsWith('/playlist')) return 2
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
      <span class="nav-icon"><Icon :name="item.icon" :size="22" /></span>
      {{ item.label }}
    </button>
  </nav>
</template>
