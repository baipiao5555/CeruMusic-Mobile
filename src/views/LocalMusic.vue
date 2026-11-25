<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, reactive, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import MusicStorageCard from '@/components/MusicStorageCard.vue'
import { musicFoldersState, refreshMusicFolders, pickMusicFolder } from '@/core/local/folders'
import { DEFAULT_MUSIC_FILTER, MUSIC_FILTER_KEY, normalizeMusicFilter, filterLocalMusic } from '@/core/local/musicFilter'
import { downloadState, isLegacyDownload } from '@/core/downloads'
import { playTracks } from '@/core/playback/player'
import type { Track } from '@/core/track'
import {
  localEntryToTrack,
  localScanState,
  scanLocalMusic,
  type LocalEntry
} from '@/core/local/media'
import { useListWindow } from '@/core/ui/listWindow'
import { rememberTracks } from '@/core/search'

const router = useRouter()

const rawEntries = ref<LocalEntry[]>([])
let savedFilter: any
try { savedFilter=JSON.parse(localStorage.getItem(MUSIC_FILTER_KEY)||'null') } catch { /* Invalid preferences use safe defaults. */ }
const musicFilter=reactive(normalizeMusicFilter(savedFilter))
const scanResult=computed(()=>filterLocalMusic(rawEntries.value,musicFilter))
const entries=computed(()=>scanResult.value.items)
const tracks=computed<Track[]>(()=>entries.value.map(localEntryToTrack))
const settingsOpen=ref(false)
watch(musicFilter,value=>localStorage.setItem(MUSIC_FILTER_KEY,JSON.stringify(value)),{deep:true})
const keyword = ref('')
const scanning = ref(false)
const scanned = ref(false)
const denied = ref(false)
const webOnly = ref(false)
const scanError = ref('')
// Global enumeration is always an explicit action, including after upgrading from v6.
const source = ref<'all' | 'folders'>('folders')
const SNAPSHOT_KEY = 'ceru.localMusic.snapshot.v2'
const SNAPSHOT_TTL = 5 * 60 * 1000
let snapshotAt = 0
let snapshotFingerprint = ''
interface LocalSnapshot { source?: string; entries?: LocalEntry[]; savedAt?: number; fingerprint?: string }

function fingerprint(): string {
  return JSON.stringify([
    musicFoldersState.folders.map(folder => [folder.uri, folder.available]).sort(),
    musicFoldersState.download.uri,
    musicFoldersState.download.available,
    downloadState.tasks.filter(task => task.status === 'completed').map(task => [task.path, task.size]).sort()
  ])
}

try {
  const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') as LocalSnapshot | null
  if (Capacitor.isNativePlatform() && saved && Array.isArray(saved.entries) && saved.entries.length <= 10000 &&
      saved.entries.every(entry => entry && typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.artist === 'string') &&
      Number.isFinite(saved.savedAt) && typeof saved.fingerprint === 'string') {
    if (saved.source === 'all' || saved.source === 'folders') source.value = saved.source
    rawEntries.value = saved.entries
    snapshotAt = Number(saved.savedAt)
    snapshotFingerprint = saved.fingerprint
    scanned.value = true
  }
} catch {}
const hasFolders = computed(() => musicFoldersState.folders.length > 0 || !musicFoldersState.download.isDefault)
const legacyCount = computed(() => downloadState.tasks.filter(isLegacyDownload).length)
let scanSeq = 0

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return tracks.value
  return tracks.value.filter(
    (track) =>
      track.title.toLowerCase().includes(needle) || track.artist.toLowerCase().includes(needle)
  )
})
const {
  items: visibleTracks,
  hasMore,
  remaining,
  showMore
} = useListWindow(filtered)

const totalLabel = computed(() => {
  if (scanning.value) return '正在扫描…'
  if (!scanned.value) return '还没有扫描'
  if (!entries.value.length) return '没有找到歌曲'
  return `${entries.value.length} 首 · ${formatSize(entries.value.reduce((sum, item) => sum + (item.size || 0), 0))}`
})

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

async function scan(requestPermission = true, silent = false): Promise<void> {
  const seq = ++scanSeq
  if (!Capacitor.isNativePlatform()) {
    webOnly.value = true
    scanned.value = true
    return
  }
  if (!silent) scanning.value = true
  denied.value = false
  scanError.value = ''
  try {
    const found = await scanLocalMusic({ source: source.value, requestPermission })
    if (seq !== scanSeq) return
    denied.value = source.value === 'all' && !localScanState.granted
    scanError.value = localScanState.error
    if (scanError.value) return // partial/error results must not overwrite a known-good snapshot
    snapshotAt = Date.now()
    snapshotFingerprint = fingerprint()
    rawEntries.value = found
    rememberTracks(tracks.value)
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ source: source.value, entries: rawEntries.value, savedAt: snapshotAt, fingerprint: snapshotFingerprint }))
    } catch {}
  } finally {
    if (seq === scanSeq) {
      if (!silent) scanning.value = false
      scanned.value = true
    }
  }
}

