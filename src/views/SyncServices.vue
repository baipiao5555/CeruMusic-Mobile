<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { confirmAction } from '@/core/confirm'
import { secureStore, type SecureStoreStatus } from '@/core/native/secureStore'
import { listConnections, saveConnection, removeConnection, testConnection, createBackup, publishCurrentBackup, listBackups, readBackup, commitRestore, currentBackupFile, type WebDavConnection, type RemotePreview } from '@/core/sync/webdav'

const router = useRouter()
const store = ref<SecureStoreStatus>()
const connections = ref<WebDavConnection[]>(listConnections())
const selectedId = ref(connections.value[0]?.id || '')
const selected = computed(() => connections.value.find(item => item.id === selectedId.value))
const form = ref({ name: '', address: '', username: '', password: '', confirmed: false, allowInsecureHttp: false })
const busy = ref(false)
const message = ref('')
const files = ref<string[]>([])
const file = ref('')
const preview = ref<RemotePreview>()
const restoreMode = ref<'merge' | 'replace'>('merge')
const lastCommit = ref<ReturnType<typeof commitRestore>>()
const previewTracks = computed(() => preview.value?.snapshot.playlists.reduce((sum, item) => sum + item.tracks.length, 0) || 0)
watch(file, () => { preview.value = undefined; lastCommit.value = undefined }, { flush: 'sync' })
onMounted(async () => { try { store.value = await secureStore.status() } catch { message.value = '安全仓库不可用，不能保存同步凭据。请更新客户端。' } })
function refreshConnections(): void { connections.value = listConnections() }
function choose(connection: WebDavConnection): void { selectedId.value = connection.id; files.value = []; file.value = ''; preview.value = undefined; lastCommit.value = undefined; message.value = '' }
async function run(operation: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true; message.value = ''
  try { await operation() } catch (error: any) { message.value = error?.message || '同步操作失败，未修改本地资料。' }
  finally { busy.value = false; refreshConnections() }
}
async function save(): Promise<void> {
  if (!store.value) return
  await run(async () => { const connection = await saveConnection(form.value); refreshConnections(); choose(connection); form.value = { name: '', address: '', username: '', password: '', confirmed: false, allowInsecureHttp: false }; message.value = '连接已保存。请先测试专用目录；没有启用自动双向同步。' })
}
async function test(): Promise<void> { if (selected.value) await run(async () => { message.value = (await testConnection(selected.value!)).message }) }
async function backup(): Promise<void> { if (selected.value) await run(async () => { const name = await createBackup(selected.value!); files.value = [name, ...files.value.filter(item => item !== name)]; file.value = name; message.value = '已生成独立新备份，不覆盖已有远端文件。' }) }
async function publish(): Promise<void> {
  if (!selected.value || !(await confirmAction({ title: '更新远端当前备份？', body: '只在本次 ETag 验证通过后条件写入。远端变化将返回冲突并停止；不会自动合并。', confirmText: '条件写入', danger: true }))) return
  await run(async () => { await publishCurrentBackup(selected.value!); file.value = currentBackupFile; message.value = '远端当前备份已条件写入；仍不是自动双向同步。' })
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
}
</script>

