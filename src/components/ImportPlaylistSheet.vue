<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { commitPlaylistImport, createPlaylistWithTracks, libraryState } from '@/core/library'
import { parsePlaylistFile, type PlaylistFilePreview, PLAYLIST_FILE_LIMITS } from '@/core/playlistFile'
import { confirmAction } from '@/core/confirm'
import {
  allImporters,
  allProviders,
  pluginState,
  importPlaylist as importPluginPlaylist,
  type PlaylistImporterHandle
} from '@/core/plugin/manager'

const emit = defineEmits<{ close: [] }>()
const router = useRouter()

const importers = computed(() => allImporters())
const selectedImporterId = ref('')
const importValue = ref('')
const importing = ref(false)
const importError = ref('')
const importErrorDetail = ref('')
const importTab = ref<'plugin' | 'file'>(importers.value.length ? 'plugin' : 'file')
const filePreview = ref<PlaylistFilePreview | null>(null)
const fileName = ref('')
const fileBusy = ref(false)
const fileError = ref('')
const selectedDrafts = ref<number[]>([])
const fileMode = ref<'new' | 'merge' | 'replace'>('new')
const targetId = ref('')
const fileResult = ref<ReturnType<typeof commitPlaylistImport> | null>(null)
let readToken = 0
onBeforeUnmount(() => { readToken++ })
const chosenDrafts = computed(() => filePreview.value?.drafts.filter((_, index) => selectedDrafts.value.includes(index)) ?? [])
const canCommitFile = computed(() => !fileBusy.value && !fileResult.value && chosenDrafts.value.length > 0 && (fileMode.value === 'new' || !!targetId.value))

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const token = ++readToken
  filePreview.value = null; fileResult.value = null; fileError.value = ''; selectedDrafts.value = []
  fileName.value = file.name; fileBusy.value = true
  try {
    if (file.size > PLAYLIST_FILE_LIMITS.inputBytes) throw new Error('文件大小超限（最多 8 MB）')
    const providers = allProviders().map(provider => ({
      ...provider, format: pluginState.plugins.find(plugin => plugin.pluginId === provider.pluginId)?.format
    }))
    const preview = await parsePlaylistFile(new Uint8Array(await file.arrayBuffer()), providers)
    if (token !== readToken) return
    filePreview.value = preview
    selectedDrafts.value = preview.drafts.map((_, index) => index)
  } catch (error) {
    if (token === readToken) fileError.value = error instanceof Error ? error.message : '读取文件失败'
  } finally { if (token === readToken) fileBusy.value = false }
}

async function commitFile(): Promise<void> {
  if (!canCommitFile.value) return
  fileError.value = ''
  if (fileMode.value === 'replace') {
    const target = libraryState.playlists.find(item => item.id === targetId.value)
    if (!await confirmAction({
      title: '替换原有歌单？', danger: true, confirmText: '确认替换',
      body: `“${target?.name ?? '目标歌单'}”中的 ${target?.tracks.length ?? 0} 首将被所选歌单的曲目替换。不会删除音乐文件；提交后可撤销，其他编辑后撤销会被拒绝。`
    })) return
  }
  fileBusy.value = true
  try {
    fileResult.value = commitPlaylistImport(chosenDrafts.value, { mode: fileMode.value, ...(fileMode.value === 'new' ? {} : { targetId: targetId.value }) })
  } catch (error) {
    fileError.value = `导入未完成，本地库未提交：${error instanceof Error ? error.message : '存储失败'}`
  } finally { fileBusy.value = false }
}

function undoFile(): void {
  try {
    fileResult.value?.undo()
    fileResult.value = null
    fileError.value = '本次导入已撤销'
  } catch (error) { fileError.value = error instanceof Error ? error.message : '无法撤销，请检查后续编辑' }
}

