<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
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
const importErrorDetail = ref('')

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
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="scrim" @click="emit('close')" />
    <div class="sheet">
      <div class="grab" />
      <div class="sh-head">
        <div class="sh-title">导入歌单</div>
        <button class="iconbtn quiet" aria-label="关闭" @click="emit('close')">
          <Icon name="close" :size="18" />
        </button>
      </div>

      <template v-if="importers.length">
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
