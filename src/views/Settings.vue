<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import OptionSheet from '@/components/OptionSheet.vue'
import { settingsState, updateSettings } from '@/core/settings'
import { clearQueue, playerState, setMode, setQuality } from '@/core/playback/player'
import { notify, pluginState } from '@/core/plugin/manager'
import { availableQualities, qualityDescription, qualityLabel } from '@/core/quality'
import { authState, displayName, login, logout } from '@/core/auth'
import { downloadSummary, formatDownloadTemplate } from '@/core/downloads'
import { libraryState } from '@/core/library'
import { updateState } from '@/core/updater'
import type { Track } from '@/core/track'
import type { AccentColor, LyricFont } from '@/core/settings'
import { confirmAction } from '@/core/confirm'

const router = useRouter()
const appVersion = __APP_VERSION__
const REPO_URL = 'https://github.com/baipiao5555/CeruMusic-Mobile'
const UPSTREAM_URL = 'https://github.com/timeshiftsauce/CeruMusic'
const LICENSE_URL = 'https://github.com/baipiao5555/CeruMusic-Mobile/blob/main/LICENSE'

const downloads = computed(() => downloadSummary())
const cloudCount = computed(
  () => libraryState.playlists.filter((playlist) => playlist.cloudId).length
)

async function signIn(): Promise<void> {
  try {
    await login()
  } catch (error: any) {
    notify(error?.message ?? '打开登录页失败', 'error')
  }
}

async function signOut(): Promise<void> {
  const ok = await confirmAction({
    title: '退出澜音账号？',
    body: '电脑端的登录状态不受影响，本机歌单与下载仍会保留。',
    confirmText: '退出',
    danger: true
  })
  if (!ok) return
  logout()
  notify('已退出登录')
}

const sections = [
  { id: 'account', label: '账号' },
  { id: 'appearance', label: '外观' },
  { id: 'playback', label: '播放' },
  { id: 'lyrics', label: '歌词' },
  { id: 'download', label: '下载' },
  { id: 'data', label: '数据' },
  { id: 'about', label: '关于' }
]

const activeSection = ref('account')

function jumpTo(id: string): void {
  activeSection.value = id
  document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const searchOpen = ref(false)
const settingsQuery = ref('')

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) settingsQuery.value = ''
}

const ROW_TERMS: Record<string, string> = {
  'account:login': '账号 登录 退出 澜音 同步 歌单',
  'appearance:theme': '外观 主题 跟随系统 浅色 深色 夜间',
  'appearance:accent': '主题色 强调色 青绿 蓝色 紫色 橙色 配色',
  'playback:quality': '播放 默认音质 音质 自动 最高 无损',
  'playback:mode': '播放模式 顺序播放 列表循环 单曲循环 随机播放',
  'playback:speed': '播放速度 倍速 0.75 1.5 2',
  'lyrics:scale': '歌词字号 字号 大小 特大',
  'lyrics:font': '歌词字体 字体 宋体 楷体 圆黑 系统',
  'lyrics:offset': '歌词偏移 延迟 提前 校准 秒',
  'lyrics:show': '显示歌词 歌词',
  'lyrics:cloud': '自动匹配云歌词 云歌词 歌词',
  'lyrics:shared': '启用歌词共享 歌词共享 共享',
  'lyrics:sharedTranslation': '共享翻译 翻译 歌词',
  'playback:keepScreenOn': '播放时保持亮屏 亮屏 屏幕',
  'playback:headset': '耳机拔出时暂停 耳机 暂停',
  'playback:fallback': '播放失败自动切换音源 音源 失败 切换',
  'playback:swipePlayer': '播放页左右滑动切歌 手势 滑动 切歌',
  'playback:swipeTabs': '主页面左右滑动切换 手势 滑动 页面',
  'download:quality': '下载音质 音质 下载',
  'download:template': '下载文件名 文件名 模板 命名',
  'download:concurrency': '同时下载数量 并发 数量 下载',
  'data:plugins': '音源插件 插件 音源',
  'data:cloud': '云端歌单 歌单 同步 云',
  'data:downloads': '下载管理 下载 离线',
  'data:logs': '运行日志 日志',
  'data:verbose': '详细日志 日志 调试',
  'data:clear': '清除播放记录 清除 队列 历史 播放记录',
  'data:reset': '恢复默认设置 恢复 默认 重置',
  'about:scope': '版本 关于 应用 插件协议',
  'about:autoUpdate': '插件自动更新 插件 更新',
  'about:update': '检查更新 版本 更新 升级'
}

function show(key: string): boolean {
  const term = settingsQuery.value.trim().toLowerCase()
  if (!term) return true
  return (ROW_TERMS[key] ?? '').toLowerCase().includes(term)
}

function groupVisible(group: string): boolean {
  const term = settingsQuery.value.trim().toLowerCase()
  if (!term) return true
  return Object.entries(ROW_TERMS).some(
    ([key, terms]) => key.startsWith(`${group}:`) && terms.toLowerCase().includes(term)
  )
}

