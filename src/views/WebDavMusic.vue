<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { secureStore, type SecureStoreStatus } from '@/core/native/secureStore'
import { listConnections, type WebDavConnection } from '@/core/sync/webdav'
import {
  WEBDAV_MEDIA_MAX_DEPTH,
  importWebDavMusic,
  scanWebDavMusic,
  webDavFileToTrack,
  type WebDavMediaFile,
  type WebDavScanResult
} from '@/core/sync/webdavMedia'
import { libraryState, type PlaylistImportResult } from '@/core/library'
import { playTracks } from '@/core/playback/player'

const router = useRouter()
const connections = ref<WebDavConnection[]>(listConnections())
const selectedId = ref(connections.value[0]?.id || '')
const selected = computed(() => connections.value.find(item => item.id === selectedId.value))
const directory = ref('')
const maxDepth = ref(1)
const scanning = ref(false)
const scanResult = ref<WebDavScanResult>()
const selectedIds = ref<string[]>([])
const keyword = ref('')
const target = ref('new')
const newName = ref('')
const importing = ref(false)
const lastImport = ref<PlaylistImportResult>()
const store = ref<SecureStoreStatus>()
const error = ref('')
const message = ref('')
const progress = ref('')

const files = computed(() => scanResult.value?.files || [])
const selectedSet = computed(() => new Set(selectedIds.value))
const selectedFiles = computed(() => files.value.filter(file => selectedSet.value.has(file.id)))
const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return files.value
  return files.value.filter(file =>
    file.displayName.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle)
  )
})
const allFilteredSelected = computed(() => {
  const visible = filtered.value
  return Boolean(visible.length) && visible.every(file => selectedSet.value.has(file.id))
})
const scanSummary = computed(() => {
  const result = scanResult.value
  if (!result) return ''
  const parts = [`${result.files.length} 首`, `${result.directories} 个目录`, `最多 ${result.maxDepth} 层`]
  if (result.skipped) parts.push(`跳过 ${result.skipped} 个无效/越界条目`)
  if (result.truncated) parts.push('已达到扫描上限')
  return parts.join(' · ')
})

watch(selectedId, () => {
  scanResult.value = undefined
  selectedIds.value = []
  keyword.value = ''
  lastImport.value = undefined
  error.value = ''
  message.value = ''
})

watch(() => libraryState.playlists.map(item => item.id).join('|'), () => {
  if (target.value !== 'new' && !libraryState.playlists.some(item => item.id === target.value)) target.value = 'new'
})

onMounted(async () => {
  try {
    store.value = await secureStore.status()
  } catch {
    error.value = '安全仓库不可用，无法读取 WebDAV 凭据。请更新客户端后重试。'
  }
})

async function scan(): Promise<void> {
  const connection = selected.value
  if (!connection || scanning.value) return
  const owner = connection.id
  scanning.value = true
  error.value = ''
  message.value = ''
  progress.value = '正在连接 WebDAV 专用目录…'
  scanResult.value = undefined
  selectedIds.value = []
  keyword.value = ''
  lastImport.value = undefined
  try {
    const result = await scanWebDavMusic(connection, {
      directory: directory.value,
      maxDepth: maxDepth.value,
      onProgress: state => {
        progress.value = `正在读取 ${state.current || '专用目录'} · 已发现 ${state.files} 首`
      }
    })
    if (selectedId.value !== owner) return
    scanResult.value = result
    selectedIds.value = result.files.map(file => file.id)
    newName.value = `WebDAV · ${connection.name}${result.directory ? ` · ${result.directory.split('/').pop()}` : ''}`.slice(0, 80)
    message.value = result.files.length
      ? `扫描完成：找到 ${result.files.length} 首音频。`
      : '此目录没有找到常见格式的音频文件。'
  } catch (reason: any) {
    error.value = reason?.message || 'WebDAV 目录扫描失败'
  } finally {
    scanning.value = false
    progress.value = ''
  }
}

function toggle(id: string): void {
  const index = selectedIds.value.indexOf(id)
  if (index >= 0) selectedIds.value.splice(index, 1)
  else selectedIds.value.push(id)
}

function toggleAll(): void {
  const visible = filtered.value
  if (!visible.length) return
  if (allFilteredSelected.value) {
    const visibleIds = new Set(visible.map(file => file.id))
    selectedIds.value = selectedIds.value.filter(id => !visibleIds.has(id))
    return
  }
  const next = new Set(selectedIds.value)
  for (const file of visible) next.add(file.id)
  selectedIds.value = [...next]
}

