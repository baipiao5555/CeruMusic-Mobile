<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { settingsState, updateSettings } from '@/core/settings'
import { clearQueue, getHistory, playerState, setMode, setQuality } from '@/core/playback/player'
import { notify, pluginState } from '@/core/plugin/manager'
import { availableQualities, qualityDescription, qualityLabel } from '@/core/quality'
import { authState, displayName, login, logout } from '@/core/auth'
import { downloadSummary } from '@/core/downloads'
import { libraryState } from '@/core/library'
import { updateState } from '@/core/updater'

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
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="brand-name" style="font-size: 20px">设置</div>
      <span style="width: 42px" />
    </header>

    <section class="card account-card">
      <div class="account-avatar">
        <img v-if="authState.user?.picture" :src="authState.user.picture" alt="" />
        <Icon v-else name="user" :size="22" />
      </div>
      <div class="account-info">
        <h3>{{ authState.authenticated ? displayName() : '澜音账号' }}</h3>
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

    <div class="section-title" style="margin-top: 14px">
      <h2>外观</h2>
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
    </div>

    <div class="section-title">
      <h2>播放</h2>
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

    <div class="section-title">
      <h2>手势</h2>
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

    <div class="section-title">
      <h2>歌词共享</h2>
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

    <div class="section-title">
      <h2>下载</h2>
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

    <div class="section-title">
      <h2>音源与数据</h2>
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

    <div class="section-title">
      <h2>关于</h2>
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
.account-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin-top: 16px;
}
.account-avatar {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  overflow: hidden;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
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