function describeImportError(error: unknown): { message: string; detail: string } {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const detail = raw.replace(/^\[[^\]]+\]\s*/, '').trim()
  const text = detail.toLowerCase()
  if (detail.startsWith('没有解析到歌曲')) return { message: detail, detail: '' }
  if (/try max num|not found|不存在|invalid|获取失败/.test(text)) {
    return {
      message:
        '没有读取到这个歌单。如果它是「我喜欢」这类个人收藏，通常不能按 ID 读取：请在平台里点「分享 → 复制链接」粘贴完整链接，或先把歌曲转存成一个公开歌单再导入。',
      detail
    }
  }
  if (/登录|login|auth|token|401|403|permission/.test(text)) {
    return { message: '这个歌单需要登录才能读取，请先在音源插件里登录对应平台再回来重试。', detail }
  }
  if (/timeout|timed out|abort|超时/.test(text)) {
    return { message: '读取超时，请检查网络或 VPN 后重试。', detail }
  }
  if (/not registered|unavailable|不支持/.test(text)) {
    return { message: '当前插件没有提供该平台的歌单导入能力，请更新或更换音源插件。', detail }
  }
  return { message: detail || '导入失败', detail: '' }
}

const selectedImporter = computed<PlaylistImporterHandle | undefined>(() => {
  return (
    importers.value.find((item) => `${item.pluginId}:${item.id}` === selectedImporterId.value) ??
    importers.value[0]
  )
})

function chooseImporter(importer: PlaylistImporterHandle): void {
  selectedImporterId.value = `${importer.pluginId}:${importer.id}`
}

function useExample(example: { value: string }): void {
  importValue.value = example.value
}

