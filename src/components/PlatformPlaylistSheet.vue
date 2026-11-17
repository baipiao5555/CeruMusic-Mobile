<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import type { PlatformId } from '@/core/native/platformLogin'
import { musicPlatforms } from '@/core/platformAccounts'
import {
  importPlatformPlaylist,
  loadPlatformPlaylists,
  platformPlaylistSupport,
  previewPlatformPlaylist,
  type PlatformPlaylistPreview,
  type PlatformPlaylistSummary
} from '@/core/platformPlaylists'

const props = defineProps<{ platform: PlatformId }>()
const emit = defineEmits<{ close: [navigate?: boolean] }>()
const router = useRouter()
const support = computed(() => platformPlaylistSupport(props.platform))
const platformName = computed(() => musicPlatforms.find((item) => item.id === props.platform)?.name || '音乐平台')
const state = ref<'loading' | 'ready' | 'error'>('loading')
const playlists = ref<PlatformPlaylistSummary[]>([])
const selectedId = ref('')
const preview = ref<PlatformPlaylistPreview | null>(null)
const previewLoading = ref(false)
const importing = ref(false)
const error = ref('')
const notice = ref('')
const imported = ref<{
  playlistId: string
  name: string
  importedTracks: number
  skippedTracks: number
  undo(): void
} | null>(null)
let requestToken = 0

onBeforeUnmount(() => { requestToken++ })

async function load(): Promise<void> {
  if (!support.value.supported) return
  const token = ++requestToken
  state.value = 'loading'
  error.value = ''
  notice.value = ''
  playlists.value = []
  selectedId.value = ''
  preview.value = null
  imported.value = null
  try {
    const result = await loadPlatformPlaylists(props.platform)
    if (token !== requestToken) return
    playlists.value = result
    state.value = 'ready'
  } catch (reason) {
    if (token !== requestToken) return
    state.value = 'error'
    error.value = reason instanceof Error ? reason.message : '读取平台歌单失败，请稍后重试'
  }
}

async function choose(item: PlatformPlaylistSummary): Promise<void> {
  if (importing.value) return
  const token = ++requestToken
  selectedId.value = item.id
  preview.value = null
  previewLoading.value = true
  error.value = ''
  notice.value = ''
  imported.value = null
  try {
    const result = await previewPlatformPlaylist(props.platform, item)
    if (token !== requestToken) return
    preview.value = result
  } catch (reason) {
    if (token !== requestToken) return
    error.value = reason instanceof Error ? reason.message : '读取歌单曲目失败，请稍后重试'
  } finally {
    if (token === requestToken) previewLoading.value = false
  }
}

function commit(): void {
  if (!preview.value || !preview.value.tracks.length || importing.value) return
  importing.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = importPlatformPlaylist(props.platform, preview.value)
    imported.value = {
      playlistId: result.playlistId,
      name: preview.value.summary.name,
      importedTracks: result.importedTracks,
      skippedTracks: result.skippedTracks,
      undo: result.undo
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '导入本机歌单失败，原歌单库未修改'
  } finally {
    importing.value = false
  }
}

function undo(): void {
  if (!imported.value) return
  try {
    imported.value.undo()
    imported.value = null
    error.value = ''
    notice.value = '本次导入已撤销'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '导入后已有其他改动，无法一键撤销'
  }
}

function openPlaylist(): void {
  if (!imported.value) return
  const id = imported.value.playlistId
  void router.push('/playlist/' + id)
  emit('close', true)
}

onMounted(() => { void load() })
</script>

