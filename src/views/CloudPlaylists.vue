<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { authState, displayName, login, logout } from '@/core/auth'
import {
  cloudState,
  fetchCloudPlaylists,
  importAllCloudPlaylists,
  importCloudPlaylist,
  isCloudPlaylistImported,
  notifyImportResult,
  type CloudPlaylist
} from '@/core/cloud'
import { libraryState } from '@/core/library'
import { notify } from '@/core/plugin/manager'
import { confirmAction } from '@/core/confirm'

const router = useRouter()
const error = ref('')
const importingAll = ref(false)
const lastSync = ref('')

const importedCount = computed(
  () => libraryState.playlists.filter((playlist) => playlist.cloudId).length
)

function formatDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function localOf(cloud: CloudPlaylist) {
  return libraryState.playlists.find((playlist) => playlist.cloudId === cloud.id)
}

function isImported(cloud: CloudPlaylist): boolean {
  return isCloudPlaylistImported(cloud.id)
}

function hasRemoteUpdate(cloud: CloudPlaylist): boolean {
  const local = localOf(cloud)
  if (!local || !local.cloudUpdatedAt || !cloud.updatedAt) return false
  return Date.parse(cloud.updatedAt) > Date.parse(local.cloudUpdatedAt)
}

function subOf(cloud: CloudPlaylist): string {
  const local = localOf(cloud)
  const parts: string[] = []
  if (cloud.describe) parts.push(cloud.describe)
  if (local) parts.push(`${local.tracks.length} 首`)
  parts.push(`更新于 ${formatDate(cloud.updatedAt) || '未知时间'}`)
  return parts.join(' · ')
}

async function refresh(): Promise<void> {
  if (!authState.authenticated) return
  error.value = ''
  try {
    await fetchCloudPlaylists()
    const now = new Date()
    lastSync.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  } catch (err: any) {
    error.value = err?.message ?? '读取云歌单失败'
  }
}

async function startLogin(): Promise<void> {
  error.value = ''
  try {
    await login()
  } catch (err: any) {
    error.value = err?.message ?? '打开登录页失败'
  }
}

async function signOut(): Promise<void> {
  const ok = await confirmAction({
    title: '退出澜音账号？',
    body: '电脑端的登录状态不受影响，已导入到本机的歌单会保留。',
    confirmText: '退出',
    danger: true
  })
  if (!ok) return
  logout()
  cloudState.playlists = []
  lastSync.value = ''
  notify('已退出登录')
}

async function importOne(cloud: CloudPlaylist): Promise<void> {
  try {
    const result = await importCloudPlaylist(cloud)
    notifyImportResult(result)
  } catch (err: any) {
    notify(err?.message ?? '导入失败', 'error')
  }
}

async function importAll(): Promise<void> {
  if (importingAll.value) return
  importingAll.value = true
  try {
    const result = await importAllCloudPlaylists()
    notify(`已导入 ${result.playlists} 个歌单，共 ${result.tracks} 首歌曲`)
    router.push('/playlists')
  } catch (err: any) {
    notify(err?.message ?? '导入失败', 'error')
  } finally {
    importingAll.value = false
  }
}

function addService(): void {
  notify('当前版本只支持澜音云端账号，WebDAV / S3 接入在后续版本')
}

onMounted(() => {
  if (authState.authenticated) void refresh()
})
</script>

