<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { settingsState, updateSettings } from '@/core/settings'
import { clearQueue, playerState, setMode, setQuality } from '@/core/playback/player'
import { notify, pluginState } from '@/core/plugin/manager'
import { availableQualities, qualityDescription, qualityLabel } from '@/core/quality'
import { authState, displayName, login, logout } from '@/core/auth'
import { downloadSummary, formatDownloadTemplate } from '@/core/downloads'
import { libraryState } from '@/core/library'
import { updateState } from '@/core/updater'
import type { Track } from '@/core/track'
import type { AccentColor } from '@/core/settings'

const router = useRouter()
const appVersion = __APP_VERSION__

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

function signOut(): void {
  if (!window.confirm('退出澜音账号？电脑端的登录状态不受影响。')) return
  logout()
  notify('已退出登录')
}

const sections = [
  { id: 'appearance', label: '外观' },
  { id: 'playback', label: '播放' },
  { id: 'lyrics', label: '歌词' },
  { id: 'download', label: '下载' },
  { id: 'data', label: '数据' }
]

function jumpTo(id: string): void {
  document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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

const accents: Array<{ value: AccentColor; label: string; color: string }> = [
  { value: 'green', label: '青绿', color: '#00b578' },
  { value: 'blue', label: '蓝色', color: '#2f7cf6' },
  { value: 'purple', label: '紫色', color: '#7c5cff' },
  { value: 'orange', label: '橙色', color: '#f08a24' }
]

const speedOptions = [0.75, 1, 1.25, 1.5, 2]
const lyricScales = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.12, label: '大' },
  { value: 1.25, label: '特大' }
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
const qualityHint = computed(() => qualityDescription(settingsState.quality))

function chooseQuality(quality: string): void {
  setQuality(quality)
}

function clearPlaybackData(): void {
  if (!window.confirm('清除播放队列与播放记录？')) return
  clearQueue()
  try {
    localStorage.removeItem('ceru.history.v1')
  } catch {}
}

function resetSettings(): void {
  if (!window.confirm('恢复默认设置？')) return
  updateSettings({
    theme: 'system',
    quality: '',
    showLyrics: true,
    cloudLyrics: true,
    keepScreenOn: true,
    playOnHeadset: true
  })
}
</script>

