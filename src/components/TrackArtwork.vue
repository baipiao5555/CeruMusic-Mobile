<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveTrackArtwork, safeArtworkUrl } from '@/core/artwork'
import type { Track } from '@/core/track'
const props = withDefaults(defineProps<{ track: Track; eager?: boolean; alt?: string }>(), { eager:false, alt:'' })
const element = ref<HTMLImageElement>(), url = ref('/default-cover.png')
let visible = false, sequence = 0, observer: IntersectionObserver | undefined, retry = false
async function refresh(force = false): Promise<void> {
  const id = ++sequence, track = props.track
  const supplied = safeArtworkUrl(track.artwork)
  if (!force) url.value = supplied || (/^(data:|blob:)/.test(track.artwork) ? track.artwork : '/default-cover.png')
  if (supplied && !force && track.artwork !== supplied) track.artwork = supplied
  if (!visible || (!force && supplied)) return
  const result = await resolveTrackArtwork(track, force)
  if (id !== sequence || track !== props.track || !result) return
  url.value = result; track.artwork = result
}
function imageError(): void {
  url.value = '/default-cover.png'
  if (!retry) { retry = true; void refresh(true) }
}
watch(() => [props.track.pluginId, props.track.providerId, props.track.id, props.track.artwork], () => { retry = false; void refresh() }, { immediate:true })
onMounted(() => {
  if (props.eager || !('IntersectionObserver' in window)) { visible = true; void refresh(); return }
  observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { visible = true; observer?.disconnect(); void refresh() } }, { rootMargin:'120px' })
  if (element.value) observer.observe(element.value)
})
onBeforeUnmount(() => { sequence++; observer?.disconnect() })
</script>
<template><img ref="element" :src="url" :alt="alt" :loading="eager ? 'eager' : 'lazy'" decoding="async" referrerpolicy="no-referrer" @error="imageError" /></template>