function playAll(): void {
  if (!filtered.value.length) return
  void playTracks(filtered.value)
}

function playIndex(index: number): void {
  void playTracks(filtered.value, index)
}

async function chooseSource(value: 'all' | 'folders'): Promise<void> {
  source.value = value; await scan(value === 'all')
}
function foldersChanged(): void { source.value = 'folders'; void scan(false) }
async function chooseFolder(mode: 'scan' | 'download'): Promise<void> { if (await pickMusicFolder(mode)) { if(mode==='scan')foldersChanged();else if(source.value==='folders')void scan(false) } }
onMounted(async () => {
  await refreshMusicFolders()
  if (!scanned.value || snapshotFingerprint !== fingerprint()) {
    source.value = 'folders'
    await scan(false, scanned.value)
  } else if (source.value === 'folders' && Date.now() - snapshotAt > SNAPSHOT_TTL) {
    await scan(false, true)
  }
})
onBeforeUnmount(() => { scanSeq++ })
</script>

<template>
  <div class="screen">
    <div class="scroll safe-t-lg local-scroll">
      <header class="local-head">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="20" /></button>
        <h1>本机音乐</h1>
        <button class="iconbtn quiet" aria-label="重新扫描" :disabled="scanning" @click="scan()"><Icon name="refresh" :size="20" /></button>
      </header>
      <div class="local-workspace"><section class="local-overview">
      <div class="local-summary"><span>{{ totalLabel }}</span><button class="btn btn-primary btn-sm" :disabled="!filtered.length" @click="playAll"><Icon name="play" :size="14" />播放全部</button></div>
      <div class="local-actions" aria-label="本地音乐功能"><button :disabled="musicFoldersState.busy" @click="chooseFolder('scan')"><Icon name="folder" :size="18" />扫描文件夹</button><button :disabled="musicFoldersState.busy" @click="chooseFolder('download')"><Icon name="download" :size="18" />下载位置</button></div>
      <div class="local-control"><span>{{ source==='folders' ? (hasFolders ? '应用下载 + 已选音乐文件夹' : '仅显示应用下载 · 可添加音乐文件夹') : '系统授权可见的媒体库音频' }}</span><button @click="settingsOpen=true"><Icon name="settings" :size="14" />扫描设置</button></div>
      <div v-if="legacyCount" class="legacy-download-note"><span>{{ legacyCount }} 首旧版下载保存在应用目录，文件管理器可能隐藏。</span><button @click="router.push('/downloads')">查看并导出<Icon name="chevron" :size="13" /></button></div>
      <div v-if="!webOnly" class="scan-source-tabs" aria-label="扫描范围"><button :class="{active:source==='folders'}" :aria-pressed="source==='folders'" :disabled="scanning" @click="chooseSource('folders')">局部扫描</button><button :class="{active:source==='all'}" :aria-pressed="source==='all'" :disabled="scanning" @click="chooseSource('all')">全局扫描</button><button class="filter-count" @click="settingsOpen=true">{{ musicFilter.mode==='all' ? '全部音频' : scanResult.hidden.length ? '已过滤 '+scanResult.hidden.length+' 项' : '音乐优先' }}</button></div>

      <div class="searchbar">
        <Icon name="search" :size="17" />
        <input v-model="keyword" type="search" placeholder="在本机音乐里找歌" />
        <button v-if="keyword" class="clear" aria-label="清空" @click="keyword = ''">
          <Icon name="close" :size="14" />
        </button>
      </div>

      </section><section class="local-results">
      <div v-if="webOnly" class="empty">
        <div class="glyph"><Icon name="music" :size="32" /></div>
        <h3>本机音乐只在手机上可用</h3>
        <p>装到手机后，可读取媒体库或选择音乐文件夹。</p>
      </div>

      <div v-else-if="denied && !tracks.length" class="empty">
        <div class="glyph"><Icon name="music" :size="32" /></div>
        <h3>需要读取本机音乐的权限</h3>
        <p>应用下载不需要此权限；读取手机其他音频需要授权。只读扫描，不改动文件。</p>
        <button class="btn btn-tonal mt14" @click="scan()">重新授权</button>
      </div>

      <div v-else-if="scanning && !tracks.length" class="scan-hint">
        <span class="spin" />
        正在读取媒体库…
      </div>

      <div v-else-if="scanned && !entries.length" class="empty">
        <div class="glyph"><Icon name="folder" :size="32" /></div>
        <h3>{{ rawEntries.length ? '音频已被筛选隐藏' : '没有扫描到歌曲' }}</h3>
        <p>{{ rawEntries.length ? '可在扫描设置中显示全部音频，不会删除文件。' : '局部扫描只读取应用下载与已选文件夹；可以添加音乐目录或手动全局扫描。' }}</p>
        <button v-if="rawEntries.length" class="btn btn-tonal" @click="musicFilter.mode='all'">显示全部音频</button>
        <button class="btn btn-ghost mt14" @click="scan()">再扫一次</button>
      </div>

      <div v-else-if="!filtered.length" class="empty">
        <div class="glyph"><Icon name="search" :size="30" /></div>
        <h3>没有匹配的歌</h3>
        <p>换个关键词试试。</p>
      </div>

      <div v-else class="song-list">
        <div v-if="denied" class="notice">已显示应用下载；授权后还可扫描手机其他音频。
          <button class="btn btn-ghost btn-sm" @click="scan()">授权并重新扫描</button>
        </div>
        <SongRow
          v-for="(track, index) in visibleTracks"
          :key="track.id"
          :track="track"
          :index="index"
          :queue="filtered"
          @play="playIndex(index)"
        />
        <button v-if="hasMore" class="btn btn-ghost btn-block list-more" @click="showMore">
          显示更多（剩余 {{ remaining }} 首）
        </button>
      </div>
      <div v-if="scanError" class="pad mt14"><div class="notice error">{{ scanError }}</div></div>
      </section></div>
    </div>
    <Teleport to="body"><div v-if="settingsOpen" class="sheet-mask local-settings-mask" @click.self="settingsOpen=false"><div class="scrim" @click="settingsOpen=false" /><section class="sheet local-settings" role="dialog" aria-modal="true" aria-label="扫描设置"><div class="grab" /><div class="sh-head"><strong class="sh-title">扫描设置</strong><button class="iconbtn quiet" aria-label="关闭扫描设置" @click="settingsOpen=false"><Icon name="close" :size="18" /></button></div>
      <p class="filter-help">局部扫描：应用下载与已选目录。全局扫描：系统授权可见的媒体库，不读取其他应用的私有文件。</p>
      <div class="filter-mode"><button :class="{on:musicFilter.mode==='music'}" @click="musicFilter.mode='music'">音乐优先</button><button :class="{on:musicFilter.mode==='all'}" @click="musicFilter.mode='all'">显示全部音频</button></div>
      <template v-if="musicFilter.mode==='music'"><button class="filter-option" role="checkbox" :aria-checked="musicFilter.excludeRecordings" @click="musicFilter.excludeRecordings=!musicFilter.excludeRecordings"><span>过滤疑似录音<small>系统录音标记、录音目录、号码 + 日期文件名</small></span><span class="filter-check" :class="{on:musicFilter.excludeRecordings}"><Icon v-if="musicFilter.excludeRecordings" name="check" :size="13" /></span></button><button class="filter-option" role="checkbox" :aria-checked="musicFilter.excludeTones" @click="musicFilter.excludeTones=!musicFilter.excludeTones"><span>过滤提示音 / 铃声<small>系统分类及铃声、通知、闹钟目录</small></span><span class="filter-check" :class="{on:musicFilter.excludeTones}"><Icon v-if="musicFilter.excludeTones" name="check" :size="13" /></span></button><div class="duration-options"><span>短音频过滤</span><button v-for="seconds in [0,30,60]" :key="seconds" :class="{on:musicFilter.minSeconds===seconds}" @click="musicFilter.minSeconds=seconds">{{ seconds ? seconds+' 秒以下' : '不限制' }}</button></div></template>
      <p class="filter-help">已过滤 {{ scanResult.counts.recording }} 项疑似录音、{{ scanResult.counts.tone }} 项提示音、{{ scanResult.counts.short }} 项短音频。只影响本页显示，不删除文件；应用下载与未知时长不会被短音频规则误过滤。</p>
      <MusicStorageCard show-scan @scan-changed="foldersChanged" />
      <button class="btn btn-ghost btn-block" @click="Object.assign(musicFilter,DEFAULT_MUSIC_FILTER)">恢复默认筛选</button><button class="btn btn-primary btn-block" @click="settingsOpen=false">完成</button>
    </section></div></Teleport>
  </div>
