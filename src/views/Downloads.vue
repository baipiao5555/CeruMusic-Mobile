<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import {
  cancelTask,
  clearCompleted,
  downloadState,
  downloadSummary,
  removeTask,
  retryTask,
  type DownloadTask
} from '@/core/downloads'
import { playTrack } from '@/core/playback/player'
import { notify } from '@/core/plugin/manager'

const router = useRouter()
const summary = computed(() => downloadSummary())
const tasks = computed(() => downloadState.tasks)

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function statusText(task: DownloadTask): string {
  if (task.status === 'downloading') {
    return task.total > 0
      ? `${formatSize(task.received)} / ${formatSize(task.total)}`
      : `${formatSize(task.received)} · 下载中`
  }
  if (task.status === 'queued') return '等待下载'
  if (task.status === 'completed') return `${formatSize(task.size)} · 已下载`
  if (task.status === 'cancelled') return '已取消'
  return task.error || '下载失败'
}

function statusLabel(task: DownloadTask): string {
  if (task.status === 'downloading') return '下载中'
  if (task.status === 'queued') return '排队中'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'cancelled') return '已取消'
  return '失败'
}

function play(task: DownloadTask): void {
  void playTrack(task.track)
}

async function retry(task: DownloadTask): Promise<void> {
  retryTask(task.id)
}

async function remove(task: DownloadTask): Promise<void> {
  const action = task.status === 'completed' ? '删除文件和下载记录' : '移除这条下载记录'
  if (!window.confirm(`${action}？`)) return
  await removeTask(task.id, true)
}

async function clearAll(): Promise<void> {
  if (!summary.value.completed) return
  if (!window.confirm(`删除全部 ${summary.value.completed} 个已下载文件？`)) return
  await clearCompleted()
  notify('已清理下载文件')
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="brand-name" style="font-size: 20px">下载</div>
      <button
        class="icon-btn"
        aria-label="清理已完成"
        :disabled="!summary.completed"
        @click="clearAll"
      >
        <Icon name="trash" :size="19" />
      </button>
    </header>

    <section class="card summary">
      <div class="summary-icon"><Icon name="download" :size="24" /></div>
      <div class="summary-info">
        <h2>离线歌曲</h2>
        <p>
          {{ summary.completed }} 首已下载<span v-if="summary.active"> · {{ summary.active }} 首进行中</span
          ><span v-if="summary.failed"> · {{ summary.failed }} 首失败</span>
        </p>
      </div>
    </section>

    <div v-if="tasks.length" class="task-list">
      <div v-for="task in tasks" :key="task.id" class="task card">
        <div class="task-cover">
          <img :src="task.track.artwork" alt="" loading="lazy" />
        </div>
        <div class="task-body">
          <div class="task-head">
            <h3>{{ task.track.title }}</h3>
            <span class="badge" :class="task.status">{{ statusLabel(task) }}</span>
          </div>
          <p class="task-artist">{{ task.track.artist }}</p>
          <div
            v-if="task.status === 'downloading' || task.status === 'queued'"
            class="progress"
            :class="{ indeterminate: task.status === 'downloading' && task.total <= 0 }"
          >
            <span :style="{ width: `${Math.round(task.progress * 100)}%` }" />
          </div>
          <p class="task-status" :class="{ error: task.status === 'failed' }">
            {{ statusText(task) }}
          </p>
        </div>
        <div class="task-actions">
          <button
            v-if="task.status === 'completed'"
            class="icon-action"
            aria-label="播放"
            @click="play(task)"
          >
            <Icon name="play" :size="19" />
          </button>
          <button
            v-if="task.status === 'queued' || task.status === 'downloading'"
            class="icon-action"
            aria-label="取消下载"
            @click="cancelTask(task.id)"
          >
            <Icon name="close" :size="18" />
          </button>
          <button
            v-if="task.status === 'failed' || task.status === 'cancelled'"
            class="icon-action"
            aria-label="重试"
            @click="retry(task)"
          >
            <Icon name="refresh" :size="18" />
          </button>
          <button class="icon-action" aria-label="删除" @click="remove(task)">
            <Icon name="trash" :size="18" />
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <div class="emoji">⬇️</div>
      <h3>还没有下载歌曲</h3>
      <p>在任意歌曲右侧点下载按钮，下载完成后就能离线播放。</p>
      <button class="btn secondary" @click="router.push('/search')">去搜索音乐</button>
    </div>

    <p class="footnote">
      下载的文件保存在应用专属目录，只能在本应用内播放。卸载应用或在系统设置中清除数据会一并删除。
    </p>
  </div>
</template>

<style scoped>
.summary {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}
.summary-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 17px;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.summary-info h2 {
  font-size: 16px;
}
.summary-info p {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--muted);
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.task {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
}
.task-cover {
  width: 50px;
  height: 50px;
  border-radius: 13px;
  overflow: hidden;
  flex: 0 0 auto;
  background: var(--brand-soft);
}
.task-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.task-body {
  flex: 1;
  min-width: 0;
}
.task-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-head h3 {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--muted);
  background: var(--surface-2, rgba(127, 127, 127, 0.12));
}
.badge.downloading {
  color: var(--brand);
  background: var(--brand-soft);
}
.badge.completed {
  color: var(--brand);
  background: var(--brand-soft);
}
.badge.failed {
  color: #e05353;
  background: rgba(224, 83, 83, 0.12);
}
.task-artist {
  margin-top: 3px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress {
  position: relative;
  height: 4px;
  margin-top: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--brand-soft);
}
.progress span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--brand);
  transition: width 0.25s ease;
}
.progress.indeterminate span {
  width: 35% !important;
  animation: slide 1.1s ease-in-out infinite;
}
@keyframes slide {
  0% {
    transform: translateX(-40%);
  }
  100% {
    transform: translateX(300%);
  }
}
.task-status {
  margin-top: 5px;
  font-size: 10.5px;
  color: var(--muted-2);
}
.task-status.error {
  color: #e05353;
}
.task-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
}
.footnote {
  margin: 18px 6px 8px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--muted-2);
  text-align: center;
}
</style>
