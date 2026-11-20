<script setup lang="ts">
import Icon from './Icon.vue'
defineProps<{ value: string; lines: ReadonlyArray<{id:string;name:string}>; disabled?: boolean }>()
defineEmits<{ change: [value: string] }>()
</script>
<template>
  <div class="line-choices" role="radiogroup" aria-label="下载线路">
    <button v-for="line in lines" :key="line.id" class="line-choice" :class="{selected:value===line.id}" role="radio" :aria-checked="value===line.id" :disabled="disabled" @click="$emit('change',line.id)">
      <span><strong>{{ line.name }}</strong><small>{{ line.id==='github' ? '仓库原始文件 · 默认线路' : line.id==='pages' ? '仓库托管页面 · 原始线路的备用' : '第三方 CDN · 仅手动选择时使用' }}</small></span><span class="line-check"><Icon v-if="value===line.id" name="check" :size="13" /></span>
    </button>
  </div>
</template>
<style scoped>
.line-choices{display:grid;gap:8px;margin:10px 0 14px}.line-choice{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;min-height:66px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);text-align:left}.line-choice.selected{border-color:var(--tint);background:var(--tint-softer)}.line-choice strong{font-size:13px;font-weight:600;line-height:1.5;display:block}.line-choice small{font-size:10px;line-height:1.6;margin-top:3px;color:var(--ink-3);display:block}.line-check{display:grid;place-items:center;flex:none;width:20px;height:20px;border:1.5px solid var(--line-2);border-radius:50%;color:var(--surface)}.selected .line-check{border-color:var(--brand-strong);background:var(--brand-strong)}.line-choice:focus-visible{outline:2px solid var(--brand-strong);outline-offset:2px}
</style>