<template>
  <div class="sheet-mask" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="sheet platform-playlist-sheet" role="dialog" aria-modal="true" :aria-label="'导入' + platformName + '歌单'">
      <div class="grab" />
      <header class="sh-head">
        <div class="pp-head-copy">
          <h2 class="sh-title">平台歌单</h2>
          <p>{{ platformName }} · 读取后保存为本机歌单</p>
        </div>
        <button class="iconbtn quiet" aria-label="关闭平台歌单" @click="emit('close')"><Icon name="close" :size="18" /></button>
      </header>

      <div class="pp-content">
        <div v-if="!support.supported" class="pp-unsupported" role="status">
          <Icon name="info" :size="20" />
          <div><strong>此平台歌单暂不支持读取</strong><p>{{ support.reason }}</p></div>
        </div>

        <template v-else>
          <p class="pp-note">使用本机加密保存的平台会话读取官方歌单。凭据只用于请求网易云接口，不会交给音源插件或写入普通本地存储。导入只保存曲目信息，播放仍取决于已安装的网易云音源插件。</p>

          <div v-if="state === 'loading'" class="pp-loading" role="status"><span class="dotg live" />正在读取歌单目录…</div>
          <div v-else-if="state === 'error' && !playlists.length" class="pp-error" role="alert">
            <span>{{ error }}</span>
            <button class="pp-retry" @click="load">重试</button>
          </div>
          <div v-else-if="!playlists.length" class="pp-empty">
            <div class="pp-empty-glyph"><Icon name="playlist" :size="28" /></div>
            <strong>没有读取到歌单</strong>
            <p>这个账号下没有可读取的歌单，或平台返回了空目录。</p>
            <button class="btn btn-ghost btn-sm" @click="load">重新读取</button>
          </div>

          <template v-else>
            <div class="pp-list-head"><strong>选择平台歌单</strong><span>{{ playlists.length }} 个</span></div>
            <div class="pp-list" aria-label="平台歌单列表">
              <button
                v-for="item in playlists"
                :key="item.id"
                class="pp-item"
                :class="{ on: selectedId === item.id }"
                :aria-pressed="selectedId === item.id"
                :disabled="importing"
                @click="choose(item)"
              >
                <img :src="item.cover" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
                <span class="pp-item-copy">
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.trackCount }} 首<span v-if="item.creator"> · {{ item.creator }}</span></small>
                </span>
                <span class="pp-state">{{ selectedId === item.id ? '已选择' : '查看' }}</span>
              </button>
            </div>

            <div v-if="previewLoading" class="pp-loading"><span class="dotg live" />正在读取曲目…</div>
            <div v-else-if="preview" class="pp-preview" role="status">
              <div class="pp-preview-head">
                <strong>{{ preview.summary.name }}</strong>
                <span>{{ preview.tracks.length }} / {{ preview.summary.trackCount }} 首</span>
              </div>
              <p v-if="preview.skipped" class="pp-warn">有 {{ preview.skipped }} 首缺少有效歌曲信息，导入时会跳过。</p>
              <ol v-if="preview.tracks.length" class="pp-tracks">
                <li v-for="(track, index) in preview.tracks.slice(0, 6)" :key="track.providerId + ':' + track.id">
                  <span class="pp-index">{{ index + 1 }}</span>
                  <span class="pp-track-copy"><strong>{{ track.title }}</strong><small>{{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template></small></span>
                </li>
              </ol>
              <p v-if="preview.tracks.length > 6" class="pp-more">仅预览前 6 首；导入会保留完整歌单顺序。</p>
              <p v-if="!preview.tracks.length" class="pp-warn">这个歌单没有可导入的歌曲。</p>
            </div>

            <div v-if="error" class="pp-error" role="alert">{{ error }}</div>
            <p v-if="notice" class="pp-notice" role="status">{{ notice }}</p>

            <div v-if="imported" class="pp-done">
              <strong>已导入到本机歌单</strong>
              <p>「{{ imported.name }}」已新增 {{ imported.importedTracks }} 首<span v-if="imported.skippedTracks">，跳过 {{ imported.skippedTracks }} 首重复曲目</span>。平台歌单不会与澜音云歌单混在一起。</p>
              <div class="pp-actions">
                <button class="btn btn-ghost" @click="undo">撤销本次导入</button>
                <button class="btn btn-primary" @click="openPlaylist">查看歌单</button>
              </div>
            </div>
            <div v-else class="pp-actions">
              <button class="btn btn-ghost" @click="emit('close')">取消</button>
              <button class="btn btn-primary" :disabled="!preview || !preview.tracks.length || importing" @click="commit">
                {{ importing ? '导入中…' : '导入到本机' }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.platform-playlist-sheet{max-height:88vh;padding-bottom:calc(14px + var(--safe-bottom));overflow:auto;background:var(--surface)}
.pp-head-copy{min-width:0}.pp-head-copy p{margin:4px 0 0;font-size:10px;line-height:1.6;color:var(--ink-3)}
.pp-content{padding:0 var(--pad)}
.pp-note{margin:0 0 14px;padding:11px 12px;border-radius:12px;background:var(--surface-2);font-size:10px;line-height:1.75;color:var(--ink-3)}
.pp-unsupported{display:flex;gap:10px;padding:14px;border:1px solid var(--line-2);border-radius:14px;background:var(--surface-2);font-size:11px;line-height:1.75;color:var(--ink-3)}
.pp-unsupported>.i{flex:none;color:var(--tint);margin-top:2px}.pp-unsupported strong{display:block;color:var(--ink);font-size:13px}.pp-unsupported p{margin:5px 0 0}
.pp-loading{display:flex;align-items:center;gap:8px;padding:18px 4px;font-size:11px;color:var(--ink-3)}
.pp-error{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0;padding:11px 12px;border-left:2px solid var(--cinnabar);border-radius:8px;background:var(--surface-2);font-size:11px;line-height:1.65;color:var(--cinnabar)}
.pp-notice{margin:10px 0 0;padding:10px 12px;border-radius:8px;background:var(--tint-softer);font-size:10px;line-height:1.65;color:var(--brand-strong)}
.pp-retry{flex:none;min-height:36px;padding:0 10px;border:1px solid var(--line-2);border-radius:8px;color:var(--ink-2);font-size:11px}
.pp-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;text-align:center}
.pp-empty-glyph{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;color:var(--tint);background:var(--tint-softer)}
.pp-empty strong{font-size:14px}.pp-empty p{margin:0;font-size:11px;line-height:1.7;color:var(--ink-3)}
.pp-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 7px}
.pp-list-head strong{font-size:13px}.pp-list-head span{font-size:10px;color:var(--ink-3)}
.pp-list{display:flex;flex-direction:column;gap:5px;max-height:38vh;overflow:auto;padding:2px 0 8px}
.pp-item{display:flex;align-items:center;gap:10px;width:100%;min-height:62px;padding:8px;border:1px solid var(--line-2);border-radius:12px;text-align:left;background:var(--surface)}
.pp-item.on{border-color:var(--tint);background:var(--tint-softer)}
.pp-item:disabled{opacity:.65}
.pp-item img{flex:none;width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--tint-softer)}
.pp-item-copy{flex:1;min-width:0}.pp-item-copy strong,.pp-item-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-item-copy strong{font-size:12px;font-weight:600}.pp-item-copy small{margin-top:4px;font-size:10px;color:var(--ink-3)}
.pp-state{flex:none;font-size:10px;color:var(--tint);padding:5px 7px;border-radius:6px;background:var(--tint-soft)}
.pp-preview{margin-top:10px;padding:12px;border-radius:13px;background:var(--surface-2)}
.pp-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.pp-preview-head strong{min-width:0;overflow-wrap:anywhere}.pp-preview-head span{flex:none;font-size:10px;color:var(--ink-3)}
.pp-warn{margin:8px 0 0;font-size:10px;line-height:1.65;color:var(--cinnabar)}
.pp-tracks{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.pp-tracks li{display:flex;align-items:center;gap:9px;min-width:0}.pp-index{flex:none;width:18px;font-size:10px;color:var(--ink-3);text-align:right}
.pp-track-copy{min-width:0}.pp-track-copy strong,.pp-track-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-track-copy strong{font-size:11px;font-weight:500}.pp-track-copy small{margin-top:2px;font-size:10px;color:var(--ink-3)}
.pp-more{margin:9px 0 0;font-size:10px;color:var(--ink-3)}
.pp-done{margin-top:12px;padding:13px;border:1px solid var(--line-2);border-radius:13px;background:var(--surface)}
.pp-done>strong{font-size:13px}.pp-done>p{margin:6px 0 0;font-size:11px;line-height:1.7;color:var(--ink-3)}
.pp-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.pp-actions .btn{width:100%;min-height:44px}
@media (max-width:360px){.pp-actions{grid-template-columns:1fr}.pp-list{max-height:34vh}}
</style>
