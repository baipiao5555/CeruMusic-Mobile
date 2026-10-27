<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import {
  enablePlugin,
  disablePlugin,
  fetchPluginCode,
  getPluginConfig,
  inspectPlugin,
  installDemoPlugin,
  installPlugin,
  checkPluginUpdate,
  checkAllPluginUpdates,
  pluginState,
  removePlugin,
  savePluginConfig,
  type PluginDescriptor
} from '@/core/plugin/manager'

const router = useRouter()
const url = ref('')
const busy = ref('')
const error = ref('')
const info = ref('')
const fileInput = ref<HTMLInputElement>()
const pending = ref<{ code: string; manifest: any; sourceUrl?: string } | null>(null)
const editing = ref<PluginDescriptor | null>(null)
const configValues = ref<Record<string, any>>({})

const installed = computed(() => pluginState.plugins)

function manifestPermissions(manifest: any): any[] {
  return Array.isArray(manifest?.permissions) ? manifest.permissions : []
}

function permissionLabel(permission: any): string {
  const names: Record<string, string> = {
    'network.request': '访问网络',
    'network.private': '访问局域网',
    'network.socket': '实时网络连接',
    'library.read': '读取歌单',
    'library.write': '修改歌单',
    'library.delete': '删除歌单内容',
    'player.read': '读取播放状态',
    'player.control': '控制播放',
    'downloads.create': '创建下载',
    'downloads.manage': '管理下载',
    'settings.read': '读取设置',
    'settings.write': '修改设置',
    'external.open': '打开外部链接',
    'account.profile': '读取账号信息',
    'clipboard.read': '读取剪贴板',
    'clipboard.write': '写入剪贴板'
  }
  return names[permission?.name] ?? permission?.name ?? '未知权限'
}

async function prepareFromUrl(): Promise<void> {
  error.value = ''
  info.value = ''
  const value = url.value.trim()
  if (!value) return
  busy.value = 'url'
  try {
    const code = await fetchPluginCode(value)
    pending.value = { code, manifest: inspectPlugin(code), sourceUrl: value }
  } catch (err: any) {
    error.value = err?.message ?? '获取插件失败'
  } finally {
    busy.value = ''
  }
}

async function onFile(event: Event): Promise<void> {
  error.value = ''
  info.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 16 * 1024 * 1024) {
    error.value = '插件文件过大'
    return
  }
  try {
    const code = await file.text()
    pending.value = { code, manifest: inspectPlugin(code) }
  } catch (err: any) {
    error.value = err?.message ?? '读取插件失败'
  }
}

async function confirmInstall(): Promise<void> {
  if (!pending.value) return
  busy.value = 'install'
  error.value = ''
  try {
    const manifest = pending.value.manifest
    const existing = installed.value.find((item) => item.manifestId === manifest.id)
    await installPlugin(pending.value.code, {
      enable: true,
      grantDeclared: true,
      sourceUrl: pending.value.sourceUrl
    })
    info.value = existing
      ? `${manifest.name} 已更新到 ${manifest.version}`
      : `${manifest.name} ${manifest.version} 安装成功`
    pending.value = null
    url.value = ''
  } catch (err: any) {
    error.value = err?.message ?? '安装插件失败'
  } finally {
    busy.value = ''
  }
}

async function installDemo(): Promise<void> {
  busy.value = 'demo'
  error.value = ''
  info.value = ''
  try {
    await installDemoPlugin()
    info.value = '内置示例音源已安装'
  } catch (err: any) {
    error.value = err?.message ?? '安装示例插件失败'
  } finally {
    busy.value = ''
  }
}

async function checkUpdate(plugin: PluginDescriptor): Promise<void> {
  busy.value = plugin.pluginId
  error.value = ''
  info.value = ''
  try {
    const result = await checkPluginUpdate(plugin.pluginId)
    info.value = result.updated
      ? `${plugin.name} 已更新到 v${result.version}`
      : `${plugin.name} 已是最新版本 v${result.version}`
  } catch (err: any) {
    error.value = err?.message ?? '检查更新失败'
  } finally {
    busy.value = ''
  }
}