</template>

<style scoped>
.local-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px var(--pad) 3px}.local-actions button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 12px;background:var(--tint-soft);color:var(--brand-strong);border-radius:14px;font-size:13px;font-weight:600}.local-actions button:last-child{background:var(--surface-2);color:var(--ink-2)}
.local-control{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 var(--pad) 4px;color:var(--ink-3);font-size:10px;line-height:1.6}.local-control>span{flex:1;min-width:0}.local-control button{display:flex;align-items:center;gap:4px;min-height:44px;white-space:nowrap;color:var(--ink-3)}.filter-count{margin-left:auto;font-size:10px!important;white-space:nowrap}
.local-settings{max-height:85vh;max-height:85dvh;overflow:auto;padding-bottom:calc(18px + env(safe-area-inset-bottom))}.local-settings>.btn{margin:8px var(--pad);width:calc(100% - var(--pad)*2)}.filter-help{margin:0 var(--pad) 16px;font-size:12px;line-height:1.65;color:var(--ink-3)}.filter-mode{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 var(--pad) 16px;padding:4px;border-radius:12px;background:var(--surface-2)}.filter-mode button{display:flex;align-items:center;justify-content:center;min-height:44px;padding:10px 8px;text-align:center;line-height:1.4;font-size:13px;border-radius:9px;color:var(--ink-3)}.filter-mode .on{background:var(--surface);color:var(--brand-strong);font-weight:650}.filter-option{display:flex;align-items:center;justify-content:space-between;width:calc(100% - var(--pad)*2);margin:0 var(--pad);gap:12px;min-height:62px;border-bottom:1px solid var(--line);text-align:left;font-size:13px}.filter-option small{display:block;font-size:10px;color:var(--ink-3);margin-top:5px}.filter-check{display:grid;place-items:center;width:22px;height:22px;flex:none;border:1px solid var(--line-2);border-radius:6px}.filter-check.on{color:var(--surface);background:var(--brand-strong);border-color:var(--brand-strong)}.duration-options{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:12px var(--pad);font-size:11px}.duration-options>span{margin-right:auto}.duration-options button{min-height:44px;padding:0 8px;border-radius:9px;color:var(--ink-3)}.duration-options .on{background:var(--tint-soft);color:var(--brand-strong)}

