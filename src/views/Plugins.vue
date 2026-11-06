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
  selectProvider,
  type PluginDescriptor
} from '@/core/plugin/manager'
import { confirmAction } from '@/core/confirm'

const router = useRouter()
const url = ref('')
const busy = ref('')
const error = ref('')
const info = ref('')
const fileInput = ref<HTMLInputElement>()
const pending = ref<{ code: string; manifest: any; sourceUrl?: string } | null>(null)
const editing = ref<PluginDescriptor | null>(null)
const configValues = ref<Record<string, any>>({})
const expanded = ref('')

const installed = computed(() => pluginState.plugins)

/** 已安装插件提供的在线音源（每个 provider 一张 monogram 卡）。 */
const sources = computed(() =>
  installed.value.flatMap((plugin) => plugin.providers.map((provider) => ({ plugin, provider })))
)
const runningCount = computed(() => installed.value.filter((item) => item.running).length)
const failedCount = computed(() => installed.value.filter((item) => item.loadError).length)

function toggleDetails(pluginId: string): void {
  expanded.value = expanded.value === pluginId ? '' : pluginId
}

function useSource(providerId: string): void {
  selectProvider(providerId)
}

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
  const ok = await confirmAction({
    title: `卸载插件「${plugin.name}」？`,
    body: '插件文件与它的配置会一并删除，重新安装后需要重新登录该音源。',
    confirmText: '卸载',
    danger: true
  })
  if (!ok) return
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
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="appbar">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <div class="ttl">
          音源市场
          <span class="sub">
            已安装 {{ installed.length }} · 运行中 {{ runningCount }}
            <template v-if="failedCount"> · {{ failedCount }} 个加载失败</template>
          </span>
        </div>
        <button class="iconbtn quiet" aria-label="刷新" @click="router.go(0)">
          <Icon name="refresh" :size="19" />
        </button>
      </div>

      <div v-if="error" class="pad mt12">
        <div class="notice error">{{ error }}</div>
      </div>
      <div v-if="info" class="pad mt12">
        <div class="notice ok">{{ info }}</div>
      </div>

      <!-- 订阅卡 -->
      <section class="subcard">
        <div class="crackle dark" aria-hidden="true" />
        <div class="subglow" aria-hidden="true" />
        <div class="subin">
          <div class="eb">SUBSCRIPTION</div>
          <h3>从链接订阅</h3>
          <p class="fine">
            <Icon name="info" :size="12" />
            <span>安装前逐条确认权限 · 仅接受 HTTPS 源</span>
          </p>
          <div class="urlrow">
            <Icon name="plugin" :size="14" class="uico" />
            <input
              v-model="url"
              class="uinput"
              inputmode="url"
              placeholder="https://example.com/plugin.js"
              autocomplete="off"
              aria-label="插件地址"
            />
            <button class="get" :disabled="!url.trim() || busy === 'url'" @click="prepareFromUrl">
              <span v-if="busy === 'url'" class="loading-dots"><i /><i /><i /></span>
              <span v-else>获取</span>
            </button>
          </div>
          <div class="alt">
            <button class="altbtn" @click="fileInput?.click()">
              <Icon name="folder" :size="13" /> 从文件安装
            </button>
            <span class="altsep" />
            <button class="altbtn" :disabled="busy === 'demo'" @click="installDemo">
              <Icon name="music" :size="13" />
              {{ busy === 'demo' ? '安装中…' : '示例音源' }}
            </button>
          </div>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept=".js,text/javascript,application/javascript"
          hidden
          @change="onFile"
        />
      </section>

      <!-- 在线音源 -->
      <div class="section-head mt24">
        <div class="st">
          <h2>在线音源</h2>
          <span class="idx">ONLINE</span>
        </div>
        <span class="meta num">{{ sources.length }} 个</span>
      </div>

      <div v-if="sources.length" class="hscroll tiles">
        <button
          v-for="item in sources"
          :key="item.plugin.pluginId + ':' + item.provider.id"
          class="tile"
          :class="{ cur: pluginState.selectedProvider === item.provider.id }"
          @click="useSource(item.provider.id)"
        >
          <span class="mono">{{ item.provider.name.slice(0, 1) }}</span>
          <span class="tname truncate">{{ item.provider.name }}</span>
          <span class="tv num">v{{ item.plugin.version }} · {{ item.provider.methods.length }} 接口</span>
          <span class="ta">
            <template v-if="pluginState.selectedProvider === item.provider.id">
              <Icon name="check" :size="11" /> 使用中
            </template>
            <template v-else>+ 设为当前</template>
          </span>
        </button>
      </div>
      <p v-else class="pad meta">还没有可用的音源，先用上面的订阅卡装一个插件。</p>

      <!-- 已安装 -->
      <div class="section-head mt24">
        <div class="st">
          <h2>已安装</h2>
          <span class="idx">INSTALLED</span>
        </div>
        <button class="more" :disabled="checkingAll" @click="checkAll">
          <Icon name="refresh" :size="13" />
          {{ checkingAll ? '检查中…' : '检查更新' }}
        </button>
      </div>

      <div v-if="!installed.length" class="empty">
        <div class="glyph"><Icon name="plugin" :size="34" /></div>
        <h3>还没有安装插件</h3>
        <p>澜音通过 v2 插件获取音乐信息。可以从链接、文件或内置示例开始。</p>
      </div>

      <div v-else class="pad">
        <div class="card plist">
          <div
            v-for="plugin in installed"
            :key="plugin.pluginId"
            class="pitem"
            :class="{ open: expanded === plugin.pluginId }"
          >
            <div class="prow" @click="toggleDetails(plugin.pluginId)">
              <span class="pmark" :class="{ off: !plugin.running }">{{ plugin.name.slice(0, 1) }}</span>
              <div class="pmain">
                <div class="pname">
                  <span class="truncate">{{ plugin.name }}</span>
                  <span class="pv num">v{{ plugin.version }}</span>
                </div>
                <div v-if="plugin.loadError" class="perr">
                  <Icon name="warning" :size="12" />
                  <span class="truncate">加载失败 · {{ plugin.loadError }}</span>
                </div>
                <div v-else class="psub">
                  <span class="truncate">{{ plugin.author || '未知作者' }}</span>
                  <span class="dot" />
                  <span>{{ plugin.sourceUrl ? '链接订阅' : '文件安装' }}</span>
                </div>
              </div>
              <button
                class="hit"
                :aria-label="plugin.running ? '停用' : '启用'"
                :disabled="busy === plugin.pluginId"
                @click.stop="toggle(plugin)"
              >
                <span class="switch" :class="{ on: plugin.running }" />
              </button>
              <button
                class="iconbtn quiet pchev"
                :aria-label="expanded === plugin.pluginId ? '收起详情' : '查看详情'"
                @click.stop="toggleDetails(plugin.pluginId)"
              >
                <Icon name="chevron-down" :size="15" />
              </button>
            </div>

            <div v-if="expanded === plugin.pluginId" class="pdetail">
              <p v-if="plugin.description" class="pdesc">{{ plugin.description }}</p>
              <div class="ptags">
                <span v-for="provider in plugin.providers" :key="provider.id" class="badge">
                  {{ provider.name }}
                </span>
                <span class="badge" :class="{ on: plugin.running }">
                  {{ plugin.running ? '运行中' : '已停用' }}
                </span>
              </div>
              <div class="pacts">
                <button
                  v-if="plugin.sourceUrl"
                  class="btn btn-ghost btn-sm"
                  :disabled="busy === plugin.pluginId"
                  @click="checkUpdate(plugin)"
                >
                  <Icon name="refresh" :size="14" /> 检查更新
                </button>
                <button
                  v-if="Object.keys(plugin.configDefaults).length"
                  class="btn btn-ghost btn-sm"
                  @click="openConfig(plugin)"
                >
                  <Icon name="settings" :size="14" /> 配置
                </button>
                <button
                  class="btn btn-danger btn-sm"
                  :disabled="busy === plugin.pluginId"
                  @click="uninstall(plugin)"
                >
                  <Icon name="trash" :size="14" /> 卸载
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="pad mt16">
        <div class="foot">
          <div class="foot-h">
            <Icon name="info" :size="12" />
            <span>关于插件</span>
          </div>
          手机版沿用澜音 v2 插件协议，插件在独立沙箱（iframe）中运行，只能通过受控桥接访问网络、存储和播放器。
          出于安全考虑，插件网络请求仅允许访问公网 HTTP(S) 地址，不能访问本机或局域网。
          从链接安装的插件会记录更新地址，应用启动时自动检查新版本（6 小时内只查一次，可在设置里关掉），
          也可以点上面的「检查更新」立刻检查。从文件安装的插件没有更新地址，需要重新从链接安装一次才能自动更新。
        </div>
      </div>
    </div>

    <!-- 安装确认 -->
    <div v-if="pending" class="sheet-mask" @click.self="pending = null">
      <div class="scrim" @click="pending = null" />
      <div class="sheet">
        <div class="grab" />
        <div class="sh-head">
          <div class="f1">
            <div class="sh-title truncate">安装 {{ pending.manifest.name }}？</div>
            <div class="sh-sub num">
              v{{ pending.manifest.version }} · {{ pending.manifest.author || '未知作者' }}
            </div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭" @click="pending = null">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <p v-if="pending.manifest.description" class="meta pad desc">
          {{ pending.manifest.description }}
        </p>

        <div class="pad">
          <div class="cap perms-cap">该插件声明了以下权限</div>
          <div class="perms">
            <div
              v-for="permission in manifestPermissions(pending.manifest)"
              :key="permission.key"
              class="perm"
            >
              <span class="perm-name">{{ permissionLabel(permission) }}</span>
              <span class="perm-why">{{ permission.reason || '插件未说明用途' }}</span>
            </div>
            <p v-if="!manifestPermissions(pending.manifest).length" class="meta">
              没有声明额外权限。
            </p>
          </div>
        </div>

        <div class="row g10 pad acts">
          <button class="btn btn-ghost f1" @click="pending = null">取消</button>
          <button class="btn btn-primary f1" :disabled="busy === 'install'" @click="confirmInstall">
            <span v-if="busy === 'install'" class="loading-dots"><i /><i /><i /></span>
            <span v-else>安装并启用</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 插件配置 -->
    <div v-if="editing" class="sheet-mask" @click.self="editing = null">
      <div class="scrim" @click="editing = null" />
      <div class="sheet">
        <div class="grab" />
        <div class="sh-head">
          <div class="f1">
            <div class="sh-title truncate">{{ editing.name }}</div>
            <div class="sh-sub">配置会保存在本机，插件下次读取时生效。</div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭" @click="editing = null">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <div class="pad cfgs">
          <div v-for="field in configFields(editing)" :key="field.key" class="cfgrow">
            <span class="cfg-lab truncate">{{ field.key }}</span>
            <button
              v-if="typeof field.value === 'boolean'"
              class="hit"
              :aria-label="configValues[field.key] ? '关闭' : '开启'"
              @click="configValues[field.key] = !configValues[field.key]"
            >
              <span class="switch" :class="{ on: configValues[field.key] }" />
            </button>
            <input
              v-else
              v-model="configValues[field.key]"
              class="input"
              :type="typeof field.value === 'number' ? 'number' : 'text'"
            />
          </div>
          <p v-if="!configFields(editing).length" class="meta">
            该插件没有声明可直接编辑的配置项，可能通过插件页面进行设置。
          </p>
        </div>

        <div class="row g10 pad acts">
          <button class="btn btn-ghost f1" @click="editing = null">取消</button>
          <button class="btn btn-primary f1" @click="saveConfig">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notice {
  padding: 11px 14px;
  border-radius: var(--r-md);
  font-size: 12.5px;
  line-height: 1.5;
}
.notice.error {
  color: var(--cinnabar);
  background: var(--porcelain-2);
  border-left: 2px solid var(--cinnabar);
}
.notice.ok {
  color: var(--c700);
  background: var(--tint-soft);
}