<template>
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="appbar">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <div class="ttl">云端歌单<span class="sub">Ceru Music · Cloud</span></div>
        <button
          v-if="authState.authenticated"
          class="iconbtn quiet"
          aria-label="刷新"
          title="刷新"
          :disabled="cloudState.loading"
          @click="refresh"
        >
          <Icon name="refresh" :size="19" :class="{ spin: cloudState.loading }" />
        </button>
        <span v-else class="appbar-hold" />
      </div>
      <template v-if="!authState.authenticated">
        <div class="empty login">
          <div class="glyph"><Icon name="cloud" :size="34" /></div>
          <h3>登录澜音账号</h3>
          <p>手机和电脑使用同一个澜音账号。在电脑版把歌单「上传到云端」后，这里就能直接导入到手机。</p>
          <button class="btn btn-primary mt8" @click="startLogin">
            <Icon name="user" :size="16" /> 登录
          </button>
          <p v-if="error" class="err">{{ error }}</p>
          <p class="hint">登录会打开系统浏览器，完成后自动回到澜音。</p>
        </div>
      </template>

      <template v-else>
        <section class="p-conn">
          <div class="top">
            <span class="cloud-ic"><Icon name="cloud" :size="20" /></span>
            <div class="f1">
              <div class="sv">澜音云端</div>
              <div class="ac">{{ displayName() }} · {{ authState.user?.email || '澜音账号' }}</div>
            </div>
            <span class="badge gold">已连接</span>
          </div>

          <div class="sum">
            <span>上次同步 <b class="num">{{ lastSync || '—' }}</b></span>
            <i class="d" />
            <span><b class="num">{{ cloudState.playlists.length }}</b> 个歌单</span>
            <i class="d" />
            <span><b class="num">{{ importedCount }}</b> 张已导入</span>
          </div>

          <div class="acts">
            <button class="p-sync" :disabled="cloudState.loading" @click="refresh">
              <Icon name="refresh" :size="15" />
              {{ cloudState.loading ? '同步中…' : '立即同步' }}
            </button>
            <button
              class="p-mini"
              :disabled="!cloudState.playlists.length || importingAll || Boolean(cloudState.importing)"
              @click="importAll"
            >
              <Icon name="download" :size="15" />
              {{ importingAll ? '导入中…' : '全部导入' }}
            </button>
            <button class="p-mini" @click="signOut"><Icon name="logout" :size="15" />退出</button>
          </div>
        </section>

        <button class="p-addsrc" @click="addService">
          <Icon name="plus" :size="15" />
          添加其他服务
          <span class="dim">WebDAV / S3 / OneDrive</span>
        </button>

        <div class="p-sh">
          <h2>全部歌单</h2>
          <span class="idx">Remote · {{ cloudState.playlists.length }}</span>
          <span class="more">{{ importedCount }} 张已导入</span>
        </div>

        <p v-if="error && cloudState.playlists.length" class="err pad-x">{{ error }}</p>

        <div v-if="cloudState.loading && !cloudState.playlists.length" class="sk-list">
          <div v-for="n in 3" :key="n" class="skeleton sk-row" />
        </div>

        <div v-else-if="error && !cloudState.playlists.length" class="empty err-state">
          <div class="glyph"><Icon name="warning" :size="34" /></div>
          <h3>读取云歌单失败</h3>
          <p>{{ error }}</p>
          <button class="btn btn-ghost btn-sm mt8" @click="refresh">重新读取</button>
        </div>

        <div v-else-if="cloudState.playlists.length" class="p-list">
          <div v-for="cloud in cloudState.playlists" :key="cloud.id" class="p-item">
            <div class="p-cv">
              <img
                v-if="cloud.cover && cloud.cover !== 'default-cover'"
                :src="cloud.cover"
                alt=""
               
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
              <Icon v-else name="music" :size="18" />
              <span class="cb"><Icon name="cloud" :size="11" /></span>
            </div>

            <div class="meta">
              <div class="nm truncate">{{ cloud.name }}</div>
              <div class="sub truncate">{{ subOf(cloud) }}</div>
            </div>

            <div class="p-state">
              <template v-if="cloudState.importing === cloud.id">
                <span class="p-st ing"><span class="dotg live" />{{ cloudState.importingLabel || '导入中…' }}</span>
                <span class="p-prog"><i /></span>
              </template>
              <template v-else-if="isImported(cloud) && hasRemoteUpdate(cloud)">
                <span class="p-st new"><span class="dotg" />远端有更新</span>
                <button class="p-go" @click="importOne(cloud)">更新</button>
              </template>
              <template v-else-if="isImported(cloud)">
                <span class="p-st done"><Icon name="check" :size="13" />已导入</span>
                <button class="p-go ghost" @click="importOne(cloud)">更新</button>
              </template>
              <template v-else>
                <span class="p-st idle">未导入</span>
                <button class="p-go" :disabled="Boolean(cloudState.importing)" @click="importOne(cloud)">导入</button>
              </template>
            </div>
          </div>
        </div>

        <div v-else class="empty">
          <div class="glyph"><Icon name="cloud" :size="34" /></div>
          <h3>云端还没有歌单</h3>
          <p>在电脑版打开歌单菜单，选择「上传到云端」，再回来点右上角刷新按钮即可看到。</p>
          <button class="btn btn-ghost btn-sm mt8" @click="refresh">点击刷新</button>
        </div>

        <p class="p-foot">
          只同步歌单信息（歌曲、歌手、专辑、音源引用），不会同步音乐文件。导入后如果某首歌的音源插件没有安装，会显示「未匹配音源」。
        </p>
      </template>

      <div class="scroll-end" />
    </div>
  </div>
