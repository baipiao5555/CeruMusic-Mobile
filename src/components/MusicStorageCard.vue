<script setup lang="ts">
import { onMounted } from 'vue'
import { Capacitor } from '@capacitor/core'
import Icon from './Icon.vue'
import { musicFoldersState as folders, refreshMusicFolders, pickMusicFolder, removeScanFolder, resetDownloadFolder } from '@/core/local/folders'
defineProps<{ showScan?: boolean }>()
const emit = defineEmits<{ scanChanged: [] }>()
async function pickScan(): Promise<void> { if (await pickMusicFolder('scan')) emit('scanChanged') }
async function remove(uri: string): Promise<void> { if (await removeScanFolder(uri)) emit('scanChanged') }
onMounted(refreshMusicFolders)
</script>
<template>
  <section v-if="Capacitor.isNativePlatform()" class="music-storage" aria-label="音乐文件夹设置">
    <div v-if="showScan" class="storage-block">
      <div class="storage-title"><span><Icon name="folder" :size="17" /><strong>扫描文件夹</strong></span><button :disabled="folders.busy" @click="pickScan">{{ folders.busy ? '选择中…' : '添加文件夹' }}<Icon name="plus" :size="15" /></button></div>
      <p v-if="!folders.folders.length" class="storage-note">可指定音乐目录，包含子文件夹；不用扫描整个手机。</p>
      <div v-for="folder in folders.folders" :key="folder.uri" class="storage-folder"><div><span>{{ folder.label }}</span><small v-if="!folder.available" class="storage-error">授权已失效，请重新选择</small></div><button :disabled="folders.busy" :aria-label="'移除扫描文件夹 '+folder.label" @click="remove(folder.uri)"><Icon name="close" :size="16" /></button></div>
    </div>
    <div class="storage-block">
      <div class="storage-title"><span><Icon name="download" :size="17" /><strong>下载保存位置</strong></span><button :disabled="folders.busy" @click="pickMusicFolder('download')">选择文件夹<Icon name="chevron" :size="15" /></button></div>
      <p class="storage-path" :class="{'storage-error': !folders.download.available}">{{ folders.download.label }}</p>
      <div class="storage-foot"><small>{{ !folders.download.available ? '下载前请重新选择有写入授权的文件夹' : folders.download.isDefault ? '共享音乐目录，可在文件管理器中找到' : '新的下载保存到这里，已有文件不会移动' }}</small><button v-if="!folders.download.isDefault" :disabled="folders.busy" @click="resetDownloadFolder">恢复默认</button></div>
    </div>
    <p v-if="folders.error" class="storage-error" role="status">{{ folders.error }}</p>
  </section>
</template>
<style scoped>
.music-storage{margin:14px var(--pad);border:1px solid var(--line);border-radius:16px;background:var(--surface);overflow:hidden}
.storage-block{padding:9px 14px 12px}.storage-block+.storage-block{border-top:1px solid var(--line)}
.storage-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.storage-title>span{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px}.storage-title .i{color:var(--brand-strong)}
.storage-title button,.storage-foot button{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:44px;padding:0 0 0 8px;font-size:12px;color:var(--brand-strong);white-space:nowrap}
.storage-note,.storage-path{margin:0;font-size:12px;line-height:1.6;color:var(--ink-3);overflow-wrap:anywhere}.storage-path{color:var(--ink-2);user-select:text}
.storage-folder{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 0;font-size:12px;color:var(--ink-2)}.storage-folder>div{min-width:0;overflow-wrap:anywhere}.storage-folder small{display:block}.storage-folder button{display:grid;place-items:center;min-width:44px;min-height:44px;flex:none;color:var(--ink-3)}
.storage-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}.storage-foot small{font-size:10px;line-height:1.5;color:var(--ink-3)}.storage-foot button{min-height:32px;font-size:10px}.storage-error{font-size:12px;color:var(--cinnabar);line-height:1.6;margin:6px 14px 12px}.storage-folder .storage-error{margin:3px 0 0}
</style>