const hasVisibleRows = computed(() => {
  const term = settingsQuery.value.trim().toLowerCase()
  if (!term) return true
  return Object.values(ROW_TERMS).some((terms) => terms.toLowerCase().includes(term))
})

const themes = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

const playModes = [
  { value: 'order', label: '顺序播放' },
  { value: 'repeat-all', label: '列表循环' },
  { value: 'repeat-one', label: '单曲循环' },
  { value: 'shuffle', label: '随机播放' }
] as const

const concurrencies = [1, 2, 3]

const accents: Array<{ value: AccentColor; label: string }> = [
  { value: 'green', label: '青绿' },
  { value: 'blue', label: '蓝色' },
  { value: 'purple', label: '紫色' },
  { value: 'orange', label: '橙色' }
]

const speedOptions = [0.75, 1, 1.25, 1.5, 2]
const lyricScales = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.12, label: '大' },
  { value: 1.25, label: '特大' }
]
const offsetOptions = Array.from({ length: 21 }, (_, index) => (index - 10) / 10)
const lyricFonts: Array<{ value: LyricFont; label: string; hint: string }> = [
  { value: 'system', label: '系统默认', hint: '跟随手机 UI 字体，最稳妥' },
  { value: 'serif', label: '宋体 · 衬线', hint: '唱片内页的观感' },
  { value: 'kai', label: '楷体', hint: '偏手写，适合慢歌' },
  { value: 'round', label: '圆黑', hint: '圆润的现代黑体' }
]

const previewTrack = {
  id: 'preview',
  providerId: 'demo',
  providerName: '示例音源',
  pluginId: '',
  ref: { providerId: 'demo', kind: 'track', id: 'preview' },
  title: '夜曲',
  artist: '周杰伦',
  album: '十一月的萧邦',
  durationMs: 0,
  artwork: '',
  qualities: []
} as unknown as Track

const templatePreview = computed(
  () =>
    formatDownloadTemplate(
      settingsState.downloadFilenameTemplate,
      previewTrack,
      settingsState.downloadQuality || settingsState.quality
    ) + '.mp3'
)

function onTemplateInput(event: Event): void {
  updateSettings({ downloadFilenameTemplate: (event.target as HTMLInputElement).value })
}

const qualities = computed(() => availableQualities())
const qualityHint = computed(() =>
  settingsState.quality ? qualityDescription(settingsState.quality) : '自动取当前歌曲的最高档'
)
const currentQualityLabel = computed(() =>
  settingsState.quality ? qualityLabel(settingsState.quality) : '自动（最高）'
)
const downloadQualityLabel = computed(() =>
  settingsState.downloadQuality ? qualityLabel(settingsState.downloadQuality) : '跟随播放音质'
)
const themeLabel = computed(
  () => themes.find((theme) => theme.value === settingsState.theme)?.label ?? '跟随系统'
)
const modeLabel = computed(
  () => playModes.find((mode) => mode.value === playerState.mode)?.label ?? '列表循环'
)
const speedLabel = computed(
  () =>
    `${Number.isInteger(settingsState.playbackRate) ? settingsState.playbackRate.toFixed(1) : settingsState.playbackRate}×`
)
const lyricScaleLabel = computed(() => {
  const option = lyricScales.find((item) => item.value === settingsState.lyricScale)
  return `${option?.label ?? '标准'} · ${Math.round(settingsState.lyricScale * 100)}%`
})
const lyricFontLabel = computed(
  () => lyricFonts.find((font) => font.value === settingsState.lyricFont)?.label ?? '系统默认'
)
const lyricOffsetLabel = computed(() =>
    `${settingsState.lyricOffsetMs >= 0 ? '+' : ''}${(settingsState.lyricOffsetMs / 1000).toFixed(1)} 秒`
)
const concurrencyLabel = computed(() => `${settingsState.downloadConcurrency} 个`)
const runningPlugins = computed(() => pluginState.plugins.filter((plugin) => plugin.running).length)

/* ---------- 选择器 ---------- */
type PickOption = { value: string | number; label: string; desc?: string }
type PickerKey =
  | 'theme'
  | 'quality'
  | 'mode'
  | 'speed'
  | 'lyricScale'
  | 'lyricFont'
  | 'lyricOffset'
  | 'downloadQuality'
  | 'concurrency'

const picker = ref<PickerKey | null>(null)

const qualityPickerOptions = computed<PickOption[]>(() => [
  { value: '', label: '自动（最高）', desc: '每次播放都取当前歌曲可用的最高档' },
  ...qualities.value.map((quality) => ({
    value: quality,
    label: qualityLabel(quality),
    desc: qualityDescription(quality)
  }))
])

const downloadPickerOptions = computed<PickOption[]>(() => [
  { value: '', label: '跟随播放音质', desc: '和上面「默认音质」保持一致' },
  ...qualities.value.map((quality) => ({
    value: quality,
    label: qualityLabel(quality),
    desc: qualityDescription(quality)
  }))
])