<template>
  <div class="page">
    <header class="page-header settings-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="settings-heading">
        <span>SETTINGS</span>
        <strong>设置</strong>
      </div>
      <span class="version-chip">{{ appVersion }}</span>
    </header>

    <section class="card account-card">
      <div class="account-avatar">
        <img v-if="authState.user?.picture" :src="authState.user.picture" alt="" />
        <Icon v-else name="user" :size="22" />
      </div>
      <div class="account-info">
        <span class="account-kicker">澜音账号</span>
        <h3>{{ authState.authenticated ? displayName() : '登录同步歌单' }}</h3>
        <p>
          {{
            authState.authenticated
              ? '已登录 · 可从电脑同步歌单'
              : '登录后把电脑上的歌单同步到手机'
          }}
        </p>
      </div>
      <button v-if="!authState.authenticated" class="btn small" @click="signIn">登录</button>
      <button v-else class="btn ghost small" @click="signOut">退出</button>
    </section>

    <nav class="settings-nav" aria-label="设置分类">
      <button
        v-for="section in sections"
        :key="section.id"
        @click="jumpTo(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <div id="settings-appearance" class="section-title settings-section" style="margin-top: 14px">
      <h2>外观</h2>
      <span>主题与配色</span>
    </div>
    <div class="card panel">
      <div class="panel-label">主题</div>
      <div class="chips">
        <button
          v-for="theme in themes"
          :key="theme.value"
          class="chip"
          :class="{ active: settingsState.theme === theme.value }"
          @click="updateSettings({ theme: theme.value })"
        >
          {{ theme.label }}
        </button>
      </div>
      <div class="panel-label" style="margin-top: 14px">主题色</div>
      <div class="chips">
        <button
          v-for="accent in accents"
          :key="accent.value"
          class="chip accent-chip"
          :class="{ active: settingsState.accent === accent.value }"
          @click="updateSettings({ accent: accent.value })"
        >
          <span class="accent-dot" :style="{ background: accent.color }" />
          {{ accent.label }}
        </button>
      </div>
    </div>

    <div id="settings-playback" class="section-title settings-section">
      <h2>播放</h2>
      <span>音质与播放行为</span>
    </div>
    <div class="card panel">
      <div class="panel-label">默认音质</div>
      <div class="chips quality-chips">
        <button
          class="chip"
          :class="{ active: settingsState.quality === '' }"
          @click="chooseQuality('')"
        >
          自动（最高）
        </button>
        <button
          v-for="quality in qualities"
          :key="quality"
          class="chip"
          :class="{ active: settingsState.quality === quality }"
          @click="chooseQuality(quality)"
        >
          {{ qualityLabel(quality) }}
        </button>
      </div>
      <p class="hint">{{ qualityHint }}。如果当前歌曲没有该音质，会自动回落到最接近的可用音质。</p>
    </div>

    <div class="card panel" style="margin-top: 12px">
      <div class="panel-label">播放模式</div>
      <div class="chips quality-chips">
        <button
          v-for="mode in playModes"
          :key="mode.value"
          class="chip"
          :class="{ active: playerState.mode === mode.value }"
          @click="setMode(mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>
      <p class="hint">和播放页的模式按钮同步，切换后立即生效。</p>
    </div>

    <div class="card panel" style="margin-top: 12px">
      <div class="panel-label">播放速度</div>
      <div class="chips">
        <button
          v-for="rate in speedOptions"
          :key="rate"
          class="chip"
          :class="{ active: settingsState.playbackRate === rate }"
          @click="updateSettings({ playbackRate: rate })"
        >
          {{ rate }}x
        </button>
      </div>
      <div class="panel-label" style="margin-top: 14px">歌词字号</div>
      <div class="chips">
        <button
          v-for="scale in lyricScales"
          :key="scale.value"
          class="chip"
          :class="{ active: settingsState.lyricScale === scale.value }"
          @click="updateSettings({ lyricScale: scale.value })"
        >
          {{ scale.label }}
        </button>
      </div>
      <p class="hint">播放速度作用于当前和后续歌曲；歌词字号会立即应用到播放页。</p>
    </div>

    <div class="card panel" style="margin-top: 12px; padding: 4px 16px">
      <div class="list-item" style="padding-left: 0; padding-right: 0">
        <div class="info">
          <h3>显示歌词</h3>
          <p>在播放页展示歌词与翻译</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.showLyrics }"
          aria-label="显示歌词"
          @click="updateSettings({ showLyrics: !settingsState.showLyrics })"
        />
      </div>
      <div class="list-item" style="padding-left: 0; padding-right: 0">
        <div class="info">
          <h3>自动匹配云歌词</h3>
          <p>插件没有歌词时，从 LrcLib / QQ音乐 / 网易云 搜索</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.cloudLyrics }"
          aria-label="自动匹配云歌词"
          @click="updateSettings({ cloudLyrics: !settingsState.cloudLyrics })"
        />
      </div>
      <div class="list-item" style="padding-left: 0; padding-right: 0">
        <div class="info">
          <h3>播放时保持亮屏</h3>
          <p>使用系统 Wake Lock，退出播放页后释放</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.keepScreenOn }"
          aria-label="保持亮屏"
          @click="updateSettings({ keepScreenOn: !settingsState.keepScreenOn })"
        />
      </div>
      <div class="list-item" style="padding-left: 0; padding-right: 0; border-bottom: 0">
        <div class="info">
          <h3>耳机拔出时暂停</h3>
          <p>有线耳机或蓝牙音频断开时自动暂停</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.playOnHeadset }"
          aria-label="耳机拔出时暂停"
          @click="updateSettings({ playOnHeadset: !settingsState.playOnHeadset })"
        />
      </div>
    </div>

    <div class="section-title settings-section">
      <h2>手势</h2>
      <span>交互方式</span>
    </div>
    <div class="card panel" style="padding: 4px 16px">
      <div class="list-item" style="padding-left: 0; padding-right: 0">
        <div class="info">
          <h3>播放页左右滑动切歌</h3>
          <p>左滑下一首，右滑上一首</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.swipePlayer }"
          aria-label="播放页滑动切歌"
          @click="updateSettings({ swipePlayer: !settingsState.swipePlayer })"
        />
      </div>
      <div class="list-item" style="padding-left: 0; padding-right: 0; border-bottom: 0">
        <div class="info">
          <h3>主页面左右滑动切换</h3>
          <p>在发现 / 搜索 / 歌单 / 我的之间滑动切换</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.swipeTabs }"
          aria-label="主页面滑动切换"
          @click="updateSettings({ swipeTabs: !settingsState.swipeTabs })"
        />
      </div>
    </div>

    <div id="settings-lyrics" class="section-title settings-section">
      <h2>歌词共享</h2>
      <span>锁屏与状态栏</span>
    </div>
    <div class="card panel" style="padding: 4px 16px">
      <div class="list-item" style="padding-left: 0; padding-right: 0">
        <div class="info">
          <h3>启用歌词共享</h3>
          <p>把当前歌词共享到状态栏、锁屏或车机（需要系统支持或 Lyricon 模块）</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.systemLyrics }"
          aria-label="启用歌词共享"
          @click="updateSettings({ systemLyrics: !settingsState.systemLyrics })"
        />
      </div>
      <div class="list-item" style="padding-left: 0; padding-right: 0; border-bottom: 0">
        <div class="info">
          <h3>共享翻译</h3>
          <p>有翻译歌词时一起共享</p>
        </div>
        <button
          class="switch"
          :class="{ on: settingsState.systemLyricsTranslation, off: !settingsState.systemLyrics }"
          aria-label="共享翻译"
          @click="updateSettings({ systemLyricsTranslation: !settingsState.systemLyricsTranslation })"
        />
      </div>
    </div>

    <div id="settings-download" class="section-title settings-section">
      <h2>下载</h2>
      <span>音质与文件命名</span>
    </div>
    <div class="card panel">
      <div class="panel-label">下载音质</div>
      <div class="chips quality-chips">
        <button
          class="chip"
          :class="{ active: settingsState.downloadQuality === '' }"
          @click="updateSettings({ downloadQuality: '' })"
        >
          跟随播放音质
        </button>
        <button
          v-for="quality in qualities"
          :key="quality"
          class="chip"
          :class="{ active: settingsState.downloadQuality === quality }"
          @click="updateSettings({ downloadQuality: quality })"
        >
          {{ qualityLabel(quality) }}
        </button>
      </div>
      <p class="hint">
        下载时使用这个音质；选择「跟随播放音质」时使用上面的默认音质。
      </p>
    </div>

    <div class="card panel" style="margin-top: 12px">
      <div class="panel-label">下载文件名</div>
      <input
        class="input template-input"
        :value="settingsState.downloadFilenameTemplate"
        maxlength="80"
        placeholder="%t - %s"
        @input="onTemplateInput"
      />
      <div class="token-hints">
        <span>%t 歌名</span>
        <span>%s 歌手</span>
        <span>%a 专辑</span>
        <span>%u 平台</span>
        <span>%q 音质</span>
        <span>%d 日期</span>
      </div>
      <p class="hint">预览：{{ templatePreview }}</p>
    </div>

    <div class="card panel" style="margin-top: 12px">
      <div class="panel-label">同时下载数量</div>
      <div class="chips">
        <button
          v-for="count in concurrencies"
          :key="count"
          class="chip"
          :class="{ active: settingsState.downloadConcurrency === count }"
          @click="updateSettings({ downloadConcurrency: count })"
        >
          {{ count }} 个
        </button>
      </div>
      <p class="hint">网络较慢时建议设为 1。</p>
    </div>

    <div id="settings-data" class="section-title settings-section">
      <h2>音源与数据</h2>
      <span>插件、账号与存储</span>
    </div>
    <div class="list-group">
      <button class="list-item" @click="router.push('/plugins')">
        <span class="entry-icon"><Icon name="link" :size="19" /></span>
        <div class="info">
          <h3>音源插件</h3>
          <p>{{ pluginState.plugins.filter((item) => item.running).length }} 个运行中 · 共 {{ pluginState.plugins.length }} 个</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="router.push('/cloud')">
        <span class="entry-icon"><Icon name="cloud" :size="19" /></span>
        <div class="info">
          <h3>云端歌单</h3>
          <p>
            {{
              authState.authenticated
                ? `已导入 ${cloudCount} 个 · 登录为 ${displayName()}`
                : '未登录 · 登录后从电脑同步'
            }}
          </p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="router.push('/downloads')">
        <span class="entry-icon"><Icon name="download" :size="19" /></span>
        <div class="info">
          <h3>下载管理</h3>
          <p>
            {{ downloads.completed }} 首已下载<template v-if="downloads.active"> · {{ downloads.active }} 首进行中</template
            ><template v-if="downloads.failed"> · {{ downloads.failed }} 首失败</template>
          </p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="router.push('/update')">
        <span class="entry-icon"><Icon name="refresh" :size="19" /></span>
        <div class="info">
          <h3>检查更新</h3>
          <p>
            当前 {{ appVersion
            }}<template v-if="updateState.hasUpdate">
              · <span class="update-badge">发现 {{ updateState.latest?.tag }}</span></template
            >
          </p>
        </div>
        <span v-if="updateState.hasUpdate" class="dot" />
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="clearPlaybackData">
        <span class="entry-icon"><Icon name="trash" :size="19" /></span>
        <div class="info">
          <h3>清除播放记录</h3>
          <p>不会删除收藏和歌单</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="resetSettings">
        <span class="entry-icon"><Icon name="repeat" :size="19" /></span>
        <div class="info">
          <h3>恢复默认设置</h3>
          <p>主题、音质与播放选项</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
    </div>

    <div class="section-title settings-section">
      <h2>关于</h2>
      <span>版本信息</span>
    </div>
    <div class="card about-card">
      <img src="/logo.png" alt="" />
      <div>
        <h3>澜音 · CeruMusic 手机版</h3>
        <p>版本 {{ appVersion }}</p>
        <p>插件协议 v2.0 · Android</p>
      </div>
    </div>
    <p class="footer">
      本应用仅提供插件运行框架与播放功能，不存储、不提供任何音乐源文件。音乐信息由你自行安装的合规插件提供。
    </p>
  </div>
