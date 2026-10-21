<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import {
  authState,
  displayName,
  login,
  logout
} from '@/core/auth'
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

const router = useRouter()
const error = ref('')
const importingAll = ref(false)

const importedCount = computed(
  () => libraryState.playlists.filter((playlist) => playlist.cloudId).length
)

function formatDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function refresh(): Promise<void> {
  if (!authState.authenticated) return
  error.value = ''
  try {
    await fetchCloudPlaylists()
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

function signOut(): void {
  if (!window.confirm('退出澜音账号？电脑端的登录状态不受影响。')) return
  logout()
  cloudState.playlists = []
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

onMounted(() => {
  if (authState.authenticated) void refresh()
})
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="brand-name" style="font-size: 20px">云端歌单</div>
      <button
        v-if="authState.authenticated"
        class="icon-btn"
        aria-label="刷新"
        :disabled="cloudState.loading"
        @click="refresh"
      >
        <Icon name="refresh" :size="20" />
      </button>
      <span v-else style="width: 42px" />
    </header>

    <template v-if="!authState.authenticated">
      <section class="card login-card">
        <div class="login-icon"><Icon name="user" :size="30" /></div>
        <h2>登录澜音账号</h2>
        <p>
          手机和电脑使用同一个澜音账号。在电脑版把歌单「上传到云端」后，这里就能直接导入到手机。
        </p>
        <button class="btn" style="margin-top: 16px" @click="startLogin">
          <Icon name="user" :size="17" /> 登录
        </button>
        <p v-if="error" class="error-text">{{ error }}</p>
        <p class="hint">登录会打开系统浏览器，完成后自动回到澜音。</p>
      </section>
    </template>

    <template v-else>
      <section class="card account-card">
        <div class="avatar">
          <img v-if="authState.user?.picture" :src="authState.user.picture" alt="" />
          <Icon v-else name="user" :size="22" />
        </div>
        <div class="account-info">
          <h2>{{ displayName() }}</h2>
          <p>已登录 · 已导入 {{ importedCount }} 个云端歌单</p>
        </div>
        <button class="btn ghost small" @click="signOut">退出</button>
      </section>

      <div class="section-title">
        <h2>云端歌单</h2>
        <div class="title-actions">
          <button
            class="create-btn"
            :disabled="!cloudState.playlists.length || importingAll || Boolean(cloudState.importing)"
            @click="importAll"
          >
            <Icon name="download" :size="16" />
            {{ importingAll ? '导入中…' : '全部导入' }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <div v-if="cloudState.loading" class="loading-card card">
        <span class="spinner" />
        正在读取云端歌单…
      </div>

      <div v-else-if="cloudState.playlists.length" class="cloud-list">
        <div v-for="cloud in cloudState.playlists" :key="cloud.id" class="cloud-row card">
          <div class="cloud-cover">
            <img v-if="cloud.cover && cloud.cover !== 'default-cover'" :src="cloud.cover" alt="" />
            <Icon v-else name="music" :size="22" />
          </div>
          <div class="cloud-info">
            <h3>{{ cloud.name }}</h3>
            <p>
              <span v-if="cloud.describe">{{ cloud.describe }} · </span>
              <span v-if="isCloudPlaylistImported(cloud.id)" class="imported">已导入</span>
              <span v-else>更新于 {{ formatDate(cloud.updatedAt) || '未知时间' }}</span>
            </p>
          </div>
          <button
            class="btn small"
            :disabled="Boolean(cloudState.importing)"
            @click="importOne(cloud)"
          >
            {{
              cloudState.importing === cloud.id
                ? '导入中…'
                : isCloudPlaylistImported(cloud.id)
                  ? '更新'
                  : '导入'
            }}
          </button>
        </div>
      </div>

      <div v-else class="empty">
        <div class="emoji">☁️</div>
        <h3>云端还没有歌单</h3>
        <p>
          在电脑版打开歌单菜单，选择「上传到云端」，再回到这里下拉刷新即可看到。
        </p>
        <button class="btn secondary" @click="refresh">重新读取</button>
      </div>

      <p class="footnote">
        只同步歌单信息（歌曲、歌手、专辑、音源引用），不会同步音乐文件。导入后如果某首歌的音源插件没有安装，会显示「未匹配音源」。
      </p>
    </template>
  </div>
</template>

<style scoped>
.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 28px 22px 22px;
  margin-top: 18px;
}
.login-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 22px;
  color: var(--brand);
  background: var(--brand-soft);
  margin-bottom: 14px;
}
.login-card h2 {
  font-size: 19px;
}
.login-card p {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted);
  max-width: 300px;
}
.login-card .hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--muted-2);
}
.account-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin-top: 16px;
}
.avatar {
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
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.account-info {
  flex: 1;
  min-width: 0;
}
.account-info h2 {
  font-size: 15.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-info p {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
}
.btn.small {
  padding: 8px 14px;
  font-size: 12.5px;
  flex: 0 0 auto;
}
.cloud-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cloud-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
}
.cloud-cover {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border-radius: 14px;
  overflow: hidden;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.cloud-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cloud-info {
  flex: 1;
  min-width: 0;
}
.cloud-info h3 {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cloud-info p {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.imported {
  color: var(--brand);
  font-weight: 600;
}
.loading-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px;
  font-size: 13px;
  color: var(--muted);
}
.spinner {
  width: 16px;
  height: 16px;
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
.error-text {
  margin: 10px 4px 0;
  font-size: 12px;
  color: #e05353;
  text-align: center;
}
.footnote {
  margin: 18px 6px 8px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--muted-2);
  text-align: center;
}
.title-actions {
  display: flex;
  gap: 6px;
}
.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
}
.create-btn:disabled {
  opacity: 0.5;
}
</style>