/* ---- 订阅卡 ---- */
.subcard {
  position: relative;
  overflow: hidden;
  margin: 12px var(--pad) 0;
  padding: 13px 16px 12px;
  border-radius: var(--r-xl);
  background: linear-gradient(154deg, var(--c600), var(--c800) 46%, var(--c900));
  box-shadow: var(--sh-2);
  color: rgb(255 255 255 / 0.92);
}
.subcard .crackle {
  opacity: 0.34;
}
.subglow {
  position: absolute;
  top: -60px;
  right: -40px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(255 255 255 / 0.13), transparent 68%);
  pointer-events: none;
}
.subin {
  position: relative;
}
.eb {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.48);
}
.subcard h3 {
  margin-top: 6px;
  font-family: var(--serif);
  font-size: 21px;
  font-weight: 600;
  color: rgb(255 255 255 / 0.96);
}
.fine {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: rgb(255 255 255 / 0.42);
}
.urlrow {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin-top: 11px;
  padding: 0 5px 0 11px;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.09);
  border: 1px solid rgb(255 255 255 / 0.13);
}
.uico {
  flex: none;
  color: rgb(255 255 255 / 0.5);
}
.uinput {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(255 255 255 / 0.92);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 11px;
}
.uinput::placeholder {
  color: rgb(255 255 255 / 0.34);
}
.get {
  flex: none;
  height: 32px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--c900);
  background: rgb(255 255 255 / 0.94);
  transition: transform 0.14s var(--e-out);
}
.get:active {
  transform: scale(0.95);
}
.get:disabled {
  opacity: 1;
  background: rgb(255 255 255 / 0.12);
  color: rgb(255 255 255 / 0.42);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
}
.get .loading-dots {
  color: var(--c900);
}
.alt {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.altbtn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
  font-size: 11px;
  color: rgb(255 255 255 / 0.74);
}
.altbtn::after {
  content: '';
  position: absolute;
  inset: -8px -6px;
}
.altbtn:disabled {
  opacity: 0.5;
}
.altsep {
  width: 1px;
  height: 10px;
  background: rgb(255 255 255 / 0.18);
}