const pickerMeta = computed<{
  title: string
  sub: string
  options: PickOption[]
  value: string | number
  layout: 'list' | 'chips'
}>(() => {
  switch (picker.value) {
    case 'theme':
      return {
        title: '主题',
        sub: '跟随系统时随手机的深浅色切换',
        options: themes.map((theme) => ({ value: theme.value, label: theme.label })),
        value: settingsState.theme,
        layout: 'list'
      }
    case 'quality':
      return {
        title: '默认音质',
        sub: '没有该档位时自动回退',
        options: qualityPickerOptions.value,
        value: settingsState.quality,
        layout: 'list'
      }
    case 'downloadQuality':
      return {
        title: '下载音质',
        sub: '离线文件保存的档位',
        options: downloadPickerOptions.value,
        value: settingsState.downloadQuality,
        layout: 'list'
      }
    case 'mode':
      return {
        title: '播放模式',
        sub: '播放页底部左侧按钮可快速切换',
        options: playModes.map((mode) => ({ value: mode.value, label: mode.label })),
        value: playerState.mode,
        layout: 'list'
      }
    case 'speed':
      return {
        title: '播放速度',
        sub: '不改变音高',
        options: speedOptions.map((rate) => ({ value: rate, label: `${rate}×` })),
        value: settingsState.playbackRate,
        layout: 'list'
      }
    case 'lyricScale':
      return {
        title: '歌词字号',
        sub: '只影响歌词页的字号',
        options: lyricScales.map((scale) => ({
          value: scale.value,
          label: `${scale.label} · ${Math.round(scale.value * 100)}%`
        })),
        value: settingsState.lyricScale,
        layout: 'list'
      }
    case 'lyricFont':
      return {
        title: '歌词字体',
        sub: '只影响歌词文字，界面仍用系统字体',
        options: lyricFonts.map((font) => ({
          value: font.value,
          label: font.label,
          desc: font.hint
        })),
        value: settingsState.lyricFont,
        layout: 'list'
      }
    case 'lyricOffset':
      return {
        title: '歌词偏移',
        sub: '正数让歌词延后，负数为提前',
        options: offsetOptions.map((seconds) => ({
          value: seconds,
          label: `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)} 秒`
        })),
        value: settingsState.lyricOffsetMs / 1000,
        layout: 'chips'
      }
    case 'concurrency':
      return {
        title: '同时下载数量',
        sub: '同时进行的下载任务上限',
        options: concurrencies.map((count) => ({ value: count, label: `${count} 个` })),
        value: settingsState.downloadConcurrency,
        layout: 'list'
      }
    default:
      return { title: '', sub: '', options: [], value: '', layout: 'list' }
  }
})

function openPicker(key: PickerKey): void {
  picker.value = key
}

function onAccent(value: AccentColor): void {
  updateSettings({ accent: value })
}

function closePicker(): void {
  picker.value = null
}

function applyPick(value: string | number): void {
  switch (picker.value) {
    case 'theme':
      if (value === 'system' || value === 'light' || value === 'dark') {
        updateSettings({ theme: value })
      }
      break
    case 'quality':
      setQuality(String(value))
      break
    case 'mode':
      if (
        value === 'order' ||
        value === 'repeat-all' ||
        value === 'repeat-one' ||
        value === 'shuffle'
      ) {
        setMode(value)
      }
      break
    case 'speed': {
      const rate = Number(value)
      if (Number.isFinite(rate)) updateSettings({ playbackRate: rate })
      break
    }
    case 'lyricScale': {
      const scale = Number(value)
      if (Number.isFinite(scale)) updateSettings({ lyricScale: scale })
      break
    }
    case 'lyricFont': {
      const font = String(value)
      if (font === 'system' || font === 'serif' || font === 'kai' || font === 'round') {
        updateSettings({ lyricFont: font })
      }
      break
    }
    case 'lyricOffset': {
      const seconds = Number(value)
      if (Number.isFinite(seconds)) updateSettings({ lyricOffsetMs: Math.round(seconds * 1000) })
      break
    }
    case 'downloadQuality':
      updateSettings({ downloadQuality: String(value) })
      break
    case 'concurrency': {
      const count = Number(value)
      if (count === 1 || count === 2 || count === 3) {
        updateSettings({ downloadConcurrency: count })
      }
      break
    }
  }
}

async function clearPlaybackData(): Promise<void> {
  const ok = await confirmAction({
    title: '清除播放数据？',
    body: '播放队列与播放记录会被清空，无法恢复。',
    confirmText: '清除',
    danger: true
  })
  if (!ok) return
  clearQueue()
  try {
    localStorage.removeItem('ceru.history.v1')
  } catch {}
}