async function autoCheckUpdates(): Promise<void> {
  if (sessionStorage.getItem('ceru.pluginAutoUpdateChecked') === '1') return
  sessionStorage.setItem('ceru.pluginAutoUpdateChecked', '1')
  const results = await checkAllPluginUpdates({ quiet: true })
  const updated = results.filter((item) => item.updated)
  if (updated.length) {
    info.value = `已自动更新 ${updated.map((item) => `${item.name} v${item.version}`).join('、')}`
  }
}

const checkingAll = ref(false)

/** 手动检查全部：无视 6 小时节流，结果汇总在页面顶部。 */
async function checkAll(): Promise<void> {
  if (checkingAll.value) return
  checkingAll.value = true
  error.value = ''
  info.value = ''
  try {
    const results = await checkAllPluginUpdates({ force: true, quiet: true })
    if (!results.length) {
      info.value = '没有可自动更新的插件（只有从链接安装的插件才记录更新地址）'
    } else {
      const updated = results.filter((item) => item.updated)
      const failed = results.filter((item) => item.error)
      if (updated.length) {
        info.value = `已更新 ${updated
          .map((item) => `${item.name} v${item.previousVersion} → v${item.version}`)
          .join('、')}`
      } else {
        info.value = `全部已是最新版本（${results.length} 个插件）`
      }
      if (failed.length) error.value = `${failed.length} 个插件检查失败：${failed[0].error}`
    }
  } finally {
    checkingAll.value = false
  }
}

onMounted(() => {
  void autoCheckUpdates()
})

async function toggle(plugin: PluginDescriptor): Promise<void> {
  busy.value = plugin.pluginId
  error.value = ''
  info.value = ''
  try {
    if (plugin.running) {
      await disablePlugin(plugin.pluginId)
      info.value = `${plugin.name} 已停用`
    } else {
      await enablePlugin(plugin.pluginId)
      info.value = `${plugin.name} 已启用`
    }
  } catch (err: any) {
    error.value = err?.message ?? '操作失败'
  } finally {
    busy.value = ''
  }
}

async function uninstall(plugin: PluginDescriptor): Promise<void> {
  if (!window.confirm(`卸载插件「${plugin.name}」？相关配置会一并删除。`)) return
  busy.value = plugin.pluginId
  try {
    await removePlugin(plugin.pluginId)
    info.value = `${plugin.name} 已卸载`
  } catch (err: any) {
    error.value = err?.message ?? '卸载失败'
  } finally {
    busy.value = ''
  }
}

async function openConfig(plugin: PluginDescriptor): Promise<void> {
  editing.value = plugin
  const saved = await getPluginConfig(plugin.pluginId)
  configValues.value = { ...(plugin.configDefaults ?? {}), ...saved }
}

async function saveConfig(): Promise<void> {
  if (!editing.value) return
  await savePluginConfig(editing.value.pluginId, { ...configValues.value })
  info.value = '插件配置已保存'
  editing.value = null
}

