<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'
import type { Track } from '@/core/track'
import { allProviders } from '@/core/plugin/manager'
import { sourcesOf, sourceLabel, trackKey, platformLabel } from '@/core/trackGrouping'
import { highestQuality, qualityLabel } from '@/core/quality'
const props = defineProps<{track:Track;selected?:string}>()
const emit = defineEmits<{close:[];choose:[track:Track]}>()
const panel = ref<HTMLElement>(), sources = computed(()=>sourcesOf(props.track))
function available(track:Track):boolean { return allProviders(true).some(p=>p.pluginId===track.pluginId&&p.providerId===track.providerId&&p.methods.includes('tracks.resolve')) }
function onKey(event:KeyboardEvent):void { if(event.key==='Escape'){event.preventDefault();emit('close')} }
onMounted(()=>{panel.value?.querySelector<HTMLButtonElement>('button')?.focus();document.addEventListener('keydown',onKey)})
onBeforeUnmount(()=>document.removeEventListener('keydown',onKey))
</script>
<template><div class="sheet-mask song-source-mask" @click.self="emit('close')"><section ref="panel" class="sheet song-source-sheet" role="dialog" aria-modal="true" aria-label="选择这首歌的来源"><header><div><h3>{{ track.title }}</h3><p>{{ track.artist }} · {{ sources.length }} 个来源</p></div><button class="iconbtn quiet" aria-label="关闭歌曲来源" @click="emit('close')"><Icon name="close" /></button></header><p class="source-hint">同一首歌保留各平台的原始 ID；手动选择只改变此次播放，不改你的收藏或插件开关。</p><button v-for="source in sources" :key="trackKey(source)" class="song-source-option" :disabled="!available(source)" :data-source-owner="source.pluginId" :data-source-platform="source.providerId" @click="emit('choose',source)"><span class="source-logo">{{ platformLabel(source).slice(0,1) }}</span><span><strong>{{ sourceLabel(source) }}</strong><small>{{ available(source) ? '插件已启用' : '插件未启用' }} · {{ qualityLabel(highestQuality(source.qualities)) }}</small></span><Icon v-if="selected===trackKey(source)" name="check" :size="18" /></button></section></div></template>
<style scoped>
.song-source-mask{z-index:1200;background:#0005;align-items:flex-end}.song-source-sheet{width:min(100%,560px);max-height:85vh;max-height:85dvh;overflow:auto;border-radius:24px 24px 0 0;padding:20px 22px calc(20px + env(safe-area-inset-bottom));background:var(--surface);color:var(--ink)}header{display:flex;align-items:center;gap:12px;justify-content:space-between}header h3{font-size:19px;margin:0}header p,.source-hint{font-size:12px;color:var(--ink-3);line-height:1.8}.song-source-option{display:flex;align-items:center;gap:12px;min-height:75px;width:100%;padding:13px 0;text-align:left;border:0;border-bottom:1px solid var(--line);background:none;color:var(--ink)}.song-source-option>span:nth-child(2){flex:1;min-width:0}.song-source-option strong{font-size:14px;display:block;overflow-wrap:anywhere}.song-source-option small{font-size:11px;color:var(--ink-3);display:block;margin-top:6px}.source-logo{width:40px;height:40px;display:grid;place-items:center;flex:none;border-radius:12px;background:var(--tint-soft);color:var(--brand-strong);font-size:20px;font-weight:650}.song-source-option:disabled{opacity:.5}@media(min-width:700px){.song-source-mask{align-items:center}.song-source-sheet{border-radius:22px}}
@media(min-width:768px){.song-source-mask{align-items:center;padding:24px}.song-source-sheet{border-radius:24px;width:min(100%,600px);max-height:calc(100vh - 48px);max-height:calc(100dvh - 48px)}}
</style>