</template>

<style scoped>
.settings-header {
  display: grid;
  grid-template-columns: 42px 1fr auto;
  align-items: center;
  padding-bottom: 10px;
}
.settings-heading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  line-height: 1.1;
}
.settings-heading span {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.8px;
  color: var(--muted-2);
}
.settings-heading strong {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}
.version-chip {
  justify-self: end;
  padding: 6px 9px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.account-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  margin-top: 6px;
  background:
    radial-gradient(120% 180% at 0% 0%, var(--brand-soft), transparent 58%),
    var(--surface);
}
.account-kicker {
  display: block;
  margin-bottom: 2px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.2px;
  color: var(--muted-2);
}
.account-avatar {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  overflow: hidden;
  color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 8px 20px rgba(0, 181, 120, 0.16);
  flex: 0 0 auto;
}
.settings-nav {
  display: flex;
  gap: 7px;
  margin: 13px -2px 2px;
  padding: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.settings-nav::-webkit-scrollbar {
  display: none;
}
.settings-nav button {
  flex: 0 0 auto;
  padding: 8px 13px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  transition: background 0.15s ease, color 0.15s ease;
}
.settings-nav button:active {
  color: var(--brand);
  background: var(--brand-soft);
}
.settings-section {
  margin: 22px 2px 10px;
  scroll-margin-top: 12px;
}
.settings-section h2 {
  font-size: 17px;
}
.settings-section span {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--muted-2);
}
.account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.account-info {
  flex: 1;
  min-width: 0;
}
.account-info h3 {
  font-size: 14.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-info p {
  margin-top: 3px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.btn.small {
  padding: 8px 14px;
  font-size: 12.5px;
  flex: 0 0 auto;
}
.update-badge {
  color: var(--brand);
  font-weight: 600;
}
.accent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.accent-dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.template-input {
  width: 100%;
  margin-top: 2px;
}
.token-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.token-hints span {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--muted);
  background: var(--brand-softer);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e05353;
  flex: 0 0 auto;
  margin-right: 4px;
}
.panel {
  padding: 16px;
}
.panel-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 11px;
}
.quality-chips {
  flex-wrap: wrap;
  overflow: visible;
  row-gap: 8px;
  padding: 2px 2px 4px;
}
.hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
}
.entry-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.chev {
  color: var(--muted-2);
}
.about-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}
.about-card img {
  width: 54px;
  height: 54px;
  border-radius: 16px;
}
.about-card h3 {
  font-size: 15px;
}
.about-card p {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
}
.footer {
  margin: 18px 6px 8px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--muted-2);
  text-align: center;
}
</style>