function queueFor(items: WebDavMediaFile[]): ReturnType<typeof webDavFileToTrack>[] {
  const connection = selected.value
  if (!connection) return []
  return items.map(file => webDavFileToTrack(file, connection))
}

function play(file: WebDavMediaFile): void {
  const connection = selected.value
  if (!connection) return
  const queue = filtered.value
  const index = queue.findIndex(item => item.id === file.id)
  void playTracks(queueFor(queue), index < 0 ? 0 : index).catch(reason => {
    error.value = reason?.message || 'WebDAV 曲目播放失败'
  })
}

function playSelected(): void {
  const items = selectedFiles.value
  if (!items.length) return
  void playTracks(queueFor(items)).catch(reason => {
    error.value = reason?.message || 'WebDAV 曲目播放失败'
  })
}

async function importSelected(): Promise<void> {
  const connection = selected.value
  const items = selectedFiles.value
  if (!connection || !items.length || importing.value) return
  importing.value = true
  error.value = ''
  message.value = ''
  try {
    const mode = target.value === 'new' ? 'new' : 'merge'
    const result = importWebDavMusic(items, {
      connectionName: connection.name,
      mode,
      name: newName.value,
      ...(mode === 'merge' ? { targetId: target.value } : {})
    })
    lastImport.value = result
    const playlist = target.value === 'new'
      ? libraryState.playlists.find(item => item.id === result.playlistIds[0])
      : libraryState.playlists.find(item => item.id === target.value)
    message.value = `已添加 ${result.importedTracks} 首到「${playlist?.name || newName.value || '本机歌单'}」` +
      (result.skippedTracks ? `，跳过 ${result.skippedTracks} 首重复曲目。` : '。')
    if (target.value === 'new') target.value = result.playlistIds[0] || 'new'
  } catch (reason: any) {
    error.value = reason?.message || '添加到本机歌单失败'
  } finally {
    importing.value = false
  }
}

function undoImport(): void {
  const result = lastImport.value
  if (!result) return
  try {
    result.undo()
    lastImport.value = undefined
    target.value = 'new'
    message.value = '已撤销本次添加到歌单。远端文件没有变化。'
  } catch (reason: any) {
    error.value = reason?.message || '撤销失败，歌单已有其他改动'
  }
}

