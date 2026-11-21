<script setup lang="ts">
import Icon from './Icon.vue'
defineProps<{ visible: boolean; canLocate: boolean; disabled?: boolean }>()
defineEmits<{ locate: []; top: [] }>()
</script>
<template>
  <Transition name="track-navigation">
    <div v-if="visible && !disabled" class="track-navigation" role="group" aria-label="歌曲列表导航">
      <button :disabled="!canLocate" aria-label="定位当前播放" title="定位当前播放" @click="$emit('locate')"><Icon name="locate" :size="18" /></button>
      <button aria-label="回到顶部" title="回到顶部" @click="$emit('top')"><Icon name="up" :size="18" /></button>
    </div>
  </Transition>
</template>
<style scoped>
.track-navigation{position:fixed;z-index:40;left:calc(50% + var(--app-max, 100%)/2 - 58px);bottom:calc(var(--dock-h) + 10px);display:flex;flex-direction:column;gap:7px}
.track-navigation button{display:grid;place-items:center;width:44px;height:44px;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--brand-strong);box-shadow:var(--sh-2)}.track-navigation button:active{transform:scale(.95)}.track-navigation button:focus-visible{outline:2px solid var(--brand-strong);outline-offset:2px}.track-navigation button:disabled{opacity:.5}
.track-navigation-enter-active,.track-navigation-leave-active{transition:opacity .16s,transform .16s}.track-navigation-enter-from,.track-navigation-leave-to{opacity:0;transform:translateY(6px)}
@media(min-width:768px){.track-navigation{left:auto;right:max(calc((100% - var(--app-max))/2 + 14px),20px);flex-direction:row}}
@media(prefers-reduced-motion:reduce){.track-navigation-enter-active,.track-navigation-leave-active{transition:none}.track-navigation button:active{transform:none}}
</style>