async function resetSettings(): Promise<void> {
  const ok = await confirmAction({
    title: '恢复默认设置？',
    body: '外观、音质、播放与下载偏好都会回到初始值。',
    confirmText: '恢复',
    danger: true
  })
  if (!ok) return
  updateSettings({
    theme: 'system',
    quality: '',
    showLyrics: true,
    cloudLyrics: true,
    keepScreenOn: true,
    playOnHeadset: true,
    autoSourceFallback: true
  })
}
</script>

<template>
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="navrow">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
      </div>

      <header class="page-head phead">
        <div>
          <div class="eyebrow">CERU MUSIC · 本机</div>
          <h1 class="headline">设置</h1>
        </div>
        <div class="page-actions">
          <button
            class="iconbtn soft"
            :aria-label="searchOpen ? '关闭设置搜索' : '搜索设置项'"
            @click="toggleSearch"
          >
            <Icon :name="searchOpen ? 'close' : 'search'" :size="18" />
          </button>
        </div>
      </header>

      <div class="metal">
        <span class="live" />
        <span>{{ runningPlugins }} 个插件运行中</span>
        <span class="dot">·</span>
        <span>{{ qualities.length }} 档音质</span>
        <span class="ver">v{{ appVersion }}</span>
      </div>

      <div v-if="searchOpen" class="searchfield">
        <Icon name="search" :size="16" />
        <input
          v-model="settingsQuery"
          type="search"
          placeholder="搜索设置项，例如 歌词 / 音质 / 日志"
          aria-label="搜索设置项"
          autofocus
        />
        <button v-if="settingsQuery" class="clearq" aria-label="清除搜索" @click="settingsQuery = ''">
          <Icon name="close" :size="14" />
        </button>
      </div>

      <div class="chip-row jump">
        <button
          v-for="section in sections"
          :key="section.id"
          class="chip"
          :class="{ active: activeSection === section.id }"
          @click="jumpTo(section.id)"
        >
          {{ section.label }}
        </button>
      </div>

      <section id="settings-account" v-if="groupVisible('account')">
        <div class="group-title">
          <span class="cn">账号</span>
          <span class="en">Account</span>
        </div>
        <div class="acc">
          <div class="av">
            <img v-if="authState.user?.picture" :src="authState.user.picture" alt="" />
            <template v-else>澜</template>
          </div>
          <div class="accbody">
            <div class="accname">{{ authState.authenticated ? displayName() : '登录同步歌单' }}</div>
            <div class="accsub">
              {{ authState.authenticated ? '账号已连接，歌单从电脑端同步' : '登录后歌单与收藏可在多端同步' }}
            </div>
          </div>
          <button v-if="authState.authenticated" class="btn btn-ghost btn-sm" @click="signOut">
            退出登录
          </button>
          <button v-else class="btn btn-ghost btn-sm" @click="signIn">登录</button>
        </div>
      </section>

      <section id="settings-appearance" v-if="groupVisible('appearance')">
        <div class="group-title">
          <span class="cn">外观</span>
          <span class="en">Appearance</span>
        </div>
        <div class="pgrp">
          <div
            v-if="show('appearance:theme')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('theme')"
            @keydown.enter.prevent="openPicker('theme')"
            @keydown.space.prevent="openPicker('theme')"
          >
            <span class="ico"><Icon name="settings" :size="15" /></span>
            <div class="body">
              <div class="lab">主题</div>
              <div class="sub">跟随系统、浅色或深色</div>
            </div>
            <span class="val">{{ themeLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div v-if="show('appearance:accent')" class="settingrow">
            <span class="ico"><Icon name="select" :size="15" /></span>
            <div class="body">
              <div class="lab">主题色</div>
              <div class="sub">按钮、进度与高亮的强调色</div>
            </div>
            <div class="dots">
              <button
                v-for="accent in accents"
                :key="accent.value"
                class="acdot"
                :class="[accent.value, { on: settingsState.accent === accent.value }]"
                :aria-label="accent.label"
                :aria-pressed="settingsState.accent === accent.value"
                @click="onAccent(accent.value)"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="settings-playback" v-if="groupVisible('playback')">
        <div class="group-title">
          <span class="cn">播放</span>
          <span class="en">Playback</span>
        </div>
        <div class="pgrp">
          <div
            v-if="show('playback:quality')"
            class="settingrow pickrow tall"
            role="button"
            tabindex="0"
            @click="openPicker('quality')"
            @keydown.enter.prevent="openPicker('quality')"
            @keydown.space.prevent="openPicker('quality')"
          >
            <span class="ico"><Icon name="volume" :size="15" /></span>
            <div class="body">
              <div class="lab">默认音质</div>
              <div class="sub">{{ qualityHint }}</div>
            </div>
            <span class="val">{{ currentQualityLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div
            v-if="show('playback:mode')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('mode')"
            @keydown.enter.prevent="openPicker('mode')"
            @keydown.space.prevent="openPicker('mode')"
          >
            <span class="ico"><Icon name="repeat" :size="15" /></span>
            <div class="body">
              <div class="lab">播放模式</div>
              <div class="sub">顺序、循环或随机</div>
            </div>
            <span class="val">{{ modeLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div
            v-if="show('playback:speed')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('speed')"
            @keydown.enter.prevent="openPicker('speed')"
            @keydown.space.prevent="openPicker('speed')"
          >
            <span class="ico"><Icon name="timer" :size="15" /></span>
            <div class="body">
              <div class="lab">播放速度</div>
              <div class="sub">不改变音高</div>
            </div>
            <span class="val">{{ speedLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div v-if="show('playback:keepScreenOn')" class="settingrow">
            <span class="ico"><Icon name="smartphone" :size="15" /></span>
            <div class="body">
              <div class="lab">播放时保持亮屏</div>
              <div class="sub">歌词页不自动息屏</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.keepScreenOn }"
              role="switch"
              :aria-checked="settingsState.keepScreenOn"
              aria-label="播放时保持亮屏"
              @click="updateSettings({ keepScreenOn: !settingsState.keepScreenOn })"
            />
          </div>

          <div v-if="show('playback:headset')" class="settingrow">
            <span class="ico"><Icon name="volume" :size="15" /></span>
            <div class="body">
              <div class="lab">耳机拔出时暂停</div>
              <div class="sub">避免外放打扰</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.playOnHeadset }"
              role="switch"
              :aria-checked="settingsState.playOnHeadset"
              aria-label="耳机拔出时暂停"
              @click="updateSettings({ playOnHeadset: !settingsState.playOnHeadset })"
            />
          </div>

          <div v-if="show('playback:fallback')" class="settingrow">
            <span class="ico"><Icon name="refresh" :size="15" /></span>
            <div class="body">
              <div class="lab">播放失败自动切换音源</div>
              <div class="sub">当前插件拿不到地址时换一个音源重试</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.autoSourceFallback }"
              role="switch"
              :aria-checked="settingsState.autoSourceFallback"
              aria-label="播放失败自动切换音源"
              @click="updateSettings({ autoSourceFallback: !settingsState.autoSourceFallback })"
            />
          </div>

          <div v-if="show('playback:swipePlayer')" class="settingrow">
            <span class="ico"><Icon name="sort" :size="15" /></span>
            <div class="body">
              <div class="lab">播放页左右滑动切歌</div>
              <div class="sub">在封面区域滑动切换上一首 / 下一首</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.swipePlayer }"
              role="switch"
              :aria-checked="settingsState.swipePlayer"
              aria-label="播放页左右滑动切歌"
              @click="updateSettings({ swipePlayer: !settingsState.swipePlayer })"
            />
          </div>

          <div v-if="show('playback:swipeTabs')" class="settingrow">
            <span class="ico"><Icon name="sort" :size="15" /></span>
            <div class="body">
              <div class="lab">主页面左右滑动切换</div>
              <div class="sub">在发现 / 搜索 / 歌单 / 音乐库之间滑动</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.swipeTabs }"
              role="switch"
              :aria-checked="settingsState.swipeTabs"
              aria-label="主页面左右滑动切换"
              @click="updateSettings({ swipeTabs: !settingsState.swipeTabs })"
            />
          </div>
        </div>
      </section>

      <section id="settings-lyrics" v-if="groupVisible('lyrics')">
        <div class="group-title">
          <span class="cn">歌词</span>
          <span class="en">Lyrics</span>
        </div>
        <div class="pgrp">
          <div
            v-if="show('lyrics:scale')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('lyricScale')"
            @keydown.enter.prevent="openPicker('lyricScale')"
            @keydown.space.prevent="openPicker('lyricScale')"
          >
            <span class="ico"><Icon name="lyrics" :size="15" /></span>
            <div class="body">
              <div class="lab">歌词字号</div>
              <div class="sub">只影响歌词页的字号</div>
            </div>
            <span class="val">{{ lyricScaleLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div
            v-if="show('lyrics:font')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('lyricFont')"
            @keydown.enter.prevent="openPicker('lyricFont')"
            @keydown.space.prevent="openPicker('lyricFont')"
          >
            <span class="ico"><Icon name="size" :size="15" /></span>
            <div class="body">
              <div class="lab">歌词字体</div>
              <div class="sub">系统默认，或换成宋体、楷体、圆黑</div>
            </div>
            <span class="val">{{ lyricFontLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div
            v-if="show('lyrics:offset')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('lyricOffset')"
            @keydown.enter.prevent="openPicker('lyricOffset')"
            @keydown.space.prevent="openPicker('lyricOffset')"
          >
            <span class="ico"><Icon name="timer" :size="15" /></span>
            <div class="body">
              <div class="lab">歌词偏移</div>
              <div class="sub">正数让歌词延后高亮，负数为提前</div>
            </div>
            <span class="val">{{ lyricOffsetLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div v-if="show('lyrics:show')" class="settingrow">
            <span class="ico"><Icon name="scroll-text" :size="15" /></span>
            <div class="body">
              <div class="lab">显示歌词</div>
              <div class="sub">播放页展示滚动歌词</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.showLyrics }"
              role="switch"
              :aria-checked="settingsState.showLyrics"
              aria-label="显示歌词"
              @click="updateSettings({ showLyrics: !settingsState.showLyrics })"
            />
          </div>

          <div v-if="show('lyrics:cloud')" class="settingrow">
            <span class="ico"><Icon name="cloud" :size="15" /></span>
            <div class="body">
              <div class="lab">自动匹配云歌词</div>
              <div class="sub">插件不提供歌词时尝试云端匹配</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.cloudLyrics }"
              role="switch"
              :aria-checked="settingsState.cloudLyrics"
              aria-label="自动匹配云歌词"
              @click="updateSettings({ cloudLyrics: !settingsState.cloudLyrics })"
            />
          </div>

          <div v-if="show('lyrics:shared')" class="settingrow">
            <span class="ico"><Icon name="share" :size="15" /></span>
            <div class="body">
              <div class="lab">启用歌词共享</div>
              <div class="sub">把本机歌词同步到系统与桌面端</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.systemLyrics }"
              role="switch"
              :aria-checked="settingsState.systemLyrics"
              aria-label="启用歌词共享"
              @click="updateSettings({ systemLyrics: !settingsState.systemLyrics })"
            />
          </div>

          <div
            v-if="show('lyrics:sharedTranslation')"
            class="settingrow"
            :class="{ off: !settingsState.systemLyrics }"
          >
            <span class="ico"><Icon name="scroll-text" :size="15" /></span>
            <div class="body">
              <div class="lab">共享翻译</div>
              <div class="sub">歌词共享时会一并推送翻译行</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.systemLyricsTranslation }"
              role="switch"
              :aria-checked="settingsState.systemLyricsTranslation"
              aria-label="共享翻译"
              :disabled="!settingsState.systemLyrics"
              @click="updateSettings({ systemLyricsTranslation: !settingsState.systemLyricsTranslation })"
            />
          </div>
        </div>
      </section>

      <section id="settings-download" v-if="groupVisible('download')">
        <div class="group-title">
          <span class="cn">下载</span>
          <span class="en">Download</span>
        </div>
        <div class="pgrp">
          <div
            v-if="show('download:quality')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('downloadQuality')"
            @keydown.enter.prevent="openPicker('downloadQuality')"
            @keydown.space.prevent="openPicker('downloadQuality')"
          >
            <span class="ico"><Icon name="download" :size="15" /></span>
            <div class="body">
              <div class="lab">下载音质</div>
              <div class="sub">离线文件的音质档位</div>
            </div>
            <span class="val">{{ downloadQualityLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>

          <div v-if="show('download:template')" class="settingrow colrow tall">
            <div class="coltop">
              <span class="ico"><Icon name="edit" :size="15" /></span>
              <div class="body">
                <div class="lab">下载文件名</div>
                <div class="sub">%t 歌名 · %s 歌手 · %a 专辑 · %u 平台 · %q 音质 · %d 日期</div>
              </div>
            </div>
            <input
              class="tplinput"
              :value="settingsState.downloadFilenameTemplate"
              maxlength="80"
              placeholder="%t - %s"
              aria-label="下载文件名模板"
              @input="onTemplateInput"
            />
            <div class="tplpreview">预览 · {{ templatePreview }}</div>
          </div>

          <div
            v-if="show('download:concurrency')"
            class="settingrow pickrow"
            role="button"
            tabindex="0"
            @click="openPicker('concurrency')"
            @keydown.enter.prevent="openPicker('concurrency')"
            @keydown.space.prevent="openPicker('concurrency')"
          >
            <span class="ico"><Icon name="queue" :size="15" /></span>
            <div class="body">
              <div class="lab">同时下载数量</div>
              <div class="sub">同时进行的下载任务上限</div>
            </div>
            <span class="val">{{ concurrencyLabel }}</span>
            <Icon name="chevron-down" :size="13" />
          </div>
        </div>
      </section>

      <section id="settings-data" v-if="groupVisible('data')">
        <div class="group-title">
          <span class="cn">数据与存储</span>
          <span class="en">Data</span>
        </div>
        <div class="pgrp">
          <button v-if="show('data:plugins')" class="settingrow tap" @click="router.push('/plugins')">
            <span class="ico"><Icon name="plugin" :size="15" /></span>
            <div class="body">
              <div class="lab">音源插件</div>
              <div class="sub">已安装 {{ pluginState.plugins.length }} 个插件</div>
            </div>
            <span class="val">{{ runningPlugins }} 个运行中</span>
            <Icon name="chevron" :size="14" />
          </button>

          <button v-if="show('data:cloud')" class="settingrow tap" @click="router.push('/cloud')">
            <span class="ico"><Icon name="cloud" :size="15" /></span>
            <div class="body">
              <div class="lab">云端歌单</div>
              <div class="sub">
                {{
                  authState.authenticated
                    ? `已导入 ${cloudCount} 个 · 登录为 ${displayName()}`
                    : '未登录 · 登录后从电脑同步'
                }}
              </div>
            </div>
            <span class="val">{{ cloudCount }} 个</span>
            <Icon name="chevron" :size="14" />
          </button>

          <button v-if="show('data:downloads')" class="settingrow tap" @click="router.push('/downloads')">
            <span class="ico"><Icon name="download" :size="15" /></span>
            <div class="body">
              <div class="lab">下载管理</div>
              <div class="sub">
                {{ downloads.completed }} 首已下载 · {{ downloads.active }} 进行中 ·
                {{ downloads.failed }} 失败
              </div>
            </div>
            <span class="val">{{ downloads.total }} 项</span>
            <Icon name="chevron" :size="14" />
          </button>

          <div v-if="show('data:logs')" class="settingrow">
            <span class="ico"><Icon name="history" :size="15" /></span>
            <div class="body">
              <div class="lab">运行日志</div>
              <div class="sub">记录播放、插件与网络事件，便于排查</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.logsEnabled }"
              role="switch"
              :aria-checked="settingsState.logsEnabled"
              aria-label="运行日志"
              @click="updateSettings({ logsEnabled: !settingsState.logsEnabled })"
            />
          </div>

          <div
            v-if="show('data:verbose')"
            class="settingrow"
            :class="{ off: !settingsState.logsEnabled }"
          >
            <span class="ico"><Icon name="scroll-text" :size="15" /></span>
            <div class="body">
              <div class="lab">详细日志</div>
              <div class="sub">同时收录 console 输出，体积更大</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.verboseLogs }"
              role="switch"
              :aria-checked="settingsState.verboseLogs"
              aria-label="详细日志"
              :disabled="!settingsState.logsEnabled"
              @click="updateSettings({ verboseLogs: !settingsState.verboseLogs })"
            />
          </div>

          <button v-if="show('data:clear')" class="settingrow tap tall" @click="clearPlaybackData">
            <span class="ico"><Icon name="trash" :size="15" /></span>
            <div class="body">
              <div class="lab">清除播放记录</div>
              <div class="sub">清空当前播放队列与最近播放历史</div>
            </div>
            <span class="val danger">清除</span>
          </button>

          <button v-if="show('data:reset')" class="settingrow tap tall" @click="resetSettings">
            <span class="ico"><Icon name="refresh" :size="15" /></span>
            <div class="body">
              <div class="lab danger">恢复默认设置</div>
              <div class="sub">外观、音质与开关恢复出厂状态，账号与歌单不受影响</div>
            </div>
            <Icon name="chevron" :size="14" />
          </button>
        </div>
      </section>

      <section id="settings-about" v-if="groupVisible('about')">
        <div class="group-title">
          <span class="cn">关于</span>
          <span class="en">About</span>
        </div>
        <div class="pgrp">
          <div v-if="show('about:scope')" class="settingrow tall">
            <img class="logo" src="/logo.png" alt="" />
            <div class="body">
              <div class="lab">澜音 · CeruMusic 手机版</div>
              <div class="sub">插件协议 v2.0 · Android</div>
            </div>
            <span class="val">{{ appVersion }}</span>
          </div>

          <div v-if="show('about:autoUpdate')" class="settingrow">
            <span class="ico"><Icon name="plugin" :size="15" /></span>
            <div class="body">
              <div class="lab">插件自动更新</div>
              <div class="sub">启动时检查已安装插件的新版本</div>
            </div>
            <button
              class="switch"
              :class="{ on: settingsState.pluginAutoUpdate }"
              role="switch"
              :aria-checked="settingsState.pluginAutoUpdate"
              aria-label="插件自动更新"
              @click="updateSettings({ pluginAutoUpdate: !settingsState.pluginAutoUpdate })"
            />
          </div>

          <button v-if="show('about:update')" class="settingrow tap" @click="router.push('/update')">
            <span class="ico"><Icon name="refresh" :size="15" /></span>
            <div class="body">
              <div class="lab">检查更新</div>
              <div class="sub">
                {{
                  updateState.hasUpdate
                    ? `发现新版本 ${updateState.latest?.tag}`
                    : `已安装 ${appVersion}，点击检查新版本`
                }}
              </div>
            </div>
            <span v-if="updateState.hasUpdate" class="reddot" />
            <Icon name="chevron" :size="14" />
          </button>
        </div>
      </section>

      <div v-if="!hasVisibleRows" class="empty result-empty">
        <div class="glyph"><Icon name="search" :size="28" /></div>
        <h3>没有匹配的设置</h3>
        <p>换个关键词试试，比如「音质」「歌词」或「日志」。</p>
        <button class="btn btn-ghost" @click="settingsQuery = ''">清空搜索</button>
      </div>

      <div class="flinks">
        <a :href="REPO_URL" target="_blank" rel="noreferrer">查看源码</a>
        <span>·</span>
        <a :href="UPSTREAM_URL" target="_blank" rel="noreferrer">上游项目</a>
        <span>·</span>
        <a :href="LICENSE_URL" target="_blank" rel="noreferrer">AGPL-3.0</a>
      </div>
      <p class="fnote">设置只保存在本机，改动即时生效，不上传服务器。</p>
      <p class="fnote">
        本应用仅提供插件运行框架与播放功能，不存储、不提供任何音乐源文件。音乐信息由你自行安装的合规插件提供。
      </p>
    </div>

    <OptionSheet
      :open="picker !== null"
      :title="pickerMeta.title"
      :sub="pickerMeta.sub"
      :options="pickerMeta.options"
      :value="pickerMeta.value"
      :layout="pickerMeta.layout"
      @close="closePicker"
      @pick="applyPick"
    />
  </div>
</template>

<style scoped>
.navrow {
  display: flex;
  align-items: center;
  padding: 8px var(--pad) 0;
}
.phead {
  padding-top: 9px;
}
.headline {
  margin-top: 7px;
}
.metal {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px var(--pad) 0;
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.02em;
}
.metal .live {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--tint);
  box-shadow: 0 0 0 3px var(--tint-soft);
}
.metal .dot {
  opacity: 0.6;
}
.metal .ver {
  margin-left: auto;
  font-family: var(--mono);
  letter-spacing: 0.04em;
}
.searchfield {
  margin: 14px var(--pad) 0;
}
.searchfield input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--ink);
}
.searchfield input::placeholder {
  color: var(--ink-4);
}
.clearq {
  width: 28px;
  height: 28px;
  margin-right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-4);
}
.jump {
  padding: 16px var(--pad) 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.jump::-webkit-scrollbar {
  display: none;
}
.jump .chip {
  flex: none;
  height: 32px;
  padding: 0 13px;
  position: relative;
}
.jump .chip::after {
  content: '';
  position: absolute;
  inset: -6px 0;
}
.acc {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 var(--pad);
  padding: 13px 15px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-1);
}
.av {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-family: var(--serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--tint);
  background: linear-gradient(140deg, var(--tint-softer), var(--tint-soft));
  border: 1px solid var(--line);
}
.av img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.accbody {
  flex: 1;
  min-width: 0;
}
.accname {
  font-size: 14.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.accsub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-4);
}
.pgrp {
  margin: 0 var(--pad);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.pgrp .settingrow.tall {
  min-height: 68px;
  align-items: center;
}
.pickrow {
  position: relative;
  cursor: pointer;
}
.pickrow:active {
  background: var(--tint-softer);
}
.pickrow:focus-visible {
  outline: 2px solid var(--tint);
  outline-offset: -2px;
}
.pickrow > .val {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.pickrow .body .sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dots {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.acdot {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--line);
  flex: none;
}
.acdot::after {
  content: '';
  position: absolute;
  inset: -10px;
}
.acdot.green {
  background: var(--c500);
}
.acdot.blue {
  background: var(--blue);
}
.acdot.purple {
  background: color-mix(in oklab, var(--blue) 55%, var(--cinnabar));
}
.acdot.orange {
  background: var(--gold);
}
.acdot.on {
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--tint);
}
.settingrow .switch {
  position: relative;
  flex: none;
}
.settingrow .switch::before {
  content: '';
  position: absolute;
  inset: -9px 0;
}
.settingrow.off {
  opacity: 0.5;
}
.settingrow.tap {
  width: 100%;
  text-align: left;
  font: inherit;
  color: var(--ink);
  border: 0;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.settingrow.tap:last-child {
  border-bottom: 0;
}
.settingrow.tap:active {
  background: var(--porcelain-2);
}
.settingrow .val.danger {
  color: var(--cinnabar);
  font-weight: 600;
}
.settingrow .lab.danger {
  color: var(--cinnabar);
}
.reddot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cinnabar);
  flex: none;
}
.colrow {
  flex-direction: column;
  align-items: stretch;
  gap: 9px;
  padding-top: 12px;
  padding-bottom: 13px;
}
.colrow .coltop {
  display: flex;
  align-items: center;
  gap: 12px;
}
.colrow .ico {
  flex: none;
}
.tplinput {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-2);
  background: var(--porcelain-2);
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ink);
  outline: none;
}
.tplinput:focus {
  border-color: var(--tint);
  box-shadow: 0 0 0 3px var(--tint-soft);
}
.tplpreview {
  font-size: 11px;
  color: var(--ink-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.logo {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  flex: none;
  object-fit: contain;
  background: var(--tint-softer);
}
.flinks {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 26px var(--pad) 0;
  font-size: 11px;
  color: var(--ink-4);
}
.flinks a {
  color: var(--ink-3);
  text-decoration: none;
}
.fnote {
  padding: 10px var(--pad) 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-4);
  text-align: center;
}
.result-empty {
  padding-top: 24px;
}
.result-empty .btn {
  margin-top: 4px;
}
</style>
