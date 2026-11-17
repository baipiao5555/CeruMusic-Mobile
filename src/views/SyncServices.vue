<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { confirmAction } from '@/core/confirm'
import { authState, displayName } from '@/core/auth'
import { secureStore, type SecureStoreStatus } from '@/core/native/secureStore'
import { listConnections, saveConnection, removeConnection, testConnection, createBackup, publishCurrentBackup, listBackups, readBackup, commitRestore, currentBackupFile, syncNow, getSyncStatus, setSyncSettings, type WebDavConnection, type RemotePreview, type WebDavSyncStatus, type SyncResult } from '@/core/sync/webdav'

const router = useRouter()
const store = ref<SecureStoreStatus>()
const connections = ref<WebDavConnection[]>(listConnections())
const selectedId = ref(connections.value[0]?.id || '')
const selected = computed(() => connections.value.find(item => item.id === selectedId.value))
const form = ref({ name: '', address: '', username: '', password: '', confirmed: false, allowInsecureHttp: false })
const showAdd = ref(false)
const showHelp = ref(false)
const services = [
  { name: 'WebDAV', mark: 'DAV', detail: 'NAS / 自建服务 · 双向同步与备份', color: 'green', available: true },
  { name: 'S3 兼容存储', mark: 'S3', detail: 'endpoint / bucket / 条件写', color: 'amber', available: false },
  { name: 'OneDrive', mark: 'OD', detail: 'OAuth 与文件版本控制', color: 'blue', available: false },
  { name: 'Google Drive', mark: 'GD', detail: 'OAuth / 专用目录 / 冲突控制', color: 'green', available: false }
]
const busy = ref(false)
const message = ref('')
const files = ref<string[]>([])
const file = ref('')
const preview = ref<RemotePreview>()
const restoreMode = ref<'merge' | 'replace'>('merge')
const lastCommit = ref<ReturnType<typeof commitRestore>>()
const syncStatus = ref<WebDavSyncStatus>()
const lastSync = ref<SyncResult>()
const autoNextAt = ref<number>()
let autoTimer: ReturnType<typeof setInterval> | undefined
const previewTracks = computed(() => preview.value?.snapshot.playlists.reduce((sum, item) => sum + item.tracks.length, 0) || 0)
const remoteText = computed(() => {
  const status = syncStatus.value
  if (!status?.remoteAt) return '尚未读取'
  if (status.remoteExists === false) return '远端缺失'
  return `${status.remotePlaylists || 0} 个歌单 / ${status.remoteFavorites || 0} 首收藏`
})
const nextSyncText = computed(() => {
  if (!syncStatus.value?.enabled) return '未启用'
  return autoNextAt.value ? formatTime(autoNextAt.value) : '等待安排'
})
const syncBadge = computed(() => {
  const status = syncStatus.value
  if (!status) return '未配置'
  if (status.lastError) return '上次失败'
  if (!status.hasBaseline) return '待首次同步'
  if (status.conflicts) return `${status.conflicts} 个冲突副本`
  return status.enabled ? '自动同步已启用' : '已建立基线'
})
const syncBadgeClass = computed(() => ({ neutral: !syncStatus.value?.hasBaseline || Boolean(syncStatus.value?.lastError), error: Boolean(syncStatus.value?.lastError) }))
function formatTime(value?: number): string {
  if (!value) return '—'
  try { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
  catch { return '—' }
}
function shortEtag(value?: string): string { return value && value.length > 30 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value || '—' }
watch(file, () => { preview.value = undefined; lastCommit.value = undefined }, { flush: 'sync' })
onMounted(async () => { try { store.value = await secureStore.status() } catch { message.value = '安全仓库不可用，不能保存同步凭据。请更新客户端。' } refreshSyncStatus(); restartAutoTimer() })
onUnmounted(() => stopAutoTimer())
function refreshConnections(): void { connections.value = listConnections() }
function refreshSyncStatus(): void { syncStatus.value = selected.value ? getSyncStatus(selected.value) : undefined }
function choose(connection: WebDavConnection): void { selectedId.value = connection.id; files.value = []; file.value = ''; preview.value = undefined; lastCommit.value = undefined; lastSync.value = undefined; message.value = ''; refreshSyncStatus(); restartAutoTimer() }
async function run(operation: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true; message.value = ''
  try { await operation() } catch (error: any) { message.value = error?.message || '同步操作失败，未修改本地资料。' }
  finally { busy.value = false; refreshConnections(); refreshSyncStatus() }
}
function stopAutoTimer(): void { if (autoTimer !== undefined) { clearInterval(autoTimer); autoTimer = undefined } autoNextAt.value = undefined }
function restartAutoTimer(): void {
  stopAutoTimer()
  const status = syncStatus.value
  if (!selected.value || !status?.enabled) return
  const delay = Math.max(1, status.autoSyncMinutes || 3) * 60000
  autoNextAt.value = Date.now() + delay
  autoTimer = setInterval(() => { void autoSyncTick() }, delay)
}
async function autoSyncTick(): Promise<void> {
  const status = syncStatus.value, connection = selected.value
  if (!connection || !status?.enabled) { stopAutoTimer(); return }
  const delay = Math.max(1, status.autoSyncMinutes || 3) * 60000
  if (busy.value || document.visibilityState === 'hidden' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    autoNextAt.value = Date.now() + delay
    return
  }
  await run(async () => { const result = await syncNow(connection); lastSync.value = result; message.value = result.summary })
  autoNextAt.value = Date.now() + delay
}
async function save(): Promise<void> {
  if (!store.value) return
  await run(async () => { const connection = await saveConnection(form.value); refreshConnections(); choose(connection); form.value = { name: '', address: '', username: '', password: '', confirmed: false, allowInsecureHttp: false }; showAdd.value = false; message.value = '连接已保存。请先测试专用目录，再启用双向同步。' })
}
async function test(): Promise<void> { if (selected.value) await run(async () => { message.value = (await testConnection(selected.value!)).message }) }
async function sync(): Promise<void> {
  const connection = selected.value
  if (!connection) return
  await run(async () => {
    const result = await syncNow(connection)
    lastSync.value = result
    message.value = result.conflicts.length ? `${result.summary} 冲突副本：${result.conflicts.map(item => item.copyName).join('、')}` : result.summary
  })
  restartAutoTimer()
}
async function toggleAutoSync(event: Event): Promise<void> {
  const connection = selected.value
  if (!connection) return
  const enabled = (event.target as HTMLInputElement).checked
  await run(async () => {
    syncStatus.value = await setSyncSettings(connection, { enabled })
    message.value = enabled ? '已启用自动双向同步：页面打开时每 3 分钟检查一次。' : '已关闭自动双向同步。'
  })
  const checkbox = event.target as HTMLInputElement
  if (syncStatus.value?.enabled !== enabled) checkbox.checked = syncStatus.value?.enabled === true
  restartAutoTimer()
}
async function undoSync(): Promise<void> {
  const undo = lastSync.value?.undo
  if (!undo) return
  await run(async () => { undo(); lastSync.value = undefined; message.value = '已撤销本次远端应用；远端文件未改变。' })
}
async function backup(): Promise<void> { if (selected.value) await run(async () => { const name = await createBackup(selected.value!); files.value = [name, ...files.value.filter(item => item !== name)]; file.value = name; message.value = '已生成独立新备份，不覆盖已有远端文件。' }) }
async function publish(): Promise<void> {
  if (!selected.value || !(await confirmAction({ title: '更新远端当前备份？', body: '只在本次 ETag 验证通过后条件写入。远端变化将返回冲突并停止；不会自动合并。', confirmText: '条件写入', danger: true }))) return
  await run(async () => { await publishCurrentBackup(selected.value!); file.value = currentBackupFile; message.value = '远端当前备份已条件写入。双向同步会在下次同步时重新读取并合并。' })
}
async function list(): Promise<void> { if (selected.value) await run(async () => { files.value = await listBackups(selected.value!); if (!files.value.includes(file.value)) file.value = files.value[0] || ''; message.value = files.value.length ? '仅列出澜音专用备份文件。' : '此目录暂无澜音备份。' }) }
async function read(): Promise<void> { if (selected.value && file.value) await run(async () => { preview.value = await readBackup(selected.value!, file.value); lastCommit.value = undefined; message.value = '已读取白名单快照预览，尚未修改本地库。' }) }
async function restore(): Promise<void> {
  const expected = preview.value, mode = restoreMode.value, owner = selectedId.value
  if (!expected || !(await confirmAction({ title: mode === 'replace' ? '替换本地歌单与收藏？' : '合并到本地歌单与收藏？', body: '只恢复白名单元数据。缺音源或私有引用保留为待匹配；不恢复登录凭据、音源脚本或媒体文件。', confirmText: '确认恢复', danger: mode === 'replace' }))) return
  await run(async () => { if (preview.value !== expected || selectedId.value !== owner || file.value !== expected.file) throw new Error('恢复预览已失效，请重新读取。'); lastCommit.value = commitRestore(expected, mode); const count = lastCommit.value.counts; message.value = `已恢复 ${count.playlists} 个歌单、${count.tracks} 首歌单曲目、${count.favorites} 首收藏；${count.pending} 首待匹配。可撤销，原库变化后将拒绝撤销。` })
}
async function undo(): Promise<void> { if (lastCommit.value) await run(async () => { lastCommit.value!.undo(); lastCommit.value = undefined; message.value = '已撤销本次恢复。' }) }
async function remove(): Promise<void> {
  if (!selected.value || !(await confirmAction({ title: '移除此同步连接？', body: '只移除本机连接与安全凭据，不删除任何远端备份。', danger: true }))) return
  await run(async () => { await removeConnection(selected.value!); selectedId.value = ''; preview.value = undefined; files.value = []; lastCommit.value = undefined; message.value = '本机连接和安全凭据已移除，未删除远端文件。' })
  stopAutoTimer()
}
</script>

<template>
  <div class="screen sync-services"><div class="scroll safe-t">
    <header class="sync-header"><button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="20" /></button><h1>同步服务</h1><button class="help-button" :aria-expanded="showHelp" @click="showHelp=!showHelp">帮助</button></header>
    <main class="sync-content">
      <button class="cloud-card" @click="router.push('/cloud')"><span class="service-icon green"><Icon name="cloud" :size="20" /></span><span class="service-copy"><strong>澜音云</strong><small>读取远端歌单并导入到本机</small></span><span class="status-badge neutral">单向导入</span><span class="cloud-caption">{{authState.authenticated ? '已连接 · '+displayName() : '未连接 · 点击登录澜音账号'}}</span><Icon name="chevron-right" :size="14" /></button>

      <section class="services-section"><div class="sync-section-head"><h2>添加其他服务</h2><span>同步连接，独立管理</span></div><div class="service-list">
        <button v-for="service in services" :key="service.name" class="service-row" :disabled="!service.available || busy" :aria-label="service.name+(service.available?'配置':'：尚未接入')" @click="showAdd=true"><span class="service-icon" :class="service.color">{{service.mark}}</span><span class="service-copy"><strong>{{service.name}}</strong><small>{{service.detail}}</small></span><span class="status-badge" :class="{'neutral':!service.available}">{{service.available?'可连接':'待适配'}}</span><span class="service-radio" :class="{selected:service.available}" /></button>
      </div></section>

      <section class="config-card"><div class="config-heading"><h3>WebDAV · {{selected ? selected.name : '连接配置'}}</h3><span v-if="selected" class="status-badge" :class="{neutral:!selected.testedAt}">{{selected.testedAt?'已测试':'未测试'}}</span></div><p v-if="selected" class="endpoint">{{selected.origin}}{{selected.basePath}}</p><p v-else>连接你的 NAS 或自建服务，不要求澜音登录。</p><div class="sync-modes"><span class="selected">双向同步</span><span class="selected">手动备份 / 恢复</span></div></section>
      <p v-if="message && !showAdd" class="sync-message" role="status">{{message}}</p>

      <section v-if="connections.length" class="connection-picker"><div class="sync-section-head"><h2>我的连接</h2><span>{{connections.length}} 个</span></div><div class="sync-connections"><button v-for="connection in connections" :key="connection.id" class="connection-chip" :class="{active:selectedId===connection.id}" :disabled="busy" @click="choose(connection)">{{connection.name}}</button></div></section>

      <section v-if="selected" class="two-way-card"><div class="config-heading"><h3>双向同步</h3><span class="status-badge" :class="syncBadgeClass">{{syncBadge}}</span></div><p class="meta">上次同步：{{formatTime(syncStatus?.lastSyncedAt)}} · 下次自动：{{nextSyncText}}</p>
        <div class="sync-status-grid"><div><span>本地基线</span><strong>{{syncStatus?.hasBaseline ? `${syncStatus.baselinePlaylists} 个歌单 / ${syncStatus.baselineFavorites} 首收藏` : '尚无'}}</strong></div><div><span>远端</span><strong>{{remoteText}}</strong></div><div><span>冲突</span><strong>{{syncStatus?.conflicts || 0}} 个副本</strong></div></div>
        <p v-if="syncStatus?.remoteEtag" class="meta etag">远端版本 {{shortEtag(syncStatus.remoteEtag)}} · 读取于 {{formatTime(syncStatus.remoteAt)}}</p>
        <p v-if="syncStatus?.lastError" class="sync-message" role="alert">{{syncStatus.lastError}}</p>
        <div class="sync-buttons" :class="{single: !lastSync?.undo}"><button class="sync-action primary" :disabled="busy" @click="sync">立即双向同步</button><button v-if="lastSync?.undo" class="sync-action secondary" :disabled="busy" @click="undoSync">撤销本次拉取</button></div>
        <label class="auto-sync"><input type="checkbox" :checked="syncStatus?.enabled" :disabled="busy" @change="toggleAutoSync" /><span>自动同步（页面打开时每 3 分钟检查一次）</span></label>
        <p class="meta">同一时间只启用一个自动同步目标。首次同步安全合并；同一歌单两边都改时保留「冲突副本」；首版不传播删除。</p>
      </section>

      <section v-if="selected" class="sync-operations"><div class="config-heading"><h3>手动备份与恢复</h3><span class="meta">独立文件</span></div><div class="sync-buttons"><button class="sync-action secondary" :disabled="busy" @click="test">测试读写与 ETag</button><button class="sync-action primary" :disabled="busy" @click="backup">保存独立新备份</button><button class="sync-action secondary" :disabled="busy" @click="publish">条件更新当前备份</button><button class="sync-action secondary" :disabled="busy" @click="list">列出备份</button></div><p class="meta">测试只读写本次临时文件。未经 ETag 验证，不启用双向同步或覆盖已有备份。</p>
        <label>恢复文件<select v-model="file" :disabled="busy"><option value="">请选择</option><option :value="currentBackupFile">当前备份</option><option v-for="name in files.filter(name=>name!==currentBackupFile)" :key="name" :value="name">{{name}}</option></select></label><button class="sync-action secondary full" :disabled="busy||!file" @click="read">读取恢复预览</button>
        <div v-if="preview" class="sync-preview"><h3>预览：尚未恢复</h3><p>{{preview.snapshot.playlists.length}} 个歌单 · {{previewTracks}} 首歌单曲目 · {{preview.snapshot.favorites.length}} 首收藏</p><p class="meta">只恢复元数据，缺音源和私有引用保留为待匹配。</p><label>恢复方式<select v-model="restoreMode" :disabled="busy"><option value="merge">合并，冲突保留副本</option><option value="replace">替换本地歌单与收藏</option></select></label><div class="sync-buttons"><button class="sync-action primary" :disabled="busy" @click="restore">确认恢复</button><button v-if="lastCommit" class="sync-action secondary" :disabled="busy" @click="undo">撤销本次恢复</button></div></div>
        <button class="remove-connection" :disabled="busy" @click="remove">移除本机连接</button>
      </section>

      <div class="sync-summary"><Icon name="info" :size="16" /><p>只同步歌单与收藏，不上传账号凭据、音源或音乐文件。双向同步与手动备份/恢复并存。</p></div>
      <button class="sync-action primary full add-connection" :disabled="busy || !store" @click="showAdd=true"><Icon name="plus" :size="17" />添加连接</button>
      <p class="footer-hint">{{store?.persistent?'凭据仅在本机加密保存':'Web 版凭据仅本次会话保留'}}</p>
      <section v-if="showHelp" class="sync-help"><h3>同步说明</h3><p>不要求澜音登录；手动操作或启用自动同步时才会请求服务。</p><p v-if="store?.persistent">敏感凭据由 Android Keystore AES-GCM 加密保存。</p><p v-else>Web 版凭据只保存在本次会话内存，重开后需重新配置。跨域服务需提供 CORS，HTTPS 页面不能连接 HTTP。</p><p>只授权确认的 origin 和专用目录，不访问上级目录或跟随重定向，不忽略 HTTPS 证书错误。请先在服务端创建专用目录。</p><p>双向同步以上次成功基线做三方比较；同一歌单两边都改时保留「冲突副本 日期 时间」，不覆盖任何一方。首版不传播删除，删除项会保留。远端损坏、401/403、重定向、超时或离线时不会修改本地库。条件写必须通过真实 ETag 验证。S3、OneDrive、Google Drive 尚未接入。</p></section>
    </main>
  </div>

  <div v-if="showAdd" class="sheet-mask" @click.self="!busy && (showAdd=false)">
    <section class="sheet add-sheet" role="dialog" aria-modal="true" aria-label="添加 WebDAV 连接"><div class="grab" /><header class="sh-head"><h2 class="sh-title">添加 WebDAV 连接</h2><button class="iconbtn quiet" :disabled="busy" aria-label="关闭连接配置" @click="showAdd=false"><Icon name="close" :size="18" /></button></header><div class="add-sheet-content">
      <p class="form-intro">连接 NAS 或自建服务，仅授权你填写的专用目录。</p>
      <div class="sync-form"><label>名称<input v-model="form.name" maxlength="80" placeholder="我的 WebDAV" /></label><label>专用目录地址<input v-model="form.address" type="url" autocomplete="off" placeholder="https://dav.example.com/CeruMusic/" /></label><label>用户名<input v-model="form.username" autocomplete="off" maxlength="512" /></label><label>密码 / 应用密码<input v-model="form.password" type="password" autocomplete="new-password" maxlength="8192" /></label><label class="check"><input v-model="form.confirmed" type="checkbox" />只授权此地址和目录，不访问上级目录或跟随重定向</label><label v-if="form.address.trim().toLowerCase().startsWith('http:')" class="check risk"><input v-model="form.allowInsecureHttp" type="checkbox" />如使用 HTTP：我了解账号与数据不加密，只用于可信网络</label></div>
      <p v-if="message" class="sync-message" role="status">{{message}}</p>
      <button class="sync-action primary full" :disabled="busy||!store||!form.confirmed||!form.address" @click="save">{{busy?'保存中…':'保存安全连接'}}</button><p class="footer-hint">保存后先测试读写，再创建备份。</p>
    </div></section>
  </div></div>
</template>

<style scoped>
.sync-header{display:flex;align-items:center;gap:6px;padding:8px 14px 10px;min-height:56px}.sync-header h1{font-size:22px;line-height:1.3;font-weight:750;letter-spacing:-.5px;margin:0;flex:1}.help-button{font-size:12px;min-height:44px;padding:0 7px;color:var(--ink-3)}.sync-content{padding:0 var(--pad) 18px}.cloud-card{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:6px 10px;width:100%;text-align:left;padding:13px;border:1px solid var(--line-2);border-radius:16px;background:var(--surface)}.cloud-caption{grid-column:1/3;color:var(--ink-3);font-size:10px;line-height:1.7;margin-top:2px;overflow-wrap:anywhere}.cloud-card>.i{justify-self:end;align-self:center;color:var(--ink-3)}.service-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;font-weight:700;font-size:11px;border-radius:11px}.green{color:var(--tint);background:var(--tint-soft)}.amber{color:#c79230;background:#fff3da}.blue{color:#597fcb;background:#eaf0ff}.service-copy{flex:1;min-width:0;align-self:center}.service-copy strong,.service-copy small{display:block}.service-copy strong{font-size:13px;font-weight:650;line-height:1.4}.service-copy small{font-size:10px;line-height:1.7;color:var(--ink-3);margin-top:3px}.status-badge{align-self:center;padding:3px 6px;border-radius:6px;font-size:10px;line-height:1.4;white-space:nowrap;color:var(--brand-strong);background:var(--tint-soft)}.status-badge.neutral{color:var(--ink-3);background:var(--surface-2)}.services-section{margin-top:17px}.sync-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.sync-section-head h2{font-size:16px;margin:0;font-weight:700}.sync-section-head>span{font-size:10px;color:var(--ink-3)}.service-list{border:1px solid var(--line-2);border-radius:16px;padding:0 12px;background:var(--surface)}.service-row{display:flex;align-items:center;gap:10px;width:100%;min-height:60px;padding:10px 0;border-bottom:1px solid var(--line-2);text-align:left}.service-row:last-child{border:0}.service-row:disabled{opacity:1;cursor:default}.service-radio{width:15px;height:15px;border:1px solid var(--line-2);border-radius:50%;flex:none}.service-radio.selected{border:5px solid var(--tint)}.config-card{margin-top:13px;padding:13px;border-radius:13px;background:var(--surface-2)}.config-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.config-heading h3{font-size:12px;margin:0;font-weight:650}.config-card>p{font-size:10px;line-height:1.7;color:var(--ink-3);margin:5px 0 0}.endpoint{overflow-wrap:anywhere}.sync-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.sync-modes span{display:block;padding:8px 3px;border:1px solid var(--line-2);border-radius:8px;text-align:center;font-size:10px;color:var(--ink-3)}.sync-modes .selected{border-color:var(--tint-soft);background:var(--tint-soft);color:var(--brand-strong)}.sync-summary{display:flex;gap:8px;padding:11px 12px;margin-top:12px;border-radius:12px;background:var(--surface-2);color:var(--ink-3);font-size:10px;line-height:1.8}.sync-summary>.i{flex:none;margin-top:2px;color:var(--tint)}.sync-summary p{margin:0}.sync-action{display:flex;align-items:center;justify-content:center;gap:6px;border-radius:10px;min-height:44px;padding:10px 12px;line-height:1.5;font-size:12px;font-weight:600}.sync-action.primary{background:var(--tint);color:#fff}.sync-action.secondary{background:var(--surface);color:var(--ink-2);border:1px solid var(--line-2)}.sync-action:disabled{opacity:.48}.sync-action.full{width:100%}.add-connection{margin-top:14px;border-radius:11px}.footer-hint{color:var(--ink-3);text-align:center;font-size:10px;line-height:1.6;margin:8px 0 0}.connection-picker{margin-top:17px}.sync-connections{display:flex;flex-wrap:wrap;gap:8px}.connection-chip{min-height:36px;padding:8px 12px;border:1px solid var(--line-2);border-radius:10px;font-size:11px;color:var(--ink-3)}.connection-chip.active{color:var(--brand-strong);background:var(--tint-soft);border-color:var(--tint-soft)}.sync-operations{margin-top:12px;padding:13px;border:1px solid var(--line-2);border-radius:14px;background:var(--surface)}.sync-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 10px}.meta{font-size:10px;line-height:1.8;color:var(--ink-3)}.sync-operations label,.sync-form label{display:block;font-size:11px;color:var(--ink-2);margin:12px 0}.sync-operations select,.sync-form input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;margin-top:6px;border:1px solid var(--line-2);border-radius:10px;background:var(--surface);color:var(--ink);font-size:13px;outline:none}.sync-form input:focus,.sync-operations select:focus{border-color:var(--tint)}.sync-preview{margin-top:12px;padding:12px;background:var(--surface-2);border-radius:12px}.sync-preview h3,.sync-help h3{font-size:13px;margin:0 0 7px}.sync-preview>p{font-size:11px;line-height:1.7;margin:5px 0}.remove-connection{width:100%;font-size:11px;color:var(--cinnabar);min-height:44px;margin-top:6px}.sync-message{font-size:11px;line-height:1.8;color:var(--cinnabar);margin:12px 0;overflow-wrap:anywhere}.sync-help{padding:13px;background:var(--surface-2);border-radius:12px;margin-top:14px;font-size:11px;line-height:1.8;color:var(--ink-3)}.sync-help p{margin:6px 0}.add-sheet{max-height:88vh;overflow:auto;background:var(--surface-solid);padding-bottom:calc(16px + var(--safe-bottom))}.add-sheet-content{padding:0 var(--pad)}.form-intro{margin:0 0 8px;font-size:11px;line-height:1.8;color:var(--ink-3)}.sync-form .check{display:flex;gap:8px;line-height:1.8;align-items:flex-start;font-size:11px}.check input{flex:none;width:16px;height:16px;margin-top:3px;accent-color:var(--tint)}.risk{color:var(--cinnabar)!important}
.two-way-card{margin-top:12px;padding:13px;border:1px solid var(--line-2);border-radius:14px;background:var(--surface)}
.sync-operations>.config-heading,.two-way-card>.config-heading{margin-bottom:8px}
.sync-status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:9px 0}
.sync-status-grid>div{min-width:0;padding:8px;border-radius:9px;background:var(--surface-2)}
.sync-status-grid span{display:block;font-size:9px;line-height:1.5;color:var(--ink-3)}
.sync-status-grid strong{display:block;margin-top:2px;font-size:11px;line-height:1.6;font-weight:650;overflow-wrap:anywhere}
.status-badge.error{color:var(--cinnabar);background:var(--surface-2)}
.auto-sync{display:flex;align-items:flex-start;gap:8px;margin:2px 0 5px;font-size:11px;line-height:1.7;color:var(--ink-2)}
.auto-sync input{flex:none;width:16px;height:16px;margin-top:3px;accent-color:var(--tint)}
.etag{overflow-wrap:anywhere}
.sync-buttons.single{grid-template-columns:1fr}
</style>