.local-head{display:flex;align-items:center;gap:8px;padding:4px 12px 0;min-height:52px}.local-head h1{flex:1;font:700 22px/1.3 var(--sans);margin:0}.local-head .iconbtn{width:44px;height:44px;flex:none}
.local-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px var(--pad) 0;color:var(--ink-3);font-size:12px}.local-summary .btn{min-height:44px;padding:0 15px;font-size:12px}
.scan-source-tabs{display:flex;gap:8px;padding:0 var(--pad)}.scan-source-tabs button{min-height:44px;padding:0 13px;border-radius:24px;color:var(--ink-3);font-size:12px}.scan-source-tabs .active{background:var(--tint-soft);color:var(--brand-strong);font-weight:650}.scan-source-tabs button:disabled:not(.active){opacity:.45}
.song-list{padding:0 var(--pad)}.song-list :deep(.songrow){min-height:70px;gap:12px;padding:7px 0}.song-list :deep(.cover){width:46px;height:46px;flex:none}.song-list :deep(.t){font-size:14px}.song-list :deep(.a){font-size:12px}.song-list :deep(.songrow .more){width:36px;min-height:44px}
.legacy-download-note{display:flex;align-items:center;gap:8px;margin:0 var(--pad) 10px;font-size:11px;line-height:1.6;color:var(--ink-3)}.legacy-download-note span{flex:1;min-width:0}.legacy-download-note button{display:inline-flex;align-items:center;gap:3px;min-height:44px;color:var(--brand-strong);white-space:nowrap}

.navrow {
  display: flex;
  justify-content: space-between;
  padding: 6px var(--pad) 0;
}
.phead {
  align-items: flex-end;
}
.list-more {
  margin: 14px 0 4px;
}
.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px var(--pad) 8px;
  padding: 0 12px;
  height: 42px;
  border-radius: 14px;
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
  color: var(--ink-3);
}
.searchbar input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink-1);
  font-size: 14px;
  outline: none;
}
.searchbar input::placeholder {
  color: var(--ink-4);
}
.clear {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: var(--ink-3);
}
.scan-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 26px var(--pad);
  font-size: 13px;
  color: var(--ink-3);
}
.spin {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: var(--tint);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media(min-width:768px){
  .local-head{padding:4px var(--pad);max-width:1040px;margin:0 auto}
  .local-workspace{display:grid;grid-template-columns:300px minmax(0,1fr);gap:26px;padding:10px var(--pad) 0;max-width:1040px;margin:0 auto}
  .local-overview{position:sticky;top:16px;align-self:start;min-width:0}
  .local-summary,.scan-source-tabs{padding-left:0;padding-right:0}.local-actions,.local-control,.legacy-download-note,.searchbar{margin-left:0;margin-right:0}
  .local-results{min-width:0}.local-results .song-list{padding:0}.local-results .empty{min-height:280px}
  .local-settings-mask{align-items:center;padding:24px}.local-settings{width:min(100%,640px);border-radius:24px;max-height:calc(100vh - 48px);max-height:calc(100dvh - 48px)}
}
</style>
