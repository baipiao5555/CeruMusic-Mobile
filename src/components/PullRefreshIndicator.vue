<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
const props=defineProps<{visible:boolean;refreshing:boolean;distance:number;result:string;message:string}>()
const rotating=computed(()=>props.refreshing)
</script>
<template><div v-show="visible" class="pull-refresh" :class="{rotating,failed:result==='error'}" role="status" aria-live="polite"><Icon v-if="result==='done'" name="check" :size="17"/><Icon v-else-if="result==='error'" name="warning" :size="17"/><span v-else class="ring" :style="refreshing?undefined:{transform:'rotate('+Math.round(distance*4)+'deg)'}"/><span class="label">{{ message }}</span></div></template>
<style scoped>
.pull-refresh{position:absolute;top:calc(var(--safe-top) + 48px);left:50%;transform:translateX(-50%);z-index:30;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--surface);color:var(--brand-strong);box-shadow:0 2px 10px #153c281c;pointer-events:none}.ring{width:18px;height:18px;border:2px solid var(--line-2);border-top-color:var(--brand-strong);border-radius:50%}.rotating .ring{animation:spin .8s linear infinite}.failed{color:var(--cinnabar)}.label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.rotating .ring{animation:none}}
</style>