function configFields(plugin: PluginDescriptor): Array<{ key: string; value: any }> {
  return Object.entries(plugin.configDefaults ?? {}).map(([key, value]) => ({ key, value }))
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="brand-name" style="font-size: 20px">音源插件</div>
      <button class="icon-btn" aria-label="刷新" @click="router.go(0)">
        <Icon name="repeat" :size="19" />
      </button>
    </header>

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="info" class="notice ok">{{ info }}</div>

    <section class="card add-card">
      <h2>从链接安装</h2>
      <p class="sub">粘贴澜音 v2 单文件插件（.js）的下载地址。</p>
      <div class="add-row">
        <input
          v-model="url"
          class="input"
          inputmode="url"
          placeholder="https://example.com/plugin.js"
          autocomplete="off"
        />
        <button class="btn" :disabled="!url.trim() || busy === 'url'" @click="prepareFromUrl">
          <span v-if="busy === 'url'" class="loading-dots"><i /><i /><i /></span>
          <span v-else>获取</span>
        </button>
      </div>
      <div class="add-actions">
        <button class="btn secondary" @click="fileInput?.click()">
          <Icon name="folder" :size="18" /> 从文件安装
        </button>
        <button class="btn ghost" :disabled="busy === 'demo'" @click="installDemo">
          <Icon name="music" :size="18" /> 安装示例音源
        </button>
      </div>
      <input ref="fileInput" type="file" accept=".js,text/javascript,application/javascript" hidden @change="onFile" />
    </section>

    <div class="section-title">
      <h2>已安装</h2>
      <button class="check-all" :disabled="checkingAll" @click="checkAll">
        <Icon name="refresh" :size="14" /> {{ checkingAll ? '检查中…' : '检查全部更新' }}
      </button>
    </div>

    <div v-if="!installed.length" class="empty">
      <div class="emoji">🔌</div>
      <h3>还没有安装插件</h3>
      <p>澜音通过 v2 插件获取音乐信息。可以从链接、文件或内置示例开始。</p>
    </div>

    <div class="plugin-list">
      <section v-for="plugin in installed" :key="plugin.pluginId" class="card plugin-card">
        <div class="plugin-head">
          <div class="plugin-mark">{{ plugin.name.slice(0, 1) }}</div>
          <div class="plugin-info">
            <h3>{{ plugin.name }} <small>v{{ plugin.version }}</small></h3>
            <p>{{ plugin.author || '未知作者' }} · {{ plugin.providers.map((item) => item.name).join('、') || '无音源' }}</p>
          </div>
          <button
            class="switch"
            :class="{ on: plugin.running }"
            :aria-label="plugin.running ? '停用' : '启用'"
            :disabled="busy === plugin.pluginId"
            @click="toggle(plugin)"
          />
        </div>

        <p v-if="plugin.description" class="plugin-desc">{{ plugin.description }}</p>
        <p v-if="plugin.loadError" class="plugin-error">{{ plugin.loadError }}</p>

        <div class="plugin-tags">
          <span v-for="provider in plugin.providers" :key="provider.id" class="mini-tag">{{ provider.name }}</span>
          <span v-if="plugin.running" class="mini-tag online">运行中</span>
          <span v-else class="mini-tag">已停用</span>
        </div>

        <div class="plugin-actions">
          <button
            v-if="plugin.sourceUrl"
            class="btn secondary small"
            :disabled="busy === plugin.pluginId"
            @click="checkUpdate(plugin)"
          >
            <Icon name="refresh" :size="15" /> 检查更新
          </button>
          <button
            v-if="Object.keys(plugin.configDefaults).length"
            class="btn secondary small"
            @click="openConfig(plugin)"
          >
            <Icon name="settings" :size="15" /> 配置
          </button>
          <button class="btn danger small" :disabled="busy === plugin.pluginId" @click="uninstall(plugin)">
            <Icon name="trash" :size="15" /> 卸载
          </button>
        </div>
      </section>
    </div>

    <section class="card help-card">
      <h3>关于插件</h3>
      <p>
        手机版沿用澜音 v2 插件协议，插件在独立沙箱（iframe）中运行，只能通过受控桥接访问网络、存储和播放器。
        出于安全考虑，插件网络请求仅允许访问公网 HTTP(S) 地址，不能访问本机或局域网。
        从链接安装的插件会记录更新地址，应用启动时自动检查新版本（6 小时内只查一次，可在设置里关掉），
        也可以在这里点「检查全部更新」立刻检查。从文件安装的插件没有更新地址，需要重新从链接安装一次才能自动更新。
      </p>
    </section>

    <div v-if="pending" class="sheet-mask" @click.self="pending = null">
      <div class="sheet">
        <h2>安装 {{ pending.manifest.name }}？</h2>
        <p class="sub">
          v{{ pending.manifest.version }} · {{ pending.manifest.author || '未知作者' }}<br />
          {{ pending.manifest.description || '没有描述' }}
        </p>
        <h3 style="font-size: 13px; margin: 14px 0 8px">该插件声明了以下权限</h3>
        <div class="permission-list">
          <div v-for="permission in manifestPermissions(pending.manifest)" :key="permission.key" class="permission-item">
            <strong>{{ permissionLabel(permission) }}</strong>
            <p>{{ permission.reason || '插件未说明用途' }}</p>
          </div>
          <p v-if="!manifestPermissions(pending.manifest).length" class="sub">没有声明额外权限。</p>
        </div>
        <div class="sheet-actions">
          <button class="btn secondary" @click="pending = null">取消</button>
          <button class="btn" :disabled="busy === 'install'" @click="confirmInstall">
            <span v-if="busy === 'install'" class="loading-dots"><i /><i /><i /></span>
            <span v-else>安装并启用</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="editing" class="sheet-mask" @click.self="editing = null">
      <div class="sheet">
        <h2>{{ editing.name }} 配置</h2>
        <p class="sub">配置会保存在本机，插件下次读取时生效。</p>
        <div class="field" v-for="field in configFields(editing)" :key="field.key">
          <label>{{ field.key }}</label>
          <button
            v-if="typeof field.value === 'boolean'"
            class="switch"
            :class="{ on: configValues[field.key] }"
            @click="configValues[field.key] = !configValues[field.key]"
          />
          <input
            v-else
            v-model="configValues[field.key]"
            class="input"
            :type="typeof field.value === 'number' ? 'number' : 'text'"
          />
        </div>
        <p v-if="!configFields(editing).length" class="sub">
          该插件没有声明可直接编辑的配置项，可能通过插件页面进行设置。
        </p>
        <div class="sheet-actions">
          <button class="btn secondary" @click="editing = null">取消</button>
          <button class="btn" @click="saveConfig">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notice {
  padding: 11px 14px;
  margin-bottom: 12px;
  border-radius: 13px;
  font-size: 12.5px;
}
.notice.error {
  color: var(--danger);
  background: rgba(229, 72, 77, 0.1);
}
.notice.ok {
  color: var(--brand-strong);
  background: var(--brand-soft);
}
.add-card {
  padding: 16px;
}
.add-card h2 {
  font-size: 17px;
}
.add-card .sub {
  margin-top: 5px;
  font-size: 12px;
  color: var(--muted);
}
.add-row {
  display: flex;
  gap: 9px;
  margin-top: 14px;
}
.add-row .input {
  flex: 1;
  min-width: 0;
}
.add-row .btn {
  flex: 0 0 auto;
  padding: 0 18px;
}
.add-actions {
  display: flex;
  gap: 9px;
  margin-top: 11px;
}
.add-actions .btn {
  flex: 1;
  padding: 11px 12px;
  font-size: 12.5px;
}
.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.plugin-card {
  padding: 16px;
}
.plugin-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.plugin-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--brand), #56dcae);
  box-shadow: 0 8px 18px rgba(0, 181, 120, 0.24);
  flex: 0 0 auto;
}
.plugin-info {
  flex: 1;
  min-width: 0;
}
.plugin-info h3 {
  font-size: 15px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.plugin-info h3 small {
  font-size: 10.5px;
  color: var(--muted-2);
  font-weight: 400;
}
.plugin-info p {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plugin-desc {
  margin-top: 11px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.plugin-error {
  margin-top: 9px;
  padding: 9px 11px;
  border-radius: 10px;
  font-size: 11.5px;
  color: var(--danger);
  background: rgba(229, 72, 77, 0.09);
}
.plugin-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 11px;
}
.mini-tag {
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--muted);
  background: var(--brand-softer);
  border: 1px solid var(--line);
}
.mini-tag.online {
  color: var(--brand-strong);
  background: var(--brand-soft);
}
.plugin-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.btn.small {
  padding: 9px 13px;
  font-size: 12px;
}
.check-all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
}
.check-all:disabled {
  opacity: 0.6;
}
.help-card {
  margin-top: 18px;
  padding: 16px;
}
.help-card h3 {
  font-size: 14px;
}
.help-card p {
  margin-top: 7px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--muted);
}
.permission-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.permission-item {
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--brand-softer);
}
.permission-item strong {
  font-size: 12.5px;
}
.permission-item p {
  margin-top: 3px;
  font-size: 11px;
  color: var(--muted);
}
</style>