async function startImport(): Promise<void> {
  const importer = selectedImporter.value
  if (!importer) {
    importError.value = '请先安装支持歌单导入的插件'
    return
  }
  const value = importValue.value.trim()
  if (!value) {
    importError.value = '请输入歌单链接或内容'
    return
  }
  importing.value = true
  importError.value = ''
  importErrorDetail.value = ''
  try {
    const result = await importPluginPlaylist(importer, value)
    if (!result.tracks.length) {
      throw new Error('没有解析到歌曲：歌单可能为空、未公开，或需要先在插件里登录。')
    }
    const playlist = createPlaylistWithTracks(result.name || importer.title, result.tracks)
    emit('close')
    router.push('/playlist/' + playlist.id)
  } catch (error: unknown) {
    const described = describeImportError(error)
    importError.value = described.message
    importErrorDetail.value = described.detail
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="sheet-mask sheet-standalone" @click.self="emit('close')">
    <div class="scrim" @click="emit('close')" />
    <div class="sheet">
      <div class="grab" />
      <div class="sh-head">
        <div class="sh-title">导入歌单</div>
        <button class="iconbtn quiet" aria-label="关闭" @click="emit('close')">
          <Icon name="close" :size="18" />
        </button>
      </div>

      <div class="imp-tabs pad" aria-label="导入方式">
        <button class="chip" :class="{ active: importTab === 'plugin' }" :aria-pressed="importTab === 'plugin'" @click="importTab = 'plugin'">平台链接</button>
        <button class="chip" :class="{ active: importTab === 'file' }" :aria-pressed="importTab === 'file'" @click="importTab = 'file'">本地文件</button>
      </div>

      <div v-if="importTab === 'file'" class="file-body pad">
        <p class="sh-sub">离线导入 LX .lxmc / .json，无需安装音源插件。按文件内容识别；澜音 AES .cpl / .cmpl 本阶段尚未支持。</p>
        <label class="file-picker">
          <Icon name="folder" :size="18" /> {{ fileBusy ? '正在解析…' : '选择歌单文件' }}
          <input type="file" accept=".lxmc,.json,.cpl,.cmpl,application/json,application/gzip,application/octet-stream" :disabled="fileBusy" aria-label="选择歌单文件" @change="chooseFile" />
        </label>
        <p v-if="fileName" class="imp-hint file-name">{{ fileName }}</p>
        <template v-if="filePreview">
          <p class="file-format">{{ filePreview.format }}</p>
          <p class="file-counts">{{ filePreview.drafts.length }} 个歌单 · {{ filePreview.counts.tracks }} 首有效 · {{ filePreview.counts.invalid }} 条无效 · {{ filePreview.counts.duplicates }} 条重复 · {{ filePreview.counts.pending }} 首待匹配<span v-if="filePreview.counts.invalidPlaylists"> · {{ filePreview.counts.invalidPlaylists }} 个无效歌单</span></p>
          <ul class="file-drafts">
            <li v-for="(draft, index) in filePreview.drafts" :key="index">
              <label><input v-model="selectedDrafts" type="checkbox" :value="index" :disabled="!!fileResult || fileBusy" /><span>{{ draft.name }}<small>{{ draft.tracks.length }} 首</small></span></label>
            </li>
          </ul>
          <p v-for="warning in filePreview.warnings" :key="warning" class="imp-hint">{{ warning }}</p>
          <div v-if="!fileResult" class="file-options">
            <label class="imp-lab" for="file-mode">导入方式</label>
            <select id="file-mode" v-model="fileMode" :disabled="fileBusy">
              <option value="new">新建所选歌单（新 ID）</option>
              <option value="merge" :disabled="!libraryState.playlists.length">合并到已有歌单（保留原曲目）</option>
              <option value="replace" :disabled="!libraryState.playlists.length">替换已有歌单（需要单独确认）</option>
            </select>
            <template v-if="fileMode !== 'new'">
              <label class="imp-lab" for="file-target">目标本地歌单</label>
              <select id="file-target" v-model="targetId" :disabled="fileBusy">
                <option disabled value="">请选择目标歌单</option>
                <option v-for="playlist in libraryState.playlists" :key="playlist.id" :value="playlist.id">{{ playlist.name }} · {{ playlist.tracks.length }} 首</option>
              </select>
            </template>
          </div>
        </template>
        <div v-if="fileError" class="imp-error" role="alert">{{ fileError }}</div>
        <div v-if="fileResult" class="file-report" role="status">
          <strong>导入完成</strong>
          <p>已提交 {{ fileResult.playlistIds.length }} 个歌单、{{ fileResult.importedTracks }} 首；跳过 {{ fileResult.skippedTracks }} 首重复曲目。</p>
          <div class="row g10">
            <button class="btn btn-ghost f1" @click="undoFile">撤销本次导入</button>
            <button class="btn btn-primary f1" @click="emit('close'); router.push('/playlist/' + fileResult.playlistIds[0])">查看歌单</button>
          </div>
        </div>
        <div v-else class="row g10 imp-actions">
          <button class="btn btn-ghost f1" @click="emit('close')">取消</button>
          <button class="btn btn-primary f1" :disabled="!canCommitFile" @click="commitFile">确认导入</button>
        </div>
      </div>

      <template v-else-if="importers.length">
        <p class="sh-sub pad">解析和登录态由插件提供，支持平台取决于你安装的音源插件。</p>

        <div class="imp-chips pad">
          <button
            v-for="item in importers"
            :key="item.pluginId + ':' + item.id"
            class="chip"
            :class="{
              active:
                selectedImporter?.pluginId === item.pluginId && selectedImporter?.id === item.id
            }"
            @click="chooseImporter(item)"
          >
            {{ item.title }}
          </button>
        </div>

        <p v-if="selectedImporter?.description" class="imp-desc pad">
          {{ selectedImporter.description }}
        </p>
        <ol v-if="selectedImporter?.instructions.length" class="imp-steps pad">
          <li v-for="line in selectedImporter.instructions" :key="line">{{ line }}</li>
        </ol>

        <div class="pad imp-field">
          <label class="imp-lab" for="imp-value">
            {{ selectedImporter?.title }} 链接 / 内容
          </label>
          <textarea
            id="imp-value"
            v-model="importValue"
            class="imp-input"
            rows="3"
            :placeholder="selectedImporter?.placeholder || '粘贴歌单分享链接'"
          />
          <p class="imp-hint">
            支持直接粘贴分享文案，会自动提取其中的链接或歌单 ID。个人收藏（如「我喜欢」）通常无法按 ID
            读取，请粘贴「分享 → 复制链接」得到的完整链接，或先转存为公开歌单。
          </p>
        </div>

        <div v-if="selectedImporter?.examples.length" class="imp-examples pad">
          <button
            v-for="example in selectedImporter.examples"
            :key="example.value"
            class="chip"
            @click="useExample(example)"
          >
            {{ example.label || example.value }}
          </button>
        </div>

        <div v-if="importError" class="pad">
          <div class="imp-error">
            <span>{{ importError }}</span>
            <span v-if="importErrorDetail" class="imp-error-detail">
              插件返回：{{ importErrorDetail }}
            </span>
          </div>
        </div>

        <div class="row g10 pad imp-actions">
          <button class="btn btn-ghost f1" @click="emit('close')">取消</button>
          <button
            class="btn btn-primary f1"
            :disabled="importing || !importValue.trim()"
            @click="startImport"
          >
            <span v-if="importing" class="loading-dots"><i /><i /><i /></span>
            <span v-else>开始导入</span>
          </button>
        </div>
      </template>

      <template v-else>
        <p class="sh-sub pad imp-empty">
          当前没有插件提供歌单导入能力。安装支持歌单导入的澜音 v2 插件后，就可以在这里粘贴其他平台的歌单链接。
        </p>
        <div class="row g10 pad imp-actions">
          <button class="btn btn-ghost f1" @click="emit('close')">关闭</button>
          <button class="btn btn-primary f1" @click="emit('close'); router.push('/plugins')">
            去安装插件
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sheet { max-height: calc(100vh - 36px); max-height: calc(100dvh - 36px); overflow-y: auto; }
.imp-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.file-body { padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
.file-picker { position: relative; display: flex; justify-content: center; gap: 8px; padding: 14px; border: 1px dashed var(--tint); border-radius: var(--r-md); color: var(--tint); cursor: pointer; }
.file-picker input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.file-picker:focus-within { outline: 2px solid var(--tint); outline-offset: 3px; }
.file-name, .file-format { overflow-wrap: anywhere; }
.file-format { margin: 14px 0 6px; font-size: 12px; font-weight: 600; }
.file-counts { font-size: 11px; color: var(--ink-3); line-height: 1.6; }
.file-drafts { margin: 10px 0; max-height: 220px; overflow-y: auto; }
.file-drafts label { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.file-drafts input { width: 18px; height: 18px; flex: none; accent-color: var(--tint); }
.file-drafts span { overflow-wrap: anywhere; }
.file-drafts small { display: block; color: var(--ink-4); font-size: 11px; margin-top: 3px; }
.file-options { margin: 16px 0 14px; }
.file-options select { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid var(--line); border-radius: var(--r-sm); color: var(--ink); background: var(--porcelain-2); font-size: 12px; }
.file-report { margin: 16px 0 6px; font-size: 12px; line-height: 1.6; }
.sh-sub {
  margin: 0 0 12px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-4);
}
.imp-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 12px;
  scrollbar-width: none;
}
.imp-chips .chip {
  flex: none;
}
.imp-desc {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-3);
}
.imp-steps {
  margin: 0 0 14px;
  padding-left: calc(var(--pad) + 15px);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-3);
}
.imp-steps li {
  list-style: decimal;
}
.imp-field {
  margin-bottom: 12px;
}
.imp-lab {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ink-4);
}
.imp-input {
  display: block;
  width: 100%;
  min-height: 86px;
  padding: 11px 13px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--porcelain-2);
  color: var(--ink);
  font-size: 13.5px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  user-select: text;
}
.imp-input::placeholder {
  color: var(--ink-4);
}
.imp-input:focus {
  border-color: var(--tint);
  box-shadow: 0 0 0 3px var(--tint-soft);
}
.imp-hint {
  margin: 7px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink-4);
}
.imp-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.imp-error {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  border-left: 2px solid var(--cinnabar);
  background: var(--porcelain-2);
  font-size: 12px;
  line-height: 1.55;
  color: var(--cinnabar);
}
.imp-error-detail {
  font-size: 11px;
  color: var(--ink-3);
  user-select: text;
  word-break: break-all;
}
.imp-empty {
  margin-bottom: 16px;
  font-size: 12.5px;
}
.imp-actions {
  margin-top: 4px;
}
</style>
