<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import Icon from '@/components/Icon.vue'
import { buildLogReport, clearLogs, logCounts, logState, type LogLevel } from '@/core/logs'
import { notify } from '@/core/plugin/manager'
import { pluginState } from '@/core/plugin/manager'
import { authState } from '@/core/auth'

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
const initialLevel = route.query.level === 'error' ? 'error' : 'all'
const filter = ref<'all' | LogLevel>(initialLevel)

const counts = computed(() => logCounts())
const entries = computed(() =>
  filter.value === 'all'
    ? [...logState.entries].reverse()
    : [...logState.entries].reverse().filter((entry) => entry.level === filter.value)
)

const filterOptions = computed(() => [
  { value: 'all' as const, label: '全部', count: counts.value.total },
  { value: 'error' as const, label: '错误', count: counts.value.errors },
  { value: 'warn' as const, label: '警告', count: counts.value.warns },
  { value: 'info' as const, label: '信息', count: Math.max(0, counts.value.total - counts.value.errors - counts.value.warns) }
])

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
  return buildLogReport(reportMeta())
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
  <div class="page logs-page">    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="brand-name" style="font-size: 20px">运行日志</div>
      <button class="icon-btn" aria-label="清空日志" :disabled="!counts.total" @click="clearAll">
        <Icon name="trash" :size="19" />
      </button>
    </header>

    <section class="card summary">
      <div class="summary-icon"><Icon name="smartphone" :size="24" /></div>
      <div class="summary-info">
        <h2>{{ appVersion }} · {{ platformName }}</h2>
        <p>{{ counts.total }} 条日志<template v-if="counts.errors"> · {{ counts.errors }} 条错误</template><template v-if="counts.warns"> · {{ counts.warns }} 条警告</template></p>
      </div>
      <span v-if="counts.errors" class="error-badge">{{ counts.errors }} 错误</span>
    </section>

    <div class="filter-row">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        class="filter-chip"
        :class="{ active: filter === option.value }"
        @click="filter = option.value"
      >
        <span>{{ option.label }}</span>
        <span v-if="option.count" class="filter-count">{{ option.count }}</span>
      </button>
    </div>

    <div v-if="entries.length" class="log-list">
      <article v-for="entry in entries" :key="entry.id" class="log-row card">
        <div class="log-head">
          <span class="time">{{ formatTime(entry.time) }}</span>
          <span class="level" :class="entry.level">{{ levelLabel(entry.level) }}</span>
          <span class="module">{{ entry.module }}</span>
        </div>
        <p class="message">{{ entry.message }}</p>
        <pre v-if="entry.detail" class="detail">{{ entry.detail }}</pre>
      </article>
    </div>

    <div v-else class="empty">
      <div class="emoji">📄</div>
      <h3>{{ counts.total ? '这个分类下没有日志' : '还没有运行日志' }}</h3>
      <p>出问题时日志会自动记录在这里，可以直接复制或分享给开发者。</p>
    </div>

    <p class="footnote">日志只保存在本机，最多保留 1000 条；不记录账号密码、Cookie 和完整请求参数。</p>

    <div class="log-actions">
      <button class="btn secondary" :disabled="!counts.total" @click="copyAll">
        <Icon name="copy" :size="17" /> 复制全部
      </button>
      <button class="btn" :disabled="!counts.total" @click="shareLogs">
        <Icon name="share" :size="17" /> 导出并分享
      </button>
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  padding-bottom: calc(var(--nav-height) + 96px);
}
.summary {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px 16px;
}
.summary-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border-radius: 16px;
  color: var(--brand);
  background: var(--brand-soft);
}
.summary-info {
  flex: 1;
  min-width: 0;
}
.summary-info h2 {
  font-size: 13.5px;
}
.summary-info p {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.error-badge {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: 999px;
  color: #d94a35;
  background: rgba(217, 74, 53, 0.1);
  font-size: 10px;
  font-weight: 650;
}
.filter-row {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding: 14px 2px 10px;
  scrollbar-width: none;
}
.filter-row::-webkit-scrollbar {
  display: none;
}
.filter-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 550;
}
.filter-count {
  font-size: 10.5px;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}
.filter-chip.active {
  color: #fff;
  background: var(--brand);
  border-color: transparent;
  font-weight: 650;
}
.log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.log-row {
  padding: 9px 11px;
  border-radius: 14px;
}
.log-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.time {
  color: var(--muted-2);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.level {
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.03em;
}
.level.error {
  color: #cf4631;
  background: #ffe7e2;
}
.level.warn {
  color: #b37312;
  background: #fff1d8;
}
.level.info {
  color: #178a66;
  background: #e8f7ef;
}
.module {
  color: var(--muted-2);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.message {
  margin-top: 4px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text);
  word-break: break-word;
}
.detail {
  margin: 5px 0 0;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--muted);
  background: var(--brand-softer);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 9.5px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
.footnote {
  margin: 14px 4px 0;
  color: var(--muted-2);
  font-size: 10px;
  line-height: 1.5;
  text-align: center;
}
.log-actions {
  position: fixed;
  left: 50%;
  bottom: calc(var(--nav-height) + 14px);
  z-index: 40;
  display: flex;
  gap: 8px;
  width: min(calc(100% - 28px), 592px);
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--surface-solid);
  box-shadow: 0 14px 40px rgba(16, 60, 45, 0.18);
  transform: translateX(-50%);
}
.log-actions .btn {
  flex: 1;
}
.log-actions .btn:disabled {
  opacity: 0.4;
}
</style>