/* ---- 在线音源卡 ---- */
.tiles {
  padding-bottom: 2px;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: none;
  width: 108px;
  padding: 9px 10px 0;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  text-align: left;
  transition: transform 0.14s var(--e-out);
}
.tile:active {
  transform: scale(0.97);
}
.tile.cur {
  border-color: var(--tint);
  box-shadow: inset 0 0 0 1px var(--tint-soft);
}
.mono {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  font-family: var(--serif);
  font-size: 14px;
  color: var(--c700);
  background: var(--c050);
  border: 1px solid var(--tint-soft);
}
.tname {
  width: 100%;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.tv {
  width: 100%;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-4);
}
.ta {
  display: flex;
  align-items: center;
  gap: 3px;
  width: calc(100% + 20px);
  margin: 8px -10px 0;
  padding: 7px 10px 8px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  font-weight: 600;
  color: var(--c700);
}
.tile.cur .ta {
  color: var(--tint);
}

/* ---- 已安装行 ---- */
.plist {
  overflow: hidden;
}
.prow {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 7px 10px 7px 11px;
  transition: background 0.15s var(--e-out);
}
.prow:active {
  background: var(--tint-softer);
}
.pitem + .pitem {
  border-top: 1px solid var(--line);
}
.pmark {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  font-family: var(--serif);
  font-size: 16px;
  color: var(--c800);
  background: linear-gradient(160deg, var(--c100), var(--c050));
}
.pmark.off {
  color: var(--ink-3);
  background: var(--porcelain-2);
}
.pmain {
  flex: 1;
  min-width: 0;
}
.pname {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}
.pv {
  flex: none;
  font-size: 11px;
  font-weight: 400;
  color: var(--ink-4);
}
.psub {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
}
.perr {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin-top: 3px;
  font-size: 11px;
  color: var(--cinnabar);
}
.hit {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  margin-right: -6px;
}
.hit:disabled {
  opacity: 0.45;
}
.pchev {
  width: 32px;
  height: 44px;
}
.pitem.open .pchev {
  color: var(--tint);
}
.pdetail {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--line);
  background: var(--tint-softer);
}
.pdesc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
}
.ptags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}
.badge.on {
  color: var(--tint);
  background: var(--tint-soft);
}
.pacts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 11px;
}
.pacts .btn {
  gap: 5px;
}

/* ---- 页脚说明 ---- */
.foot {
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-4);
}
.foot-h {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--ink-3);
}

/* ---- sheet ---- */
.sh-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-4);
}
.desc {
  margin: 0 0 12px;
}
.perms-cap {
  margin-bottom: 8px;
}
.perms {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.perm {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--porcelain-2);
}
.perm-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.perm-why {
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-3);
}
.acts {
  margin-top: 12px;
}
.cfgs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.cfgrow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
.cfg-lab {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.input {
  flex: none;
  width: 52%;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--porcelain-2);
  color: var(--ink);
  font-size: 13px;
  outline: none;
}
.input:focus {
  border-color: var(--tint);
  box-shadow: 0 0 0 3px var(--tint-soft);
}
</style>
