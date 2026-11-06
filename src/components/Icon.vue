<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ name: string; size?: number | string; filled?: boolean }>(),
  { size: 22 }
)

/** 旧图标名 → 青瓷图标集（24 描边 SVG mask）。 */
const alias: Record<string, string> = {
  back: 'back',
  chevron: 'chevron-right',
  'chevron-left': 'chevron-left',
  'chevron-down': 'chevron-down',
  'chevron-right': 'chevron-right',
  check: 'check',
  close: 'close',
  cloud: 'cloud',
  copy: 'copy',
  discover: 'compass',
  download: 'download',
  edit: 'edit',
  folder: 'folder',
  heart: 'heart',
  'heart-filled': 'heart-fill',
  info: 'info',
  library: 'music',
  link: 'link',
  logout: 'logout',
  more: 'more',
  music: 'music',
  next: 'next',
  pause: 'pause',
  play: 'play',
  plus: 'plus',
  prev: 'prev',
  queue: 'queue',
  refresh: 'refresh',
  repeat: 'repeat',
  'repeat-one': 'repeat1',
  'scroll-text': 'scroll-text',
  search: 'search',
  select: 'select',
  settings: 'settings',
  share: 'share',
  shuffle: 'shuffle',
  size: 'size',
  smartphone: 'smartphone',
  trash: 'trash',
  user: 'user',
  volume: 'volume',
  lyrics: 'lyrics',
  timer: 'timer',
  sort: 'sort',
  warning: 'warning',
  history: 'history',
  radio: 'radio',
  plugin: 'plugin',
  dot: 'dot',
  list: 'playlist',
  playlist: 'playlist',
  compass: 'compass',
  moon: 'moon',
  sun: 'sun',
  headphone: 'headphone',
  'wifi-off': 'wifi-off',
  fade: 'fade',
  swap: 'swap'
}

const cls = computed(() => `i-${alias[props.name] ?? 'dot'}`)
const dimension = computed(() =>
  typeof props.size === 'number' ? `${props.size}px` : String(props.size)
)
</script>

<template>
  <i
    class="i"
    :class="cls"
    :style="{ width: dimension, height: dimension }"
    aria-hidden="true"
  />
</template>
