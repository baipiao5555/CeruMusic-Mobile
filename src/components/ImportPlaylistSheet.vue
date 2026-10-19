<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createPlaylistWithTracks } from '@/core/library'
import {
  allImporters,
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
  try {
    const result = await importPluginPlaylist(importer, value)
    if (!result.tracks.length) throw new Error('没有解析到歌曲，请检查链接或插件登录状态')
    const playlist = createPlaylistWithTracks(result.name || importer.title, result.tracks)
    emit('close')
    router.push('/playlist/' + playlist.id)
  } catch (error: any) {
    importError.value = error?.message ?? '导入失败'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="sheet">
      <h2>导入歌单</h2>
      <template v-if="importers.length">
        <p class="sub">解析和登录态由插件提供，支持平台取决于你安装的音源插件。</p>
        <div class="chips" style="margin-bottom: 12px">
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
        <p v-if="selectedImporter?.description" class="sub">{{ selectedImporter.description }}</p>
        <ol v-if="selectedImporter?.instructions.length" class="instructions">
          <li v-for="line in selectedImporter.instructions" :key="line">{{ line }}</li>
        </ol>
        <div class="field">
          <label>{{ selectedImporter?.title }} 链接 / 内容</label>
          <textarea
            v-model="importValue"
            class="input import-input"
            rows="3"
            :placeholder="selectedImporter?.placeholder || '粘贴歌单分享链接'"
          />
        </div>
        <div v-if="selectedImporter?.examples.length" class="examples">
          <button
            v-for="example in selectedImporter.examples"
            :key="example.value"
            class="example"
            @click="useExample(example)"
          >
            {{ example.label || example.value }}
          </button>
        </div>
        <p v-if="importError" class="import-error">{{ importError }}</p>
        <div class="sheet-actions">
          <button class="btn secondary" @click="emit('close')">取消</button>
          <button class="btn" :disabled="importing || !importValue.trim()" @click="startImport">
            <span v-if="importing" class="loading-dots"><i /><i /><i /></span>
            <span v-else>开始导入</span>
          </button>
        </div>
      </template>
      <template v-else>
        <p class="sub">
          当前没有插件提供歌单导入能力。安装支持歌单导入的澜音 v2 插件后，就可以在这里粘贴其他平台的歌单链接。
        </p>
        <div class="sheet-actions">
          <button class="btn secondary" @click="emit('close')">关闭</button>
          <button class="btn" @click="emit('close'); router.push('/plugins')">去安装插件</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.import-input {
  min-height: 86px;
  resize: vertical;
  line-height: 1.5;
  user-select: text;
}
.instructions {
  margin: 0 0 14px 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.instructions li {
  list-style: decimal;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.example {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--brand);
  background: var(--brand-soft);
}
.import-error {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--danger);
  background: rgba(229, 72, 77, 0.1);
  margin-bottom: 10px;
}
</style>