</template>

<style scoped>
.appbar-hold {
  width: 40px;
  flex: none;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.login {
  padding-top: 56px;
}
.err-state .glyph {
  color: var(--cinnabar);
}
.login .err {
  margin-top: 10px;
  font-size: 12px;
  color: var(--cinnabar);
  text-align: center;
}
.login .hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--ink-4);
}
.p-conn {
  margin: 14px var(--pad) 0;
  padding: 15px 16px 13px;
  border-radius: 24px;
  background: linear-gradient(180deg, var(--surface), var(--surface-2));
  border: 1px solid var(--line);
  box-shadow: var(--sh-1);
}
.p-conn .top {
  display: flex;
  align-items: center;
  gap: 11px;
}
.cloud-ic {
  width: 36px;
  height: 36px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--tint-soft);
  color: var(--tint);
}
.p-conn .sv {
  font-size: 14px;
  font-weight: 650;
  color: var(--ink);
}
.p-conn .ac {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-conn .badge {
  flex: none;
}
.p-conn .sum {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
}
.p-conn .sum b {
  font-weight: 600;
  color: var(--ink-2);
  margin-left: 2px;
}
.p-conn .sum .d {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--ink-4);
  align-self: center;
  flex: none;
}
.p-conn .acts {
  display: flex;
  gap: 7px;
  margin-top: 13px;
}
.p-sync {
  flex: 1;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: var(--r-md);
  background: var(--tint-soft);
  color: var(--c700);
  font-size: 12.5px;
  font-weight: 600;
}
.p-sync:disabled {
  opacity: 0.55;
}
.p-mini {
  height: 34px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 1px solid var(--line-2);
  color: var(--ink-2);
  font-size: 12px;
  white-space: nowrap;
}
.p-mini:disabled {
  opacity: 0.45;
}
.p-addsrc {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: calc(100% - var(--pad) * 2);
  margin: 10px var(--pad) 0;
  height: 34px;
  border-radius: 12px;
  border: 1px dashed var(--line-2);
  font-size: 11.5px;
  color: var(--ink-3);
}
.p-addsrc .dim {
  color: var(--ink-4);
}
.p-sh {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 16px var(--pad) 8px;
}
.p-sh h2 {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
}
.p-sh .idx {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.p-sh .more {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-4);
}
.pad-x {
  padding: 0 var(--pad) 8px;
}
.err {
  font-size: 12px;
  color: var(--cinnabar);
}
.p-list {
  padding: 0 var(--pad);
}
.p-item {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 58px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line-2);
}
.p-cv {
  position: relative;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 12px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--tint-softer);
  color: var(--ink-4);
}
.p-cv img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-cv .cb {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 17px;
  height: 17px;
  display: grid;
  place-items: center;
  border-top-left-radius: 7px;
  background: var(--surface);
  color: var(--tint);
}
.meta {
  flex: 1;
  min-width: 0;
}
.meta .nm {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--ink);
}
.meta .sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
}
.p-state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex: none;
}
.p-st {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  white-space: nowrap;
}
.p-st.done {
  color: var(--c700);
}
.p-st.ing {
  color: var(--c700);
  font-variant-numeric: tabular-nums;
}
.p-st.idle {
  color: var(--ink-4);
}
.p-st.new {
  color: var(--gold);
}
.dotg {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--gold);
}
.dotg.live {
  background: var(--tint);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.25;
  }
}
.p-go {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11.5px;
}
.p-go.ghost {
  border-color: transparent;
  color: var(--ink-4);
  height: 22px;
  padding: 0;
  font-size: 11px;
}
.p-go:disabled {
  opacity: 0.4;
}
.p-prog {
  width: 56px;
  height: 2px;
  border-radius: var(--r-pill);
  background: var(--porcelain-2);
  overflow: hidden;
}
.p-prog i {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: inherit;
  background: var(--tint);
  animation: slide 1.1s ease-in-out infinite;
}
@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
.sk-list {
  padding: 0 var(--pad);
}
.sk-row {
  height: 44px;
  border-radius: 12px;
  margin-bottom: 12px;
}
.p-foot {
  padding: 16px var(--pad) 0;
  font-size: 11px;
  line-height: 1.65;
  color: var(--ink-4);
}
.scroll-end {
  height: 26px;
}
</style>
