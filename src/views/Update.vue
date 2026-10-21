<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import {
  checkForUpdate,
  downloadUpdate,
  ignoreVersion,
  installDownloadedUpdate,
  openReleasePage,
  setAutoCheck,
  updateState
} from '@/core/updater'

const router = useRouter()

const notes = computed(() =>
  (updateState.latest?.body ?? '')
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .trim()
)

const lastCheckedText = computed(() => {
  if (!updateState.lastChecked) return '尚未检查'
  const date = new Date(updateState.lastChecked)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
})

function formatSize(bytes: number): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function install(): void {
  if (updateState.downloadedFileName) void installDownloadedUpdate()
  else void downloadUpdate()
}

function ignoreLatest(): void {
  if (updateState.latest) ignoreVersion(updateState.latest.tag)
}

onMounted(() => {
  if (!updateState.latest) void checkForUpdate({ silent: true })
})
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="brand-name" style="font-size: 20px">检查更新</div>
      <button
        class="icon-btn"
        aria-label="检查更新"
        :disabled="updateState.checking"
        @click="checkForUpdate({ force: true })"
      >
        <Icon name="refresh" :size="20" />
      </button>
    </header>

    <section class="card current-card">
      <img src="/logo.png" alt="" />
      <div class="current-info">
        <h2>澜音 · CeruMusic 手机版</h2>
        <p>当前版本 {{ updateState.currentVersion }}</p>
        <p class="muted">上次检查：{{ lastCheckedText }}</p>
      </div>
    </section>

    <div v-if="updateState.checking" class="card status-card">
      <span class="spinner" />
      正在检查更新…
    </div>

    <section v-else-if="updateState.latest && updateState.hasUpdate" class="card release-card">
      <div class="release-head">
        <div>
          <h2>{{ updateState.latest.tag }}</h2>
          <p>
            发布于 {{ formatDate(updateState.latest.publishedAt) }}
            <template v-if="updateState.latest.apkSize"> · {{ formatSize(updateState.latest.apkSize) }}</template>
          </p>
        </div>
        <span class="badge">新版本</span>
      </div>

      <pre v-if="notes" class="notes">{{ notes }}</pre>

      <div v-if="updateState.downloading" class="download-progress">
        <div class="bar"><span :style="{ width: `${Math.round(updateState.progress * 100)}%` }" /></div>
        <p>正在下载安装包… {{ Math.round(updateState.progress * 100) }}%</p>
      </div>

      <p v-if="updateState.needsPermission" class="permission-hint">
        已打开「安装未知应用」设置，为本应用打开权限后，回到这里再点一次即可。
      </p>
      <p v-if="updateState.error" class="error-text">{{ updateState.error }}</p>

      <div class="release-actions">
        <button class="btn" :disabled="updateState.downloading || updateState.installing" @click="install">
          <Icon name="download" :size="17" />
          {{
            updateState.downloading
              ? '下载中…'
              : updateState.installing
                ? '正在安装…'
                : updateState.downloadedFileName
                  ? '安装已下载的更新'
                  : '下载并安装'
          }}
        </button>
        <button
          class="btn secondary"
          @click="updateState.downloadedFileName ? downloadUpdate(true) : openReleasePage()"
        >
          {{ updateState.downloadedFileName ? '重新下载' : '在浏览器打开' }}
        </button>
      </div>
      <button class="ignore-btn" @click="ignoreLatest">忽略这个版本</button>
    </section>

    <section v-else class="card status-card">
      <template v-if="updateState.latest">
        <div class="up-to-date">
          <span class="check-dot"><Icon name="check" :size="16" /></span>
          已是最新版本
        </div>
        <p class="muted">最新发布：{{ updateState.latest.tag }}</p>
      </template>
      <template v-else>
        <p>{{ updateState.error || '还没有检查过更新' }}</p>
        <button class="btn secondary" style="margin-top: 12px" @click="checkForUpdate({ force: true })">
          检查更新
        </button>
      </template>
    </section>

    <div class="card panel">
      <div class="list-item" style="padding-left: 0; padding-right: 0; border-bottom: 0">
        <div class="info">
          <h3>自动检查更新</h3>
          <p>启动时每天最多检查一次，发现新版本会发通知</p>
        </div>
        <button
          class="switch"
          :class="{ on: updateState.autoCheck }"
          aria-label="自动检查更新"
          @click="setAutoCheck(!updateState.autoCheck)"
        />
      </div>
    </div>

    <p class="footnote">
      更新包来自本项目的 GitHub Release，使用与当前应用相同的签名覆盖安装，不会清除收藏、歌单和下载记录。
    </p>
  </div>
</template>

<style scoped>
.current-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  margin-top: 6px;
}
.current-card img {
  width: 54px;
  height: 54px;
  border-radius: 16px;
}
.current-info h2 {
  font-size: 15.5px;
}
.current-info p {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
}
.muted {
  color: var(--muted-2) !important;
}
.status-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 26px 20px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.up-to-date {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.check-dot {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #fff;
  background: var(--brand);
}
.release-card {
  padding: 16px;
  margin-top: 12px;
}
.release-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.release-head h2 {
  font-size: 20px;
}
.release-head p {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--muted);
}
.badge {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
}
.notes {
  margin-top: 14px;
  max-height: 300px;
  overflow: auto;
  padding: 12px;
  border-radius: 14px;
  background: rgba(127, 127, 127, 0.06);
  font-size: 12px;
  line-height: 1.75;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
.download-progress {
  margin-top: 14px;
}
.download-progress .bar {
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--brand-soft);
}
.download-progress .bar span {
  display: block;
  height: 100%;
  background: var(--brand);
  border-radius: 999px;
  transition: width 0.25s ease;
}
.download-progress p {
  margin-top: 7px;
  font-size: 11px;
  color: var(--muted);
}
.release-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.permission-hint {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--brand);
  background: var(--brand-soft);
}
.error-text {
  margin-top: 12px;
  font-size: 12px;
  color: #e05353;
}
.ignore-btn {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--muted-2);
  text-decoration: underline;
}
.panel {
  padding: 4px 16px;
  margin-top: 12px;
}
.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--brand-soft);
  border-top-color: var(--brand);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.footnote {
  margin: 18px 6px 8px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--muted-2);
  text-align: center;
}
</style>