<template>
  <div class="screen sync-services"><div class="scroll safe-t">
    <div class="navrow"><button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="20" /></button><strong>同步服务</strong></div>
    <header class="phead pad"><div class="eyebrow">BACKUP · RESTORE</div><h1>连接你的 WebDAV</h1><p>不要求澜音登录 · 首批仅手动安全备份与恢复</p></header>
    <div class="pad sync-note"><p>不会上传账号密码、音源脚本或媒体文件。不是自动双向同步。</p><p v-if="store?.persistent">敏感凭据由 Android Keystore AES-GCM 加密保存。</p><p v-else class="warning">Web 版凭据只保存在本次会话内存，重开后需重新配置；跨域服务需提供 CORS，HTTPS 页面不能连接 HTTP。</p><p>NAS / 局域网只授权你确认的 origin 和专用目录；不放宽音乐音源网络限制。不忽略 HTTPS 证书错误。</p></div>
    <p v-if="message" class="pad sync-message" role="status">{{ message }}</p>
    <section class="pad sync-form"><h2>新增连接</h2><label>名称<input v-model="form.name" maxlength="80" placeholder="我的 WebDAV" /></label><label>专用目录地址<input v-model="form.address" type="url" autocomplete="off" placeholder="https://dav.example.com/CeruMusic/" /></label><label>用户名<input v-model="form.username" autocomplete="off" maxlength="512" /></label><label>密码 / 应用密码<input v-model="form.password" type="password" autocomplete="new-password" maxlength="8192" /></label><label class="check"><input v-model="form.confirmed" type="checkbox" />只授权此地址和目录，不访问上级目录或跟随重定向</label><label class="check"><input v-model="form.allowInsecureHttp" type="checkbox" />如使用 HTTP：我了解账号与数据不加密，只用于可信网络</label><button class="btn btn-primary" :disabled="busy || !store || !form.confirmed || !form.address" @click="save">保存安全连接</button></section>
    <section class="pad"><h2>已有连接</h2><div class="sync-connections"><button v-for="connection in connections" :key="connection.id" class="chip" :class="{ active: selectedId === connection.id }" :disabled="busy" @click="choose(connection)">{{ connection.name }}</button></div><p v-if="!connections.length" class="meta">还没有连接。请先在服务端手动创建专用目录。</p></section>
    <section v-if="selected" class="pad sync-operations"><h2>{{ selected.name }}</h2><p class="meta">专用地址已确认；请求只在用户主动操作时发出。</p><div class="sync-buttons"><button class="btn btn-ghost" :disabled="busy" @click="test">测试读写与 ETag</button><button class="btn btn-primary" :disabled="busy" @click="backup">保存独立新备份</button><button class="btn btn-ghost" :disabled="busy" @click="publish">条件更新当前备份</button><button class="btn btn-ghost" :disabled="busy" @click="list">列出备份</button></div><p class="meta">测试仅创建并清理 .ceru-test 临时专用文件；不删除其他文件。未验证 ETag 时不允许覆盖当前备份。</p><label>恢复文件<select v-model="file" :disabled="busy"><option value="">请选择</option><option :value="currentBackupFile">当前备份</option><option v-for="name in files.filter(name => name !== currentBackupFile)" :key="name" :value="name">{{ name }}</option></select></label><button class="btn btn-ghost" :disabled="busy || !file" @click="read">读取恢复预览</button>
      <div v-if="preview" class="sync-preview"><h3>预览：尚未恢复</h3><p>{{ preview.snapshot.playlists.length }} 个歌单 · {{ previewTracks }} 首歌单曲目 · {{ preview.snapshot.favorites.length }} 首收藏</p><p class="meta">只恢复元数据；跨设备缺音源或需私有引用的记录保留为待匹配。</p><label>恢复方式<select v-model="restoreMode" :disabled="busy"><option value="merge">合并，冲突保留副本</option><option value="replace">替换本地歌单与收藏</option></select></label><button class="btn btn-primary" :disabled="busy" @click="restore">确认恢复</button><button v-if="lastCommit" class="btn btn-ghost" :disabled="busy" @click="undo">撤销本次恢复</button></div><button class="btn btn-ghost" :disabled="busy" @click="remove">移除本机连接</button>
    </section>
    <section class="pad sync-future"><h2>其他服务</h2><p>S3：尚未接入</p><p>OneDrive：尚未接入</p><p>Google Drive：尚未接入</p><p class="meta">不以按钮提示冒充成功登录或同步。</p></section>
  </div></div>
</template>

<style scoped>
.sync-services .phead{padding-top:16px}.sync-services h1{font-size:25px;line-height:1.5}.sync-services h2{font-size:18px;margin:22px 0 12px}.sync-services h3{font-size:15px}.sync-services .phead p,.sync-note,.sync-message{font-size:12px;line-height:1.8}.sync-note{color:var(--ink-3);padding-top:10px}.sync-note p{margin-bottom:6px}.warning,.sync-message{color:var(--cinnabar)}.sync-message{padding-top:12px;padding-bottom:8px}.sync-form label,.sync-operations label{display:block;font-size:12px;margin:12px 0;color:var(--ink-2)}.sync-services input:not([type=checkbox]),.sync-services select{display:block;box-sizing:border-box;width:100%;min-height:44px;padding:10px;border:1px solid var(--line-2);border-radius:9px;background:var(--surface);color:var(--ink);margin-top:6px}.sync-form .check{display:flex;align-items:flex-start;gap:8px;line-height:1.8}.check input{margin-top:4px;flex:none}.sync-buttons{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.sync-services .btn{min-height:44px;font-size:12px}.sync-connections{display:flex;flex-wrap:wrap;gap:8px}.sync-connections .active{color:var(--brand-strong);background:var(--tint-soft)}.sync-preview{margin:16px 0;padding:12px;border:1px solid var(--line-2);border-radius:12px;font-size:12px;line-height:1.8}.sync-preview .btn{margin-right:6px;margin-top:8px}.sync-future{padding-bottom:24px;font-size:12px;line-height:1.8}.sync-operations>.btn{margin:8px 0}.sync-services .meta{font-size:11px;line-height:1.8}
</style>
