<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import OptionSheet from '@/components/OptionSheet.vue'
import {
  checkForUpdate,
  downloadUpdate,
  ignoreVersion,
  installDownloadedUpdate,
  openReleasePage,
  probeMirrors,
  setAutoCheck,
  setMirrorAuto,
  setMirrorBackup,
  setMirrorPrimary,
  updateState
} from '@/core/updater'
import { MIRRORS } from '@/core/update-mirror'

const router = useRouter()
const REPO_URL = 'https://github.com/baipiao5555/CeruMusic-Mobile'

/** 下载加速：正在挑主用 / 备用线路 */
const mirrorPicker = ref<'primary' | 'backup' | null>(null)

function speedText(id: string): string {
  const value = updateState.mirrorSpeed[id]
  if (value == null) return ''
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

const mirrorOptions = computed(() =>
  MIRRORS.map((mirror) => {
    const speed = speedText(mirror.id)
    const desc = mirror.id === 'direct' ? '仅在反代全部失败时使用' : speed ? `${mirror.hint} · ${speed}` : mirror.hint
    return { value: mirror.id, label: mirror.label, desc }
  })
)

const mirrorPickMeta = computed(() => ({
  title: mirrorPicker.value === 'backup' ? '备用下载线路' : '主用下载线路',
  sub: '下载安装包时先走主用，失败自动换备用',
  value: mirrorPicker.value === 'backup' ? updateState.mirrorBackup : updateState.mirrorPrimary
}))

function applyMirrorPick(value: string | number): void {
  const id = String(value)
  if (mirrorPicker.value === 'backup') setMirrorBackup(id)
  else setMirrorPrimary(id)
  mirrorPicker.value = null
}

function findLabel(id: string): string {
  return MIRRORS.find((mirror) => mirror.id === id)?.label ?? '未选择'
}

const mirrorSummary = computed(() => {
  if (updateState.probingMirrors) return '正在测试各条反代线路'
  const entries = MIRRORS.map((mirror) => ({ mirror, ms: updateState.mirrorSpeed[mirror.id] })).filter(
    (item) => item.ms != null
  )
  if (!entries.length) return '尚未测速，默认 ghfast → gh-proxy'
  const fastest = entries.sort((a, b) => (a.ms as number) - (b.ms as number))[0]
  return `${entries.length} 条可用 · 最快 ${fastest.mirror.label} ${speedText(fastest.mirror.id)}`
})

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

const statusTitle = computed(() => {
  if (updateState.checking) return '正在检查更新…'
  if (updateState.error) return '检查更新失败'
  if (!updateState.latest) return '还没有检查过更新'
  if (updateState.hasUpdate) return `发现新版本 ${updateState.latest.tag}`
  return '已是最新版本'
})

const statusDetail = computed(() => {
  if (updateState.checking) return '直连不通会自动换反代读取'
  if (updateState.error) return updateState.error
  if (!updateState.latest) return '联网后点右侧按钮再试一次'
  if (updateState.hasUpdate) {
    const published = formatDate(updateState.latest.publishedAt)
    const size = formatSize(updateState.latest.apkSize)
    const line = updateState.downloading && updateState.activeMirror ? `线路 ${updateState.activeMirror}` : ''
    return [published && `发布于 ${published}`, size, line].filter(Boolean).join(' · ')
  }
  return `${lastCheckedText.value} 检查 · 最新 ${updateState.latest.tag}`
})

const installLabel = computed(() => {
  if (updateState.installing) return '正在安装…'
  if (updateState.downloading) return `下载中 ${Math.round(updateState.progress * 100)}%`
  if (updateState.downloadedFileName) return '安装已下载的更新'
  return '下载并安装'
})

const statusIcon = computed(() => {
  if (updateState.checking) return 'refresh'
  if (updateState.error) return 'warning'
  if (updateState.hasUpdate) return 'download'
  return 'check'
})

onMounted(() => {
  if (!updateState.latest) void checkForUpdate({ silent: true })
})
</script>

<template>
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="navrow">
        <button class="backpill" @click="router.back()">
          <Icon name="chevron-left" :size="13" />
          <span>我的</span>
        </button>
        <span class="f1" />
        <button
          class="iconbtn soft"
          aria-label="检查更新"
          :disabled="updateState.checking"
          @click="checkForUpdate({ force: true })"
        >
          <Icon name="refresh" :size="18" />
        </button>
      </div>

      <header class="page-head phead">
        <div>
          <div class="eyebrow">设置 · 软件更新</div>
          <h1 class="headline">检查更新</h1>
        </div>
      </header>

      <section class="hero">
        <div class="hero-top">
          <div class="appicon">澜</div>
          <div class="appmeta">
            <div class="appname">澜音 · CeruMusic</div>
            <div class="appsub">Android · 插件协议 v2.0</div>
          </div>
          <span class="chipbadge">{{ updateState.hasUpdate ? '可更新' : '稳定版' }}</span>
        </div>
        <div class="hero-hair" />
        <div class="verline">
          <div class="ver">v{{ updateState.currentVersion }}</div>
          <div class="vermeta">
            <span>已安装</span>
            <template v-if="updateState.latest">
              <span class="dotsep">·</span>
              <span>{{
                updateState.hasUpdate
                  ? `可更新到 ${updateState.latest.tag}`
                  : `最新 ${updateState.latest.tag}`
              }}</span>
            </template>
          </div>
        </div>
        <div
          class="band"
          :class="{ bad: !!updateState.error && !updateState.checking, live: updateState.checking }"
        >
          <span class="bdot">
            <Icon :name="statusIcon" :size="13" />
          </span>
          <div class="btext">
            <div class="bt">{{ statusTitle }}</div>
            <div class="bs">{{ statusDetail }}</div>
          </div>
          <button
            class="recheck"
            :disabled="updateState.checking"
            @click="checkForUpdate({ force: true })"
          >
            {{ updateState.checking ? '检查中' : updateState.error ? '重试' : '再次检查' }}
          </button>
        </div>
      </section>

      <template v-if="updateState.hasUpdate && updateState.latest">
        <div class="group-title">
          <span class="cn">更新内容</span>
          <span class="cnt">{{ updateState.latest.tag }}</span>
          <span class="en">Release</span>
        </div>
        <div class="pgrp rel">
          <pre class="notes">{{ notes || '这个版本没有填写更新说明。' }}</pre>

          <div v-if="updateState.downloading" class="dl">
            <div class="progress">
              <span
                class="fill"
                :style="{ width: `${Math.round(updateState.progress * 100)}%` }"
              />
            </div>
            <span class="pct">{{ Math.round(updateState.progress * 100) }}%</span>
          </div>

          <p v-if="updateState.needsPermission" class="hint">
            安装前需要在系统设置里允许「安装未知应用」，授权后返回再点一次安装。
          </p>
          <p v-if="updateState.error" class="hint bad">{{ updateState.error }}</p>

          <div class="btnrow">
            <button
              class="btn btn-primary f1"
              :disabled="updateState.downloading || updateState.installing"
              @click="install"
            >
              {{ installLabel }}
            </button>
            <button
              class="btn btn-ghost"
              :disabled="updateState.downloading"
              @click="updateState.downloadedFileName ? downloadUpdate(true) : openReleasePage()"
            >
              {{ updateState.downloadedFileName ? '重新下载' : '在浏览器打开' }}
            </button>
          </div>
          <button class="btn btn-ghost btn-block ignore" @click="ignoreLatest">忽略这个版本</button>
        </div>
      </template>

      <div class="group-title">
        <span class="cn">下载加速</span>
        <span class="en">Mirror</span>
      </div>
      <div class="pgrp">
        <div
          class="settingrow pickrow"
          role="button"
          tabindex="0"
          @click="mirrorPicker = 'primary'"
          @keydown.enter.prevent="mirrorPicker = 'primary'"
          @keydown.space.prevent="mirrorPicker = 'primary'"
        >
          <span class="ico"><Icon name="download" :size="15" /></span>
          <div class="body">
            <div class="lab">主用线路</div>
            <div class="sub">下载安装包时优先走这条</div>
          </div>
          <span class="val">{{ findLabel(updateState.mirrorPrimary) }}</span>
          <Icon name="chevron-down" :size="13" />
        </div>
        <div
          class="settingrow pickrow"
          role="button"
          tabindex="0"
          @click="mirrorPicker = 'backup'"
          @keydown.enter.prevent="mirrorPicker = 'backup'"
          @keydown.space.prevent="mirrorPicker = 'backup'"
        >
          <span class="ico"><Icon name="swap" :size="15" /></span>
          <div class="body">
            <div class="lab">备用线路</div>
            <div class="sub">主用失败时自动接上</div>
          </div>
          <span class="val">{{ findLabel(updateState.mirrorBackup) }}</span>
          <Icon name="chevron-down" :size="13" />
        </div>
        <div class="settingrow">
          <span class="ico"><Icon name="timer" :size="15" /></span>
          <div class="body">
            <div class="lab">按测速自动排序</div>
            <div class="sub">测速后把最快的线路放到前面</div>
          </div>
          <button
            class="switch"
            :class="{ on: updateState.mirrorAuto }"
            role="switch"
            :aria-checked="updateState.mirrorAuto"
            aria-label="按测速自动排序"
            @click="setMirrorAuto(!updateState.mirrorAuto)"
          />
        </div>
        <button class="settingrow linkrow" :disabled="updateState.probingMirrors" @click="probeMirrors">
          <span class="ico"><Icon name="refresh" :size="15" /></span>
          <div class="body">
            <div class="lab">{{ updateState.probingMirrors ? '正在测速…' : '测速并保存' }}</div>
            <div class="sub">{{ mirrorSummary }}</div>
          </div>
          <Icon name="chevron" :size="14" />
        </button>
      </div>

      <div class="group-title">
        <span class="cn">更新设置</span>
        <span class="en">Update</span>
      </div>
      <div class="pgrp">
        <div class="settingrow">
          <span class="ico"><Icon name="refresh" :size="15" /></span>
          <div class="body">
            <div class="lab">自动检查更新</div>
            <div class="sub">启动时静默检查，发现新版本再提示</div>
          </div>
          <button
            class="switch"
            :class="{ on: updateState.autoCheck }"
            role="switch"
            :aria-checked="updateState.autoCheck"
            aria-label="自动检查更新"
            @click="setAutoCheck(!updateState.autoCheck)"
          />
        </div>
      </div>

      <div class="group-title">
        <span class="cn">关于</span>
        <span class="en">About</span>
      </div>
      <div class="pgrp">
        <div class="settingrow">
          <span class="ico"><Icon name="music" :size="15" /></span>
          <div class="body">
            <div class="lab">应用名称</div>
          </div>
          <span class="val">澜音 CeruMusic 手机版</span>
        </div>
        <a class="settingrow linkrow" :href="REPO_URL" target="_blank" rel="noreferrer">
          <span class="ico"><Icon name="link" :size="15" /></span>
          <div class="body">
            <div class="lab">开源地址</div>
            <div class="sub">GitHub · baipiao5555/CeruMusic-Mobile</div>
          </div>
          <Icon name="chevron" :size="14" />
        </a>
        <div class="settingrow">
          <span class="ico"><Icon name="info" :size="15" /></span>
          <div class="body">
            <div class="lab">开源许可</div>
            <div class="sub">衍生自 CeruMusic，遵循上游许可</div>
          </div>
          <span class="val">AGPL-3.0-only</span>
        </div>
      </div>

      <p class="foot">
        更新包来自本项目的 GitHub Release，使用与当前应用相同的签名覆盖安装，不会清除收藏、歌单和下载记录。
        下载会先走主用线路，失败自动换备用，最后才回落到直连 GitHub。
      </p>
    </div>

    <OptionSheet
      :open="mirrorPicker !== null"
      :title="mirrorPickMeta.title"
      :sub="mirrorPickMeta.sub"
      :options="mirrorOptions"
      :value="mirrorPickMeta.value"
      @close="mirrorPicker = null"
      @pick="applyMirrorPick"
    />
  </div>
</template>

<style scoped>
.navrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px var(--pad) 0;
}
.backpill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0 14px 0 10px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--sh-1);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  position: relative;
}
.backpill::after {
  content: '';
  position: absolute;
  inset: -3px -2px;
}
.phead {
  padding-top: 9px;
}
.headline {
  margin-top: 7px;
}
.hero {
  margin: 19px var(--pad) 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--sh-2);
  overflow: hidden;
}
.hero-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 11px;
}
.appicon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--tint);
  background: linear-gradient(140deg, var(--surface) 0%, var(--tint-softer) 100%);
  border: 1px solid var(--line);
  flex: none;
}
.appmeta {
  flex: 1;
  min-width: 0;
}
.appname {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.appsub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.chipbadge {
  height: 20px;
  padding: 0 7px;
  border-radius: var(--r-xs);
  background: var(--tint-soft);
  color: var(--tint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  flex: none;
}
.hero-hair {
  height: 1px;
  background: var(--line);
}
.verline {
  padding: 10px 16px 11px;
}
.ver {
  font-family: var(--serif);
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.vermeta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.02em;
}
.band {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 8px 16px;
  background: var(--tint-softer);
}
.band.bad {
  background: color-mix(in oklab, var(--cinnabar) 8%, var(--surface));
}
.bdot {
  width: 23px;
  height: 23px;
  border-radius: 50%;
  background: var(--tint-soft);
  color: var(--tint);
  display: grid;
  place-items: center;
  flex: none;
}
.band.bad .bdot {
  background: color-mix(in oklab, var(--cinnabar) 14%, var(--surface));
  color: var(--cinnabar);
}
.band.live .bdot .i {
  animation: spin 1.1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.btext {
  flex: 1;
  min-width: 0;
}
.bt {
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: 0.005em;
}
.bs {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recheck {
  position: relative;
  height: 32px;
  padding: 0 13px;
  border-radius: 15px;
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
  flex: none;
}
.recheck::after {
  content: '';
  position: absolute;
  inset: -6px -4px;
}
.recheck:disabled {
  opacity: 0.45;
}
.pgrp {
  margin: 0 var(--pad);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.rel {
  padding: 14px 16px 16px;
}
.notes {
  margin: 0;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.65;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}
.dl {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 13px;
}
.progress {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--line-2);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--tint);
  transition: width 0.25s var(--e-out);
}
.pct {
  font-size: 11px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.hint {
  margin-top: 11px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--porcelain-2);
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-3);
}
.hint.bad {
  color: var(--cinnabar);
}
.btnrow {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.ignore {
  margin-top: 10px;
}
.linkrow {
  color: inherit;
  text-decoration: none;
}
.linkrow .val {
  color: var(--ink-3);
}
.foot {
  padding: 20px var(--pad) 0;
  font-size: 11px;
  line-height: 1.75;
  color: var(--ink-4);
}
</style>
