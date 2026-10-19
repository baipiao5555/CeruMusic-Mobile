<script setup lang="ts">
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { settingsState, updateSettings } from '@/core/settings'
import { clearQueue, getHistory } from '@/core/playback/player'
import { pluginState } from '@/core/plugin/manager'

const router = useRouter()

const themes = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

const qualities = ['128k', '320k', 'flac', '24bit']

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
    quality: '128k',
    showLyrics: true,
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

    <div class="section-title" style="margin-top: 4px">
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
      <div class="chips">
        <button
          v-for="quality in qualities"
          :key="quality"
          class="chip"
          :class="{ active: settingsState.quality === quality }"
          @click="updateSettings({ quality })"
        >
          {{ quality }}
        </button>
      </div>
      <p class="hint">如果当前歌曲没有所选音质，会自动回落到插件提供的可用音质。</p>
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
      <div class="list-item" style="padding-left: 0; padding-right: 0; border-bottom: 0">
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
        <p>版本 2.3.1-mobile.1</p>
        <p>插件协议 v2.0 · Android</p>
      </div>
    </div>
    <p class="footer">
      本应用仅提供插件运行框架与播放功能，不存储、不提供任何音乐源文件。音乐信息由你自行安装的合规插件提供。
    </p>
  </div>
</template>

<style scoped>
.panel {
  padding: 16px;
}
.panel-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 11px;
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
