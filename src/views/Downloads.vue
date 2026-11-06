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
import { playTrack, playTracks } from '@/core/playback/player'
import { notify } from '@/core/plugin/manager'
import { qualityLabel } from '@/core/quality'

const router = useRouter()
const summary = computed(() => downloadSummary())
const tasks = computed(() => downloadState.tasks)

const activeTasks = computed(() =>
  tasks.value.filter((task) => task.status === 'downloading' || task.status === 'queued')
)
const interruptedTasks = computed(() =>
  tasks.value.filter((task) => task.status === 'failed' || task.status === 'cancelled')
)
const completedTasks = computed(() => tasks.value.filter((task) => task.status === 'completed'))
const completedSize = computed(() =>
  formatSize(completedTasks.value.reduce((total, task) => total + (task.size || 0), 0))
)

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDuration(durationMs: number): string {
  if (!durationMs || durationMs <= 0) return ''
  const total = Math.round(durationMs / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function qualityTag(task: DownloadTask): string {
  return task.quality ? qualityLabel(task.quality) : ''
}

function queuePosition(task: DownloadTask): number {
  return activeTasks.value.findIndex((item) => item.id === task.id) + 1
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

function playAll(): void {
  if (!completedTasks.value.length) return
  void playTracks(completedTasks.value.map((task) => task.track))
}

async function retry(task: DownloadTask): Promise<void> {
  retryTask(task.id)
}

function retryAll(): void {
  if (!interruptedTasks.value.length) return
  interruptedTasks.value.forEach((task) => retryTask(task.id))
  notify(`已重新加入 ${interruptedTasks.value.length} 个下载`)
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

function queueHint(task: DownloadTask): string {
  if (task.status !== 'queued') return ''
  const position = queuePosition(task)
  return position > 0 ? `队列第 ${position} 位` : '等待空闲下载位'
}

function percent(task: DownloadTask): string {
  if (task.status === 'queued') return '—'
  return `${Math.round(task.progress * 100)}%`
}

function completedMeta(task: DownloadTask): string {
  const duration = formatDuration(task.track.durationMs)
  return [task.track.artist, formatSize(task.size), duration].filter(Boolean).join(' · ')
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
          <div class="eyebrow">CERU MUSIC · 离线</div>
          <h1 class="headline">下载</h1>
        </div>
        <div class="page-actions">
          <button
            class="iconbtn soft trashbtn"
            aria-label="清理已完成"
            :disabled="!summary.completed"
            @click="clearAll"
          >
            <Icon name="trash" :size="19" />
            <span v-if="summary.completed" class="count">{{ summary.completed }}</span>
          </button>
        </div>
      </header>

      <template v-if="tasks.length">
        <div class="sum">
          <div class="cell">
            <div class="n">{{ summary.completed }}<small>首</small></div>
            <div class="t">已完成</div>
          </div>
          <div class="cell live">
            <div class="n">{{ summary.active }}</div>
            <div class="t">进行中</div>
          </div>
          <div class="cell bad">
            <div class="n">{{ summary.failed }}</div>
            <div class="t">失败</div>
          </div>
        </div>

        <section v-if="activeTasks.length" class="psec">
          <div class="group-title">
            <span class="cn">进行中</span>
            <span class="cnt">{{ activeTasks.length }}</span>
            <span class="en">Downloading</span>
          </div>
          <div class="pgrp">
            <div v-for="task in activeTasks" :key="task.id" class="prow tall">
              <div class="pcv">
                <img :src="task.track.artwork" alt="" loading="lazy" />
              </div>
              <div class="pmain">
                <div class="ptt truncate">{{ task.track.title }}</div>
                <div class="pst">
                  {{ statusText(task)
                  }}<template v-if="qualityTag(task)"> · {{ qualityTag(task) }}</template
                  ><template v-if="queueHint(task)"> · {{ queueHint(task) }}</template>
                </div>
                <div
                  v-if="task.status === 'downloading'"
                  class="pbar"
                  :class="{ wait: task.total <= 0 }"
                >
                  <i :style="{ width: `${Math.round(task.progress * 100)}%` }" />
                </div>
              </div>
              <div class="ppct" :class="{ muted: task.status === 'queued' }">{{ percent(task) }}</div>
              <button class="px" aria-label="取消下载" @click="cancelTask(task.id)">
                <Icon name="close" :size="16" />
              </button>
            </div>
          </div>
        </section>

        <section v-if="interruptedTasks.length" class="psec">
          <div class="group-title">
            <span class="cn">失败</span>
            <span class="cnt">{{ interruptedTasks.length }}</span>
            <span class="en">Interrupted</span>
            <button class="act" @click="retryAll">全部重试</button>
          </div>
          <div class="pgrp">
            <div v-for="task in interruptedTasks" :key="task.id" class="prow tall">
              <div class="pcv">
                <img :src="task.track.artwork" alt="" loading="lazy" />
              </div>
              <div class="pmain">
                <div class="ptt truncate">{{ task.track.title }}</div>
                <div class="pst">
                  <span class="flag" :class="{ warn: task.status === 'cancelled' }">
                    <i class="d" />{{ statusLabel(task) }} · {{ statusText(task) }}
                  </span>
                </div>
                <div class="ptt2">
                  {{ task.track.artist }} · 已缓存 {{ formatSize(task.received) }}
                </div>
              </div>
              <button class="pretry" @click="retry(task)">重试</button>
              <button class="pmore" aria-label="删除记录" @click="remove(task)">
                <Icon name="trash" :size="15" />
              </button>
            </div>
          </div>
        </section>

        <section v-if="completedTasks.length" class="psec">
          <div class="group-title">
            <span class="cn">已完成</span>
            <span class="cnt">{{ completedTasks.length }} · {{ completedSize }}</span>
            <span class="en">Offline</span>
            <button class="act" @click="playAll">全部播放</button>
          </div>
          <div class="pgrp">
            <div v-for="task in completedTasks" :key="task.id" class="prow">
              <div class="pcv sm">
                <img :src="task.track.artwork" alt="" loading="lazy" />
              </div>
              <div class="pmain">
                <div class="ptt truncate">
                  {{ task.track.title }}
                  <span v-if="qualityTag(task)" class="tag">{{ qualityTag(task) }}</span>
                </div>
                <div class="ptt2 truncate">{{ completedMeta(task) }}</div>
              </div>
              <button class="ibtn" aria-label="播放" @click="play(task)">
                <Icon name="play" :size="15" />
              </button>
              <button class="pmore" aria-label="删除文件和记录" @click="remove(task)">
                <Icon name="trash" :size="15" />
              </button>
            </div>
          </div>
        </section>

        <p class="foot">
          文件保存在应用专属目录，只能在本应用内播放；卸载应用或在系统设置中清除数据会一并删除。<br />
          下载中退出应用的任务，下次启动会标记为「上次下载被中断」。
        </p>
      </template>

      <div v-else class="empty">
        <div class="glyph"><Icon name="download" :size="30" /></div>
        <h3>还没有下载</h3>
        <p>下载的歌会存到这台设备上，离线也能播放。</p>
        <button class="btn btn-primary" @click="router.push('/search')">去搜索</button>
      </div>
    </div>
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
.trashbtn {
  position: relative;
}
.trashbtn:disabled {
  opacity: 0.38;
}
.trashbtn .count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--tint-soft);
  color: var(--tint);
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--porcelain);
}

.sum {
  display: flex;
  margin: 19px var(--pad) 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
}
.sum .cell {
  flex: 1;
  position: relative;
  padding: 15px 0 13px;
  text-align: center;
}
.sum .cell + .cell::before {
  content: '';
  position: absolute;
  left: 0;
  top: 17px;
  bottom: 15px;
  width: 1px;
  background: var(--line);
}
.sum .n {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
}
.sum .n small {
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-4);
  margin-left: 2px;
}
.sum .t {
  margin-top: 7px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.sum .cell.live .n {
  color: var(--tint);
}
.sum .cell.bad .n {
  color: var(--cinnabar);
}

.psec {
  margin-top: 26px;
}
.pgrp {
  margin: 0 var(--pad);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.prow {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  min-height: 64px;
  padding: 0 16px;
}
.prow.tall {
  min-height: 86px;
  padding-top: 13px;
  padding-bottom: 13px;
}
.prow + .prow::before {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--line);
}
.pcv {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  overflow: hidden;
  flex: none;
  background: var(--porcelain-2);
}
.pcv.sm {
  width: 40px;
  height: 40px;
  border-radius: 9px;
}
.pcv img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pmain {
  flex: 1;
  min-width: 0;
}
.ptt {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.005em;
}
.pst {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ptt2 {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.pbar {
  height: 3px;
  margin-top: 9px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--line-2);
}
.pbar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--tint);
  transition: width 0.25s var(--e-out);
}
.pbar.wait i {
  background: var(--c300);
}
.ppct {
  width: 36px;
  flex: none;
  text-align: right;
  font-size: 12px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.ppct.muted {
  color: var(--ink-4);
}
.px {
  width: 44px;
  height: 44px;
  margin-right: -12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--ink-4);
}
.ibtn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.ibtn::after {
  content: '';
  position: absolute;
  inset: -4px;
}
.pmore {
  width: 30px;
  height: 44px;
  margin-right: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--ink-4);
}
.pretry {
  position: relative;
  height: 30px;
  padding: 0 13px;
  border-radius: 15px;
  border: 1px solid var(--line-2);
  background: var(--surface);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  flex: none;
}
.pretry::after {
  content: '';
  position: absolute;
  inset: -7px -6px;
}
.flag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--cinnabar);
}
.flag.warn {
  color: var(--ink-3);
}
.flag .d {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.tag {
  margin-left: 6px;
  padding: 1px 4px;
  border: 1px solid var(--line-2);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-4);
  vertical-align: 1px;
}
.foot {
  padding: 22px var(--pad) 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-4);
  letter-spacing: 0.01em;
}
.empty {
  padding-top: 96px;
}
</style>
