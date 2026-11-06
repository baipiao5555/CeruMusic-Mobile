<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import Icon from '@/components/Icon.vue'
import { buildLogReport, clearLogs, logCounts, logState, type LogLevel } from '@/core/logs'
import { notify } from '@/core/plugin/manager'
import { pluginState } from '@/core/plugin/manager'
import { authState } from '@/core/auth'
import { readNativeDiagnostics } from '@/core/native/backgroundAudio'

const router = useRouter()
const route = useRoute()
const appVersion = __APP_VERSION__
const androidVersion = navigator.userAgent.match(/Android\s([\d.]+)/)?.[1]
const platformName =
  Capacitor.getPlatform() === 'android'
    ? androidVersion
      ? `Android ${androidVersion}`
      : 'Android'
    : Capacitor.getPlatform()
const LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const
type LevelFilter = (typeof LEVELS)[number]
const levelQuery = typeof route.query.level === 'string' ? route.query.level : ''
const initialLevel: LevelFilter = LEVELS.find((level) => level === levelQuery) ?? 'all'
const filter = ref<LevelFilter>(initialLevel)
const query = ref('')
const nativeEntries = ref<string[]>([])

onMounted(async () => {
  nativeEntries.value = await readNativeDiagnostics()
})

const counts = computed(() => logCounts())
const debugCount = computed(
  () => logState.entries.filter((entry) => entry.module === 'DEBUG').length
)
const entries = computed(() => {
  const all = [...logState.entries].reverse()
  if (filter.value === 'all') return all
  if (filter.value === 'debug') return all.filter((entry) => entry.module === 'DEBUG')
  return all.filter((entry) => entry.level === filter.value)
})

const visibleEntries = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return entries.value
  return entries.value.filter((entry) =>
    `${entry.module} ${entry.message} ${entry.detail ?? ''}`.toLowerCase().includes(term)
  )
})

const visibleNative = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return nativeEntries.value
  return nativeEntries.value.filter((line) => line.toLowerCase().includes(term))
})

const filterOptions = computed(() => [
  { value: 'all' as const, label: 'ALL', count: counts.value.total },
  { value: 'debug' as const, label: 'DEBUG', count: debugCount.value },
  {
    value: 'info' as const,
    label: 'INFO',
    count: Math.max(0, counts.value.total - counts.value.errors - counts.value.warns)
  },
  { value: 'warn' as const, label: 'WARN', count: counts.value.warns },
  { value: 'error' as const, label: 'ERROR', count: counts.value.errors }
])

function resetFilters(): void {
  filter.value = 'all'
  query.value = ''
}