function displayTitle(file: WebDavMediaFile): string {
  const name = file.displayName || file.path.slice(file.path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

function formatDate(value?: number): string {
  if (!value) return ''
  try {
    const date = new Date(value)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  } catch {
    return ''
  }
}
</script>

<template>
  <div class="screen webdav-page">
    <div class="scroll safe-t">
      <header class="wd-header">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <div class="wd-head-copy">
          <div class="wd-eyebrow">CERU MUSIC · WEBDAV</div>
          <h1>WebDAV 音乐库</h1>
          <p>扫描已授权目录，预览并把远端音频加入本机歌单。</p>
        </div>
      </header>

      <main class="wd-layout">
        <section class="wd-main">
          <div v-if="!connections.length" class="wd-empty">
            <div class="wd-empty-icon"><Icon name="cloud" :size="30" /></div>
            <h2>还没有 WebDAV 连接</h2>
            <p>先在同步服务里保存并确认一个 WebDAV 专用目录，再回来扫描音乐。</p>
            <button class="wd-primary" @click="router.push('/sync-services')">去配置 WebDAV</button>
          </div>

          <template v-else>
            <section class="wd-panel">
              <div class="wd-panel-head">
                <div>
                  <h2>选择目录</h2>
                  <p>只读取连接已授权的专用目录，不访问上级目录或跟随重定向。</p>
                </div>
                <span class="wd-badge">{{ maxDepth }} 层</span>
              </div>

              <div class="wd-fields">
                <label class="wd-field">
                  <span>WebDAV 连接</span>
                  <select v-model="selectedId" :disabled="scanning">
                    <option v-for="connection in connections" :key="connection.id" :value="connection.id">
                      {{ connection.name }}
                    </option>
                  </select>
                </label>
                <label class="wd-field wd-field-wide">
                  <span>扫描目录</span>
                  <input
                    v-model="directory"
                    :disabled="scanning"
                    maxlength="2048"
                    autocomplete="off"
                    placeholder="留空扫描专用目录，例如 Music/Live"
                    @keyup.enter="scan"
                  />
                </label>
                <label class="wd-field wd-field-depth">
                  <span>扫描层级</span>
                  <select v-model.number="maxDepth" :disabled="scanning">
                    <option v-for="depth in WEBDAV_MEDIA_MAX_DEPTH" :key="depth" :value="depth">
                      {{ depth }} 层
                    </option>
                  </select>
                </label>
              </div>

              <p class="wd-endpoint" v-if="selected">{{ selected.origin }}{{ selected.basePath }}</p>
              <button class="wd-primary wd-scan" :disabled="scanning || !selected" @click="scan">
                <Icon :name="scanning ? 'refresh' : 'search'" :size="17" />
                {{ scanning ? '正在扫描…' : '扫描目录' }}
              </button>
              <p v-if="progress" class="wd-progress" role="status">{{ progress }}</p>
            </section>

            <p v-if="error" class="wd-alert" role="alert">{{ error }}</p>
            <p v-if="message" class="wd-notice" role="status">{{ message }}</p>

            <section v-if="scanResult" class="wd-panel wd-results">
              <div class="wd-results-head">
                <div>
                  <h2>远端曲目</h2>
                  <p>{{ scanSummary }}</p>
                </div>
                <div class="wd-result-actions">
                  <button class="wd-secondary" :disabled="!selectedFiles.length" @click="playSelected">
                    <Icon name="play" :size="15" /> 播放所选
                  </button>
                  <button class="wd-secondary" :disabled="!files.length" @click="toggleAll">
                    {{ allFilteredSelected ? '取消全选' : '全选' }}
                  </button>
                </div>
              </div>

              <div class="wd-search" v-if="files.length">
                <Icon name="search" :size="16" />
                <input v-model="keyword" type="search" placeholder="按文件名或路径筛选" />
                <button v-if="keyword" aria-label="清空筛选" @click="keyword = ''">
                  <Icon name="close" :size="13" />
                </button>
              </div>

              <div v-if="!files.length" class="wd-empty compact">
                <div class="wd-empty-icon"><Icon name="folder" :size="26" /></div>
                <h3>没有找到音频</h3>
                <p>确认目录里有 mp3 / flac / m4a / ogg / opus / wav 等常见音频，或把扫描层级调高。</p>
              </div>
              <div v-else-if="!filtered.length" class="wd-empty compact">
                <h3>没有匹配的曲目</h3>
                <p>换个关键词试试。</p>
              </div>

              <div v-else class="wd-list">
                <div v-for="file in filtered" :key="file.id" class="wd-row" :class="{ selected: selectedSet.has(file.id) }">
                  <label class="wd-check">
                    <input
                      type="checkbox"
                      :checked="selectedSet.has(file.id)"
                      :aria-label="`选择 ${displayTitle(file)}`"
                      @change="toggle(file.id)"
                    />
                    <span class="wd-check-box" aria-hidden="true">
                      <Icon v-if="selectedSet.has(file.id)" name="check" :size="11" />
                    </span>
                  </label>
                  <button class="wd-row-main" @click="play(file)">
                    <strong>{{ displayTitle(file) }}</strong>
                    <small>{{ file.path }}</small>
                  </button>
                  <span class="wd-size">
                    <span v-if="file.extension" class="wd-ext">{{ file.extension.toUpperCase() }}</span>
                    <span>{{ formatSize(file.size) }}</span>
                    <span>{{ formatDate(file.lastModified) }}</span>
                  </span>
                  <button class="wd-play" :aria-label="`播放 ${displayTitle(file)}`" @click="play(file)">
                    <Icon name="play" :size="15" />
                  </button>
                </div>
              </div>
            </section>
          </template>
        </section>

        <aside v-if="connections.length" class="wd-side">
          <section class="wd-panel">
            <div class="wd-panel-head">
              <div>
                <h2>添加到本机歌单</h2>
                <p>只保存远端连接标识和路径，不保存密码或音频文件。</p>
              </div>
            </div>
            <div class="wd-import-count">
              <strong>{{ selectedFiles.length }}</strong>
              <span>首已选择</span>
            </div>
            <label class="wd-field">
              <span>目标歌单</span>
              <select v-model="target" :disabled="importing">
                <option value="new">新建歌单</option>
                <option v-for="playlist in libraryState.playlists" :key="playlist.id" :value="playlist.id">
                  {{ playlist.name }}
                </option>
              </select>
            </label>
            <label v-if="target === 'new'" class="wd-field">
              <span>歌单名称</span>
              <input v-model="newName" maxlength="80" :disabled="importing" placeholder="WebDAV 歌单" />
            </label>
            <button class="wd-primary" :disabled="!selectedFiles.length || importing" @click="importSelected">
              <Icon name="plus" :size="17" />
              {{ importing ? '正在添加…' : `添加 ${selectedFiles.length} 首` }}
            </button>
            <button v-if="lastImport" class="wd-text-button" @click="undoImport">撤销本次添加</button>
            <p class="wd-store-hint">
              {{ store?.persistent ? '凭据由 Android Keystore 加密保存' : 'Web 版凭据仅在本次会话保留，重开后需重新配置' }}
            </p>
          </section>

          <section class="wd-note">
            <h3>播放限制</h3>
            <p>WebDAV 音频需要 Basic Authorization。浏览器和现有播放器会先把整首文件下载为本地 blob，再交给音频元素播放，因此不是边下边播；大文件需要等待，未下载完成前不能拖动进度。</p>
            <p>播放仍取决于服务端 CORS、证书和网络可达性；HTTPS 页面不能连接 HTTP。</p>
          </section>
        </aside>
      </main>
    </div>
  </div>
</template>

<style scoped>
.webdav-page {
  min-height: 100%;
}
.wd-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px var(--pad) 14px;
}
.wd-head-copy {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}
.wd-eyebrow {
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--ink-4);
}
.wd-header h1 {
  margin: 3px 0 0;
  font-size: 25px;
  line-height: 1.2;
  font-weight: 760;
  letter-spacing: -0.6px;
}
.wd-header p {
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-3);
}
.wd-layout {
  display: grid;
  gap: 13px;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 var(--pad) 26px;
  box-sizing: border-box;
}
.wd-main,
.wd-side {
  min-width: 0;
}
.wd-side {
  display: grid;
  gap: 12px;
}
.wd-panel {
  padding: 14px;
  border: 1px solid var(--line-2);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--sh-1);
}
.wd-panel + .wd-panel {
  margin-top: 12px;
}
.wd-side .wd-panel + .wd-panel {
  margin-top: 0;
}
.wd-panel-head,
.wd-results-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.wd-panel-head h2,
.wd-results-head h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.35;
  font-weight: 700;
}
.wd-panel-head p,
.wd-results-head p {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.7;
  color: var(--ink-3);
}
.wd-badge {
  flex: none;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--tint-soft);
  color: var(--brand-strong);
  font-size: 10px;
  line-height: 1.2;
}
.wd-fields {
  display: grid;
  gap: 10px;
  margin-top: 13px;
}
.wd-field {
  display: block;
  min-width: 0;
  font-size: 11px;
  color: var(--ink-2);
}
.wd-field > span {
  display: block;
  margin-bottom: 5px;
}
.wd-field input,
.wd-field select {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 9px 11px;
  box-sizing: border-box;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.wd-field input:focus,
.wd-field select:focus {
  border-color: var(--tint);
}
.wd-endpoint {
  margin: 10px 0 0;
  font-size: 9px;
  line-height: 1.6;
  color: var(--ink-4);
  overflow-wrap: anywhere;
}
.wd-primary,
.wd-secondary,
.wd-play,
.wd-text-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  border: 0;
  border-radius: 11px;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
}
.wd-primary {
  width: 100%;
  padding: 10px 14px;
  background: var(--tint);
  color: #fff;
}
.wd-primary:disabled,
.wd-secondary:disabled {
  opacity: 0.46;
}
.wd-scan {
  margin-top: 12px;
}
.wd-secondary {
  padding: 8px 11px;
  border: 1px solid var(--line-2);
  background: var(--surface-2);
  color: var(--ink-2);
}
.wd-result-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.wd-progress,
.wd-alert,
.wd-notice {
  margin: 10px 0 0;
  padding: 9px 11px;
  border-radius: 10px;
  font-size: 10px;
  line-height: 1.75;
}
.wd-progress {
  background: var(--tint-soft);
  color: var(--brand-strong);
}
.wd-alert {
  margin-top: 12px;
  background: rgba(189, 83, 71, 0.1);
  color: var(--cinnabar);
}
.wd-notice {
  margin-top: 12px;
  background: var(--surface-2);
  color: var(--ink-2);
}
.wd-results {
  margin-top: 12px;
}
.wd-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 42px;
  margin-top: 12px;
  padding: 0 11px;
  border-radius: 11px;
  background: var(--surface-2);
  color: var(--ink-4);
}
.wd-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.wd-search button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: var(--line);
  color: var(--ink-3);
}
.wd-list {
  margin-top: 10px;
  border-top: 1px solid var(--line);
}
.wd-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 7px;
  min-height: 58px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.wd-row:last-child {
  border-bottom: 0;
}
.wd-row.selected {
  background: var(--tint-softer);
  border-radius: 9px;
}
.wd-check {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 44px;
  cursor: pointer;
}
.wd-check input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.wd-check-box {
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  border: 1.5px solid var(--line-2);
  border-radius: 50%;
  background: var(--surface);
  color: #fff;
}
.wd-check input:checked + .wd-check-box {
  border-color: var(--tint);
  background: var(--tint);
}
.wd-check input:focus-visible + .wd-check-box {
  outline: 2px solid var(--tint);
  outline-offset: 2px;
}
.wd-row-main {
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
  font: inherit;
}
.wd-row-main strong,
.wd-row-main small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wd-row-main strong {
  font-size: 13px;
  line-height: 1.45;
  font-weight: 650;
}
.wd-row-main small {
  margin-top: 2px;
  font-size: 9px;
  line-height: 1.55;
  color: var(--ink-4);
}
.wd-size {
  display: none;
  min-width: 0;
  color: var(--ink-4);
  font-size: 9px;
  line-height: 1.6;
  text-align: right;
}
.wd-size > span {
  display: block;
}
.wd-ext {
  color: var(--brand-strong);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.wd-play {
  width: 36px;
  height: 36px;
  min-height: 36px;
  border-radius: 50%;
  background: var(--tint-soft);
  color: var(--brand-strong);
}
.wd-empty {
  padding: 36px 20px;
  text-align: center;
  color: var(--ink-3);
}
.wd-empty.compact {
  padding: 24px 10px 12px;
}
.wd-empty-icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin: 0 auto 12px;
  border-radius: 18px;
  background: var(--surface-2);
  color: var(--tint);
}
.wd-empty h2,
.wd-empty h3 {
  margin: 0;
  color: var(--ink);
  font-size: 16px;
  line-height: 1.4;
}
.wd-empty h3 {
  font-size: 14px;
}
.wd-empty p {
  max-width: 420px;
  margin: 7px auto 15px;
  font-size: 11px;
  line-height: 1.8;
}
.wd-import-count {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin: 13px 0 10px;
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--surface-2);
}
.wd-import-count strong {
  font-size: 24px;
  line-height: 1;
  color: var(--brand-strong);
}
.wd-import-count span {
  font-size: 10px;
  color: var(--ink-3);
}
.wd-side .wd-field {
  margin-top: 10px;
}
.wd-side .wd-primary {
  margin-top: 12px;
}
.wd-text-button {
  width: 100%;
  margin-top: 7px;
  background: transparent;
  color: var(--ink-3);
  font-size: 11px;
}
.wd-store-hint {
  margin: 8px 0 0;
  font-size: 9px;
  line-height: 1.7;
  color: var(--ink-4);
  text-align: center;
}
.wd-note {
  padding: 13px 14px;
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink-3);
}
.wd-note h3 {
  margin: 0 0 6px;
  color: var(--ink-2);
  font-size: 12px;
}
.wd-note p {
  margin: 5px 0;
  font-size: 10px;
  line-height: 1.8;
}

@media (min-width: 520px) {
  .wd-fields {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  }
  .wd-fields > .wd-field:first-child {
    grid-column: 1 / -1;
  }
  .wd-field-wide {
    grid-column: 1 / 2;
  }
  .wd-field-depth {
    grid-column: 2 / 3;
    grid-row: 2;
  }
}

@media (min-width: 768px) {
  .wd-layout {
    grid-template-columns: minmax(0, 1fr) 320px;
    align-items: start;
    gap: 18px;
    padding-bottom: 34px;
  }
  .wd-side {
    position: sticky;
    top: 14px;
  }
  .wd-row {
    grid-template-columns: 24px minmax(0, 1fr) 92px 36px;
  }
  .wd-size {
    display: block;
  }
  .wd-empty {
    padding: 60px 24px;
  }
}

@media (max-width: 519px) {
  .wd-results-head {
    display: block;
  }
  .wd-result-actions {
    justify-content: flex-start;
    margin-top: 10px;
  }
  .wd-header h1 {
    font-size: 23px;
  }
}
</style>