function formatTime(time: number): string {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds()
  ).padStart(2, '0')}`
}

function levelLabel(level: LogLevel): string {
  if (level === 'error') return 'ERROR'
  if (level === 'warn') return 'WARN'
  return 'INFO'
}

function reportMeta(): Record<string, string> {
  return {
    应用版本: __APP_VERSION__,
    运行平台: platformName,
    设备信息: navigator.userAgent,
    屏幕: `${screen.width}x${screen.height} @${window.devicePixelRatio || 1}x`,
    插件:
      pluginState.plugins
        .map((plugin) => `${plugin.name}@${plugin.version}${plugin.running ? '' : '（未运行）'}`)
        .join(', ') || '无',
    账号: authState.authenticated ? '已登录' : '未登录'
  }
}

function makeReport(): string {
  let report = buildLogReport(reportMeta())
  if (nativeEntries.value.length) {
    report += `\n\n原生歌词 / 播放日志: ${nativeEntries.value.length} 条\n${'-'.repeat(42)}\n`
    report += nativeEntries.value.join('\n')
  }
  return report
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {}
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function copyAll(): Promise<void> {
  await copyText(makeReport())
  notify('日志已复制，粘贴到聊天里发送即可')
}

async function shareLogs(): Promise<void> {
  const text = makeReport()
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const fileName = `ceru-log-${stamp}.txt`
  try {
    if (typeof navigator.share === 'function' && typeof File === 'function') {
      const file = new File([text], fileName, { type: 'text/plain' })
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '澜音运行日志' })
        return
      }
      await navigator.share({ title: '澜音运行日志', text })
      return
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') return
  }
  await copyText(text)
  notify('当前环境不支持直接分享，日志已复制')
}

function clearAll(): void {
  if (!counts.value.total) return
  if (!window.confirm('清空全部运行日志？清空后无法恢复。')) return
  clearLogs()
  notify('运行日志已清空')
}
</script>

<template>
  <div class="screen">
    <div class="scroll safe-t-lg logs-scroll">
      <div class="navrow">
        <button class="iconbtn soft" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <span class="f1" />
        <button
          class="iconbtn soft trashbtn"
          aria-label="清空日志"
          :disabled="!counts.total"
          @click="clearAll"
        >
          <Icon name="trash" :size="19" />
        </button>
      </div>

      <header class="page-head phead">
        <div>
          <div class="eyebrow">CERU MUSIC · 诊断</div>
          <h1 class="headline">日志</h1>
        </div>
      </header>

      <div class="sum">
        <div class="cell">
          <div class="b">{{ counts.total }}<span>条</span></div>
          <div class="s">全部记录</div>
        </div>
        <div class="cell bad">
          <div class="b">{{ counts.errors }}<span>条</span></div>
          <div class="s">错误</div>
        </div>
        <div class="cell">
          <div class="b">{{ counts.warns }}<span>条</span></div>
          <div class="s">警告</div>
        </div>
      </div>

      <div class="sumline">
        <span>{{ appVersion }} · {{ platformName }}</span>
        <span>原生播放服务 {{ nativeEntries.length }} 条</span>
      </div>

      <div class="chips">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          class="chip"
          :class="{ active: filter === option.value, err: option.value === 'error' }"
          @click="filter = option.value"
        >
          {{ option.label }}<em>{{ option.count }}</em>
        </button>
      </div>

      <div class="searchfield">
        <Icon name="search" :size="16" />
        <input
          v-model="query"
          type="search"
          placeholder="搜索模块、内容或详情"
          aria-label="搜索日志"
        />
        <button v-if="query" class="clearq" aria-label="清除搜索" @click="query = ''">
          <Icon name="close" :size="14" />
        </button>
      </div>

      <template v-if="counts.total || nativeEntries.length">
        <div class="group-title">
          <span class="cn">日志</span>
          <span class="cnt">{{ visibleEntries.length }}</span>
          <span class="en">Latest</span>
        </div>

        <div v-if="visibleEntries.length" class="pgrp">
          <div v-for="entry in visibleEntries" :key="entry.id" class="log">
            <div class="ltop">
              <span class="time">{{ formatTime(entry.time) }}</span>
              <i class="sep" />
              <span class="mod">{{ entry.module }}</span>
              <span class="lv" :class="entry.level">{{ levelLabel(entry.level) }}</span>
            </div>
            <div class="msg">{{ entry.message }}</div>
            <div v-if="entry.detail" class="detail">{{ entry.detail }}</div>
          </div>
        </div>

        <div v-else class="empty-block">
          <Icon name="sort" :size="22" />
          <div class="et">{{ query ? '没有匹配的日志' : '该分类还没有日志' }}</div>
          <p class="ep">
            {{ query ? '换一个关键词，或清空搜索看看全部记录。' : '换一个级别，或稍后回来看看。' }}
          </p>
          <button class="btn btn-ghost btn-sm" @click="resetFilters">查看全部</button>
        </div>

        <template v-if="visibleNative.length">
          <div class="group-title">
            <span class="cn">原生播放服务</span>
            <span class="cnt">{{ visibleNative.length }} 条</span>
            <span class="en">Android</span>
          </div>
          <div class="pgrp">
            <div v-for="(line, index) in visibleNative" :key="index" class="nline">{{ line }}</div>
          </div>
        </template>

        <p class="foot">日志只存在本机，最多保留 1000 条，不含账号与密码。</p>
      </template>

      <div v-else class="empty">
        <div class="glyph"><Icon name="history" :size="30" /></div>
        <h3>还没有日志</h3>
        <p>运行日志关闭时不会记录；可以在 设置 · 数据 里打开。</p>
        <button class="btn btn-primary" @click="router.push('/settings')">去设置</button>
      </div>

      <div class="actions">
        <button
          class="btn btn-ghost f1"
          :disabled="!counts.total && !nativeEntries.length"
          @click="copyAll"
        >
          <Icon name="copy" :size="15" />复制全部
        </button>
        <button
          class="btn btn-tonal f1"
          :disabled="!counts.total && !nativeEntries.length"
          @click="shareLogs"
        >
          <Icon name="share" :size="15" />导出并分享
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs-scroll {
  padding-bottom: calc(var(--dock-h) + 96px);
}
.navrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px var(--pad) 0;
}
.navrow .iconbtn {
  width: 42px;
  height: 42px;
}
.phead {
  padding-top: 9px;
}
.headline {
  margin-top: 7px;
}
.trashbtn:disabled {
  opacity: 0.4;
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
  padding: 14px 0 12px;
  text-align: center;
}
.sum .cell + .cell::before {
  content: '';
  position: absolute;
  left: 0;
  top: 16px;
  bottom: 14px;
  width: 1px;
  background: var(--line);
}
.sum .b {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.sum .b span {
  margin-left: 2px;
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-4);
}
.sum .s {
  margin-top: 6px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.sum .cell.bad .b {
  color: var(--cinnabar);
}
.sumline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 4px 0;
  margin: 0 var(--pad);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.01em;
}
.chips {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  padding: 14px var(--pad) 0;
}
.chips .chip {
  flex: none;
  min-width: 0;
  height: 36px;
  padding: 0 2px;
  justify-content: center;
  position: relative;
  letter-spacing: 0.02em;
}
.chips .chip::after {
  content: '';
  position: absolute;
  inset: -3px 0;
}
.chips .chip em {
  margin-left: 4px;
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-4);
}
.chips .chip.active em {
  color: var(--tint);
}
.chips .chip.err {
  color: var(--cinnabar);
}
.chips .chip.err.active {
  color: var(--cinnabar);
  background: var(--tint-softer);
  border-color: transparent;
}
.searchfield {
  margin: 12px var(--pad) 0;
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
.pgrp {
  margin: 0 var(--pad);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.log {
  position: relative;
  padding: 14px 16px 15px;
}
.log + .log::before,
.nline + .nline::before {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--line);
}
.ltop {
  display: flex;
  align-items: center;
  gap: 7px;
}
.time {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.sep {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--ink-4);
  opacity: 0.7;
}
.mod {
  max-width: 44%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.lv {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.lv.error {
  color: var(--cinnabar);
}
.lv.warn {
  color: var(--ink-2);
}
.lv.info {
  color: var(--ink-4);
}
.msg {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-2);
  word-break: break-word;
}
.detail {
  margin-top: 9px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--porcelain-2);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.65;
  color: var(--ink-3);
  white-space: pre-wrap;
  word-break: break-all;
}
.nline {
  position: relative;
  padding: 10px 16px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-3);
  word-break: break-all;
  white-space: pre-wrap;
}
.empty-block {
  margin: 0 var(--pad);
  padding: 26px 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  background: var(--surface);
  border: 1px dashed var(--line-2);
  border-radius: var(--r-lg);
  color: var(--ink-4);
}
.empty-block .et {
  margin-top: 3px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.empty-block .ep {
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-4);
  max-width: 240px;
}
.empty-block .btn {
  margin-top: 7px;
}
.foot {
  padding: 20px var(--pad) 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-4);
}
.actions {
  display: flex;
  gap: 10px;
  margin: 18px var(--pad) 0;
}
.actions .btn {
  gap: 7px;
  font-size: 13px;
}
.empty {
  padding-top: 84px;
}
</style>
