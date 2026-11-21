<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { repositoryLines, selectCatalogLine, type CatalogLine } from '@/core/plugin/distribution'
import { knownCatalogManifests } from '@/core/plugin/catalogManifests'
import { platformId } from '@/core/trackGrouping'
import Icon from '@/components/Icon.vue'
import CatalogLineChoices from '@/components/CatalogLineChoices.vue'
import { confirmAction } from '@/core/confirm'
import { settingsState, updateSettings } from '@/core/settings'
import { catalogCategories, catalogState, refreshCatalog, type CatalogItem } from '@/core/plugin/catalog'
import { allProviders, applyPluginUpdate, comparePluginVersions, disablePlugin, enablePlugin, fetchPluginCode, getPluginConfig,
  inspectPlugin, installPlugin, pluginState, preparePluginCode, previewPluginUpdate, removePlugin,
  restorePluginPrevious, savePluginConfig, selectProvider, searchProviders, setSearchSources, setPluginUpdateUrl,
  type PluginDescriptor, type PluginUpdateCandidate, type ProviderHandle } from '@/core/plugin/manager'

type Dialog = 'fetch' | 'import' | 'detail' | 'install' | 'sources' | 'source' | 'config' | 'repo' | 'scene' | 'health'
type Pending = { code: string; manifest: any; sourceUrl?: string; origin: 'market' | 'url' | 'file'; item?: CatalogItem; update?: PluginUpdateCandidate }
const router = useRouter(), route = useRoute()
const installedView = ref<'platforms'|'plugins'>('platforms')
const tab = ref<'discover' | 'installed' | 'updates'>('discover'), search = ref(''), category = ref('常用音乐')
const dialog = ref<Dialog | null>(null), panel = ref<HTMLElement>(), fileInput = ref<HTMLInputElement>()
const busy = ref(''), error = ref(''), info = ref(''), inputUrl = ref(''), allowHttp = ref(false), accepted = ref(false)
const detail = ref<CatalogItem>(), selectedPlugin = ref<PluginDescriptor>(), pending = ref<Pending | null>(null)
const selectedSources = ref<string[]>([])
const selectedProvider = ref<ProviderHandle>(), providerQuery = ref(''), configValues = ref<Record<string, any>>({})
const updateUrl = ref(''), candidates = ref<PluginUpdateCandidate[]>([]), updateErrors = ref<Record<string, string>>({})
const checkedUpdates = ref(false), scene = ref('常用音乐'), sceneSelected = ref<string[]>([])
const batch = ref<CatalogItem[]>([]), batchResults = ref<Array<{ name: string; status: string }>>([])
const batchRunning = ref(false)
const health = ref(''), healthQuery = ref('音乐')
const fetchMessage = ref(''), fetchingName = ref(''), failedItem = ref<CatalogItem>(), failedUrl = ref('')
let downloadController: AbortController | null = null
let previousOverflow = ''
let sequence = 0, focusBefore: HTMLElement | null = null
const installed = computed(() => pluginState.plugins)
const providers = computed(() => allProviders(true))
const platformCount = computed(() => new Set(providers.value.map(p => ({kw:'kuwo',kg:'kugou',tx:'qq',wy:'netease',mg:'migu'} as Record<string,string>)[p.providerId] || p.providerId)).size)
const current = computed(() => providers.value.find(p => p.providerId === pluginState.selectedProvider &&
  (!pluginState.selectedSourcePlugin[p.providerId] || pluginState.selectedSourcePlugin[p.providerId] === p.pluginId)))
const catalogItems = computed(() => catalogState.items.filter(p => (category.value === '全部' || p.category === category.value) &&
  `${p.name} ${p.description}`.toLowerCase().includes(search.value.trim().toLowerCase()))
  .sort((a, b) => catalogRank(a) - catalogRank(b)))
const installedItems = computed(() => installed.value.filter(p => `${p.name} ${p.providers.map(x => x.name).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
type PlatformMember = { plugin:PluginDescriptor; provider:ProviderHandle }
const platformGroups = computed(() => {
  const groups = new Map<string,{id:string;name:string;members:PlatformMember[]}>()
  for (const plugin of installed.value) for (const provider of plugin.providers) {
    const id=platformId(provider.id), name=provider.name || plugin.name
    if (!groups.has(id)) groups.set(id,{id,name,members:[]})
    groups.get(id)!.members.push({plugin,provider:{pluginId:plugin.pluginId,manifestId:plugin.manifestId,pluginName:plugin.name,providerId:provider.id,name,qualities:provider.qualities,protocols:provider.protocols,methods:provider.methods}})
  }
  const rank=(id:string)=>{const index=['qq','kuwo','kugou','netease','migu'].indexOf(id);return index<0?99:index};return [...groups.values()].sort((a,b)=>rank(a.id)-rank(b.id)||a.name.localeCompare(b.name))
})
const visiblePlatformGroups = computed(()=>platformGroups.value.filter(g=>(g.name+' '+g.members.map(m=>m.plugin.name).join(' ')).toLowerCase().includes(search.value.trim().toLowerCase())))
async function managePlugin(plugin:PluginDescriptor):Promise<void> {
  installedView.value='plugins';tab.value='installed';search.value='';close();await nextTick()
  document.querySelector<HTMLElement>(`[data-plugin-id="${CSS.escape(plugin.manifestId)}"]`)?.scrollIntoView({block:'center'})
}
function useAsDefault(member:PlatformMember):void {
  if(!member.plugin.running) return
  try { const selected=searchProviders();if(!selected.some(p=>sourceKey(p)===sourceKey(member.provider)))setSearchSources([...selected,member.provider]);selectProvider(member.provider.providerId,member.provider.pluginId);info.value=`默认来源：${member.provider.name} · ${member.plugin.name}` }
  catch(e:any){error.value=e.message}
}
const sceneItems = computed(() => catalogState.items.filter(p => p.category === scene.value))
const pendingExisting = computed(() => installed.value.find(p => p.manifestId === pending.value?.manifest.id))
const permissions = computed(() => Array.isArray(pending.value?.manifest.permissions) ? pending.value!.manifest.permissions : [])
const pendingPlatforms = computed(() => pending.value?.manifest.contributes?.providers || [])

function catalogRank(item: CatalogItem): number { const i = ['ceru.qq', 'ceru.kuwo', 'ceru.netease', 'ceru.kugou', 'ceru.migu', 'ceru.qishui'].indexOf(item.manifestId); return i < 0 ? item.format === 'lx' ? 6 : 20 : i }
function identity(id: string, name: string): { label: string; style: Record<string, string> } {
  const key = id.replace(/^ceru\./, '')
  const map: Record<string, [string, string]> = { qq:['Q','#12b596'], kuwo:['KW','#e2b224'], kugou:['K','#3788da'], netease:['云','#e75e73'], migu:['M','#a66bd3'], qishui:['汽','#303a46'] }
  const value = id.startsWith('lx:') ? ['LX','#2b6653'] : map[key] || [name.slice(0,1), 'var(--c500)']
  return { label: value[0], style: { background: value[1], color: '#fff' } }
}
function providerIdentity(p: ProviderHandle): {label:string;style:Record<string,string>} {
  const platform = ({kw:'kuwo',kg:'kugou',tx:'qq',wy:'netease',mg:'migu'} as Record<string,string>)[p.providerId] || p.providerId
  return identity('ceru.'+platform,p.name)
}
const detailManifest = computed(() => Object.values(knownCatalogManifests).find(m => m.id === detail.value?.manifestId && m.version === detail.value?.version))
const detailCapabilities = computed(() => {
  const m = detailManifest.value
  if (!m) return []
  return [...new Set((m.contributes?.providers || []).flatMap((p: any) => p.methods || p.protocols || []))].map(x => String(x))
})
function capabilityName(value: string): string { return ({'music.search@1':'搜索','music.resolve@1':'播放取链','music.lyrics@1':'歌词','music.charts@1':'榜单','music.playlists@1':'歌单', 'tracks.search':'搜索', 'tracks.resolve':'播放取链', 'tracks.lyrics':'歌词', 'charts.list':'榜单', 'charts.get':'榜单详情', 'playlists.search':'歌单搜索', 'playlists.get':'歌单内容', 'playlists.import':'歌单导入'} as Record<string,string>)[value] || value }
async function changeLine(value: string): Promise<void> {
  try { const line = value as CatalogLine; selectCatalogLine(line); catalogState.line = line; info.value = '下载线路已切换；可直接重试，不必等待目录刷新' }
  catch(e: any) { error.value = e.message }
}
async function copyLink(url: string): Promise<void> { try { await navigator.clipboard.writeText(url); info.value = '文件链接已复制' } catch { error.value = '无法访问剪贴板，可在来源信息中长按复制链接' } }

function installedFor(item: CatalogItem): PluginDescriptor | undefined {
  return installed.value.find(p => p.catalogKey === item.key || p.manifestId === item.manifestId)
}
function permissionName(p: any): string {
  return ({ 'network.request': '访问公网网络', 'network.private': '访问局域网', 'library.read': '读取歌单',
    'library.write': '修改歌单', 'library.delete': '删除歌单内容', 'player.control': '控制播放',
    'account.profile': '读取账号信息', 'downloads.create': '创建下载', 'clipboard.read': '读取剪贴板' } as Record<string, string>)[p.name] || p.name || '未知权限'
}
function originName(plugin: PluginDescriptor): string {
  return plugin.installOrigin === 'market' ? '市场安装' : plugin.installOrigin === 'file' ? '文件导入' :
    plugin.installOrigin === 'url' ? 'URL 导入' : plugin.sourceUrl ? 'URL 导入（历史）' : '历史来源未记录'
}
function statusName(plugin: PluginDescriptor): string { return plugin.loadError ? '加载失败' : plugin.running ? '已启用' : '已停用' }
function open(type: Dialog): void { if (busy.value === 'install') return; error.value = ''; dialog.value = type }
function close(): void {
  if (busy.value === 'install') return
  if (batchRunning.value) {
    batchResults.value.push(...batch.value.map(p => ({ name: p.name, status: '已取消，未安装' })))
    info.value = batchResults.value.map(p => `${p.name}：${p.status}`).join('；')
  }
  batchRunning.value = false
  downloadController?.abort(); downloadController = null
  sequence++; busy.value = ''; dialog.value = null; pending.value = null; batch.value = []
}
function openDetail(item: CatalogItem): void { detail.value = item; open('detail') }
function sourceKey(p: Pick<ProviderHandle,'pluginId'|'providerId'>): string { return JSON.stringify([p.pluginId,p.providerId]) }
function openSources(provider?: ProviderHandle): void {
  selectedSources.value = searchProviders().map(sourceKey)
  if (provider && !selectedSources.value.includes(sourceKey(provider))) selectedSources.value.push(sourceKey(provider))
  selectedProvider.value = provider || current.value || providers.value.find(p => selectedSources.value.includes(sourceKey(p)))
  providerQuery.value = ''; open('sources')
}
function toggleSource(p: ProviderHandle): void {
  const key = sourceKey(p), at = selectedSources.value.indexOf(key)
  if (at < 0) { selectedSources.value.push(key); selectedProvider.value = p }
  else { selectedSources.value.splice(at,1); if (selectedProvider.value && sourceKey(selectedProvider.value) === key) selectedProvider.value = providers.value.find(x => selectedSources.value.includes(sourceKey(x))) }
}

function choosePlatform(plugin: PluginDescriptor, id: string): void {
  const handle = providers.value.find(p => p.pluginId === plugin.pluginId && p.providerId === id)
  if (handle) openSources(handle)
}
function applySource(): void {
  const chosen = providers.value.filter(p => selectedSources.value.includes(sourceKey(p)))
  if (!chosen.length || chosen.length !== selectedSources.value.length) { error.value = '请选择至少一个仍在启用的平台来源'; return }
  const primary = selectedProvider.value && chosen.some(p => sourceKey(p) === sourceKey(selectedProvider.value!)) ? selectedProvider.value : chosen[0]
  try { setSearchSources(chosen); selectProvider(primary.providerId, primary.pluginId) }
  catch(e: any) { error.value = e.message; return }
  info.value = `已选择 ${chosen.length} 个搜索来源；默认 ${primary.name} · ${primary.pluginName}。当前播放不会中断。`; close()
}
async function prepare(raw: string, origin: Pending['origin'], sourceUrl?: string, item?: CatalogItem, epoch = sequence): Promise<void> {
  const code = await preparePluginCode(raw)
  let manifest: any
  try { manifest = inspectPlugin(code) } catch (e: any) {
    if (item?.format === 'ceru' && /Expected exports\.manifest/.test(e.message || '')) throw new Error('这个仓库文件采用未匹配的混淆声明，已安全停止；请规范导出声明或更新本版兼容数据')
    throw new Error('无法识别插件文件；仅支持澜音 v2 或 LX：' + (e.message || '格式不兼容'))
  }
  if (item && (manifest.id !== item.manifestId || (item.format === 'ceru' && manifest.version !== item.version))) throw new Error('目录和文件 ID / 版本不一致，请刷新目录后重试')
  const existing = installed.value.find(p => p.manifestId === manifest.id)
  if (existing && comparePluginVersions(manifest.version, existing.version) < 0) throw new Error('文件版本低于当前版本；不直接降级，请使用恢复上一版')
  if (epoch !== sequence) return
  pending.value = { code, manifest, sourceUrl, origin, item }; accepted.value = false; dialog.value = 'install'
}
async function download(origin: 'market' | 'url', url: string, item?: CatalogItem): Promise<void> {
  if (busy.value) return
  const id = ++sequence
  downloadController?.abort(); downloadController = new AbortController()
  failedItem.value = item; failedUrl.value = origin === 'url' ? url : ''
  fetchingName.value = item?.name || '在线音源'; fetchMessage.value = '正在连接下载线路…'
  pending.value = null; error.value = ''; dialog.value = 'fetch'; busy.value = 'fetch'
  try {
    const code = await fetchPluginCode(url, { signal: downloadController.signal, onAttempt: value => { if (id === sequence) fetchMessage.value = value } })
    if (id === sequence) { fetchMessage.value = '文件已获取，正在核对格式、版本与权限…'; await prepare(code, origin, url, item, id) }
  } catch (e: any) { if (id === sequence) error.value = e.message || '获取失败，请重试或切换下载线路' }
  finally { if (id === sequence) { busy.value = ''; downloadController = null } }
}
async function getItem(item: CatalogItem): Promise<void> { await download('market', item.url, item) }
async function getUrl(): Promise<void> {
  const value = inputUrl.value.trim()
  if (!value) return
  if (/^http:\/\//i.test(value) && !allowHttp.value) { error.value = '请确认非加密 HTTP 链接风险，或改用 HTTPS'; return }
  await download('url', value)
}
async function retryDownload(): Promise<void> {
  if (failedItem.value) await getItem(failedItem.value)
  else if (failedUrl.value) await download('url', failedUrl.value)
}
async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  if (file.size > 16 * 1024 * 1024) { error.value = '插件文件超过 16 MiB'; return }
  const id = ++sequence; busy.value = 'file'; error.value = ''
  try { const code = await file.text(); if (id === sequence) await prepare(code, 'file', undefined, undefined, id) }
  catch (e: any) { if (id === sequence) error.value = e.message || '文件不是支持的插件格式' }
  finally { if (id === sequence) busy.value = '' }
}
async function confirmInstall(): Promise<void> {
  if (!pending.value || !accepted.value || busy.value) return
  const p = pending.value, updating = Boolean(p.update || pendingExisting.value); busy.value = 'install'; error.value = ''
  try {
    const result = p.update ? await applyPluginUpdate(p.update, accepted.value) : await installPlugin(p.code, {
      enable: true, grantDeclared: true, sourceUrl: p.sourceUrl, installOrigin: p.origin, catalogKey: p.item?.key })
    info.value = `${result.name} v${result.version} 已${updating ? '更新' : '安装'}；请按需要选择具体平台`
    candidates.value = candidates.value.filter(x => x.pluginId !== result.pluginId)
    batchResults.value.push({ name: result.name, status: '成功' }); pending.value = null
    tab.value = 'installed'; dialog.value = null
  } catch (e: any) { error.value = e.message || '安装失败，未覆盖原来的有效版本'; return }
  finally { busy.value = '' }
  if (batchRunning.value) await nextBatch()
}
async function toggle(plugin: PluginDescriptor): Promise<void> {
  if (busy.value) return
  if(plugin.running && plugin.providers.length>1 && !(await confirmAction({title:'停用 '+plugin.name+'？',body:`它提供的 ${plugin.providers.length} 个平台会一起停止；不删除歌单和歌曲。`,confirmText:'停用插件'})))return
  busy.value = plugin.pluginId; error.value = ''
  try { if (plugin.running) await disablePlugin(plugin.pluginId); else await enablePlugin(plugin.pluginId) }
  catch (e: any) { error.value = e.message || '插件加载失败' } finally { busy.value = '' }
}
async function uninstall(plugin: PluginDescriptor): Promise<void> {
  if (!(await confirmAction({ title: `卸载「${plugin.name}」？`, body: '会移除该插件、配置与关联登录状态；不删除你的本机歌曲、收藏或歌单。', confirmText: '卸载', danger: true }))) return
  busy.value = plugin.pluginId
  try { await removePlugin(plugin.pluginId); info.value = `${plugin.name} 已卸载` } catch (e: any) { error.value = e.message } finally { busy.value = '' }
}
async function checkOne(plugin: PluginDescriptor): Promise<void> {
  busy.value = 'check'; error.value = ''
  try {
    const result = await previewPluginUpdate(plugin.pluginId)
    candidates.value = candidates.value.filter(x => x.pluginId !== plugin.pluginId)
    if (result.versionOrder >= 0 && result.contentChanged) {
      candidates.value.push(result); pending.value = { code: result.code, manifest: result.manifest, origin: plugin.installOrigin === 'market' ? 'market' : plugin.sourceUrl ? 'url' : 'file', sourceUrl: plugin.sourceUrl, update: result }
      accepted.value = false; dialog.value = 'install'
    } else info.value = result.versionOrder < 0 ? '远端版本比本机旧，未降级' : `${plugin.name} 已是当前版本`
  } catch (e: any) { error.value = e.message || '检查失败' } finally { busy.value = '' }
}
async function checkAll(): Promise<void> {
  if (busy.value) return
  const id = ++sequence; busy.value = 'check'; checkedUpdates.value = false; candidates.value = []; updateErrors.value = {}
  try {
    for (const plugin of installed.value.filter(p => p.updateUrl || p.sourceUrl)) {
      if (id !== sequence) break
      try { const candidate = await previewPluginUpdate(plugin.pluginId); if (id === sequence && candidate.versionOrder >= 0 && candidate.contentChanged) candidates.value.push(candidate) }
      catch (e: any) { if (id === sequence) updateErrors.value[plugin.pluginId] = e.message || '检查失败' }
    }
    if (id === sequence) checkedUpdates.value = true
  } finally { if (id === sequence) busy.value = '' }
}
function showUpdate(candidate: PluginUpdateCandidate): void {
  const p = installed.value.find(x => x.pluginId === candidate.pluginId)
  pending.value = { code: candidate.code, manifest: candidate.manifest, origin: p?.installOrigin === 'market' ? 'market' : 'url', sourceUrl: p?.sourceUrl, update: candidate }
  accepted.value = false; open('install')
}
async function restore(plugin: PluginDescriptor): Promise<void> {
  if (!(await confirmAction({ title: `恢复 ${plugin.name} 的上一版？`, body: '恢复此前代码、权限与配置，不降级整个应用，也不清空歌单。', confirmText: '恢复上一版' }))) return
  busy.value = plugin.pluginId
  try { const result = await restorePluginPrevious(plugin.pluginId); info.value = `已恢复 ${result.name} v${result.version}` }
  catch (e: any) { error.value = e.message || '恢复失败' } finally { busy.value = '' }
}
async function openConfig(plugin: PluginDescriptor): Promise<void> {
  selectedPlugin.value = plugin; configValues.value = { ...plugin.configDefaults, ...await getPluginConfig(plugin.pluginId) }; open('config')
}
async function saveConfig(): Promise<void> {
  if (!selectedPlugin.value) return
  try { await savePluginConfig(selectedPlugin.value.pluginId, configValues.value); info.value = '配置已保存'; close() } catch (e: any) { error.value = e.message }
}
function showSource(plugin: PluginDescriptor): void { selectedPlugin.value = plugin; updateUrl.value = plugin.updateUrl || ''; open('source') }
async function bindUpdateUrl(): Promise<void> {
  if (!selectedPlugin.value || !updateUrl.value.trim()) return
  busy.value = 'bind'
  try { selectedPlugin.value = await setPluginUpdateUrl(selectedPlugin.value.pluginId, updateUrl.value); info.value = '更新地址已核对插件 ID 并保存' }
  catch (e: any) { error.value = e.message } finally { busy.value = '' }
}
function openScene(value: string): void { scene.value = value; sceneSelected.value = sceneItems.value.filter(p => !installedFor(p)).map(p => p.key); batchResults.value = []; open('scene') }
async function startBatch(): Promise<void> {
  batch.value = sceneItems.value.filter(p => sceneSelected.value.includes(p.key) && !installedFor(p)); batchResults.value = []; batchRunning.value = true; await nextBatch()
}
async function nextBatch(): Promise<void> {
  const item = batch.value.shift()
  if (!item) { batchRunning.value = false; dialog.value = null; info.value = batchResults.value.map(p => `${p.name}：${p.status}`).join('；'); return }
  await getItem(item)
  if (!pending.value && error.value) { batchResults.value.push({ name: item.name, status: '获取失败，可重试' }); dialog.value = 'scene' }
}
async function skipBatch(): Promise<void> { if (pending.value) batchResults.value.push({ name: pending.value.manifest.name, status: '已跳过' }); pending.value = null; await nextBatch() }
async function testSearch(): Promise<void> {
  const p = selectedProvider.value || current.value
  if (!p) return
  health.value = ''; busy.value = 'health'
  try {
    const { invokeProvider } = await import('@/core/plugin/manager')
    const result = await invokeProvider(p, 'tracks.search', [{ query: healthQuery.value.trim() || '音乐', kinds: ['track'], filters: {}, limit: 5 }])
    if (result?.ok === false || result?.error) throw new Error(result?.error?.message || '平台搜索失败')
    const items = Array.isArray(result) ? result : result?.items
    if (!Array.isArray(items)) throw new Error('平台没有返回有效的搜索列表')
    health.value = `${p.name} · ${p.pluginName}：搜索请求完成，返回 ${items.length} 条。${new Date().toLocaleString()}；不代表所有歌曲都可播放。`
  } catch (e: any) { health.value = `${p.name} · 本次搜索检测失败：${e.message || e}` } finally { busy.value = '' }
}
function onKey(event: KeyboardEvent): void {
  if (!dialog.value) return
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key === 'Tab' && panel.value) {
    const nodes = Array.from(panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,textarea,a[href]')).filter(e => e.offsetParent !== null)
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
watch(() => pluginState.loading, loading => {
  if (!loading && dialog.value === 'sources' && !selectedSources.value.length) { selectedSources.value = searchProviders().map(sourceKey); selectedProvider.value = current.value || providers.value.find(p => selectedSources.value.includes(sourceKey(p))) }
})
watch(dialog, async (value, previous) => {
  if (value && !previous) { focusBefore = document.activeElement as HTMLElement; previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  await nextTick()
  if (value) panel.value?.querySelector<HTMLElement>('input,button,select')?.focus()
  else { document.body.style.overflow = previousOverflow; if (focusBefore?.isConnected) focusBefore.focus() }
})
onMounted(() => { if (route.query.tab === 'updates') tab.value = 'updates'; if(route.query.select === 'platforms') { tab.value='installed'; openSources() }; void refreshCatalog(); document.addEventListener('keydown', onKey) })
onUnmounted(() => { downloadController?.abort(); if (dialog.value) document.body.style.overflow = previousOverflow; sequence++; document.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="screen market-page"><div class="scroll safe-t-lg">
    <div class="appbar"><button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="20" /></button><div class="ttl">音源市场</div><button class="iconbtn quiet" aria-label="添加音源" :disabled="!!busy" @click="open('import')"><Icon name="plus" :size="20" /></button></div>
    <div class="pad"><div v-if="error && !dialog" class="notice error">{{ error }}</div><div v-if="info" class="notice ok market-info">{{ info }}</div>
      <div class="market-search"><Icon name="search" :size="17" /><input v-model="search" type="search" aria-label="搜索音源" placeholder="搜索音源名称或平台" /></div>
      <div class="market-tabs" role="tablist"><button :class="{ active: tab === 'discover' }" @click="tab = 'discover'">发现</button><button :class="{ active: tab === 'installed' }" @click="tab = 'installed'">已安装 {{ installed.length }}</button><button :class="{ active: tab === 'updates' }" @click="tab = 'updates'">更新 {{ candidates.length || '' }}</button></div>
      <template v-if="tab === 'discover'">
        <div class="market-hero"><div class="hero-orbits" aria-hidden="true"><i></i><i></i><span class="hero-token q">Q</span><span class="hero-token kw">KW</span><span class="hero-token cloud">云</span></div><div class="eb">FIND YOUR NEXT SOUND</div><h2>把喜欢的音乐<br>接进澜音</h2><p>挑选音源 · 按需安装</p></div>
        <div class="market-categories"><button v-for="c in [...catalogCategories, '全部']" :key="c" :class="{ active: category === c }" @click="category = c">{{ c }}</button></div>
        <div class="market-section"><h3>{{ category === '常用音乐' ? '常用平台' : category }} <small>{{ catalogItems.length }} 个插件</small></h3><button :disabled="catalogState.loading" @click="refreshCatalog(true)"><Icon name="refresh" :size="13" />{{ catalogState.loading ? '刷新中' : '刷新目录' }}</button></div>
        <p v-if="catalogState.error" class="market-warning">{{ catalogState.error }}</p>
        <div class="market-grid"><article v-for="item in catalogItems" :key="item.key" class="catalog-card"><button class="catalog-card-head" @click="openDetail(item)"><span class="market-monogram" :style="identity(item.manifestId, item.name).style">{{ identity(item.manifestId, item.name).label }}</span><span><strong>{{ item.name }}</strong><small>v{{ item.version }}</small></span></button><p>{{ item.format === 'lx' ? '多平台音源 · 未检测' : '社区音源 · 未检测' }}</p><div class="catalog-foot"><span class="format-badge">{{ item.format === 'lx' ? 'LX' : 'Ceru v2' }}</span><button :disabled="!!busy" @click="installedFor(item) ? tab = 'installed' : getItem(item)">{{ installedFor(item) ? '已安装' : '获取' }}</button></div></article></div>
        <p class="market-caption catalog-sync">{{ catalogState.builtin ? '显示随包目录 · 可获取文件后核对' : '目录已同步 · ' + new Date(catalogState.cachedAt).toLocaleDateString() }}</p><div v-if="!catalogItems.length" class="empty"><h3>没有匹配的音源</h3><p>换一个分类或名称试试。</p></div>
        <div class="market-section"><h3>按听歌场景选择</h3></div><div class="market-scenes"><button v-for="c in ['常用音乐', 'DJ电音', '听书电台']" :key="c" :disabled="!!busy" @click="openScene(c)">{{ c }}<small>按需勾选，不装整个仓库</small><Icon name="chevron" :size="14" /></button></div>
        <button class="btn btn-ghost btn-block mt14" @click="open('repo')">仓库、线路与更新设置</button>
      </template>
      <template v-else-if="tab === 'installed'"><p class="market-caption">{{ installed.length }} 个插件 · {{ platformCount }} 个已启用平台 · {{ providers.length }} 个可选来源</p>
        <div class="market-current"><span class="market-monogram">{{ current?.name.slice(0, 1) || '♪' }}</span><div><strong>{{ current ? current.name + ' · 默认来源' : '还没有选择默认来源' }}</strong><small>{{ current ? '来自 ' + current.pluginName : '先启用插件，再多选参与搜索的平台' }}</small></div><button :disabled="!!busy || !providers.length" @click="openSources()">切换<Icon name="chevron" :size="14" /></button></div>
        <div class="market-section"><h3>已安装 {{ installed.length }} 个插件</h3><small>来源候选 {{ providers.length }} 个</small></div>
        <div class="installed-view-tabs"><button :class="{active:installedView==='platforms'}" @click="installedView='platforms'">按平台聚合</button><button :class="{active:installedView==='plugins'}" @click="installedView='plugins'">插件管理</button></div>
        <template v-if="installedView==='platforms'">
          <article v-for="group in visiblePlatformGroups" :key="group.id" class="platform-card" :data-platform-group="group.id"><header><span class="market-monogram" :style="identity('ceru.'+group.id,group.name).style">{{ identity('ceru.'+group.id,group.name).label }}</span><div><h3>{{ group.name }}</h3><p>{{ group.members.length }} 个来源 · {{ group.members.filter(m=>m.plugin.running).length }} 个已运行</p></div></header>
            <div v-for="member in group.members" :key="sourceKey(member.provider)" class="platform-member"><div class="member-info"><strong>{{ member.plugin.name }}</strong><small>{{ member.plugin.format==='lx'?'LX 多平台插件':'独立插件' }} · v{{ member.plugin.version }} · {{ originName(member.plugin) }}</small><span v-if="current?.pluginId===member.plugin.pluginId&&current?.providerId===member.provider.providerId" class="format-badge">默认来源</span><span v-if="pluginState.searchSources.some(p=>sourceKey(p)===sourceKey(member.provider))" class="member-selected">参与搜索</span><p v-if="member.plugin.loadError" class="market-warning">{{ member.plugin.loadError }}</p></div><button class="switch" :class="{on:member.plugin.running}" role="switch" :aria-label="'启停 '+member.plugin.name" :aria-checked="member.plugin.running" :disabled="!!busy" @click="toggle(member.plugin)" /></div>
            <div v-for="member in group.members" :key="'actions:'+sourceKey(member.provider)" class="platform-member-actions"><small>{{ member.plugin.name }}</small><button :disabled="!member.plugin.running||!!busy" @click="openSources(member.provider)">选择来源</button><button :disabled="!member.plugin.running||!!busy" @click="useAsDefault(member)">设为默认</button><button @click="managePlugin(member.plugin)">管理插件</button></div>
          </article><div v-if="!visiblePlatformGroups.length" class="empty"><h3>没有匹配平台</h3><button class="btn btn-tonal" @click="tab='discover'">去安装音源</button></div>
          <p class="market-caption">QQ 原生插件和 LX 的 QQ 会归入同一个平台；文件、配置、权限和更新仍按各自插件保存。</p>
        </template>
        <template v-else>
        <article v-for="plugin in installedItems" :key="plugin.pluginId" class="installed-card" :data-plugin-id="plugin.manifestId"><div class="installed-head"><span class="market-monogram" :style="identity(plugin.manifestId, plugin.name).style">{{ identity(plugin.manifestId, plugin.name).label }}</span><div><strong>{{ plugin.name }}</strong><small>v{{ plugin.version }} · {{ plugin.format === 'lx' ? 'LX' : 'Ceru v2' }}</small><button class="source-pill" @click="showSource(plugin)"><Icon name="link" :size="11" />{{ originName(plugin) }}</button></div><span class="status-badge" :class="{ failed: !!plugin.loadError }">{{ statusName(plugin) }}</span><button class="switch" :class="{ on: plugin.running }" role="switch" :aria-checked="plugin.running" :aria-label="'启停 ' + plugin.name" :disabled="!!busy" @click="toggle(plugin)" /></div>
          <p v-if="plugin.loadError" class="market-warning">{{ plugin.loadError }}</p><p class="market-caption">{{ plugin.providers.length ? '提供 ' + plugin.providers.length + ' 个平台 · 可多选搜索' : '平台信息将在成功启用后由插件注册' }}</p><div class="installed-platforms"><button v-for="p in plugin.providers" :key="p.id" :class="{ active: pluginState.searchSources.some(s => s.pluginId === plugin.pluginId && s.providerId === p.id) || (!pluginState.searchSources.length && current?.pluginId === plugin.pluginId && current?.providerId === p.id) }" :disabled="!!busy || !plugin.running" @click="choosePlatform(plugin, p.id)">{{ p.name }}</button></div>
          <div class="installed-actions"><button v-if="plugin.updateUrl" :disabled="!!busy" @click="checkOne(plugin)">检查更新</button><button v-if="Object.keys(plugin.configDefaults).length" :disabled="!!busy" @click="openConfig(plugin)">配置</button><button v-if="plugin.hasRollback" :disabled="!!busy" @click="restore(plugin)">恢复上一版</button><button :disabled="!!busy" @click="uninstall(plugin)"><Icon name="trash" :size="12" />卸载</button></div>
        </article><div v-if="!installedItems.length" class="empty"><h3>{{ installed.length ? '没有匹配的插件' : '还没有安装音源' }}</h3><p>市场、URL 和文件导入都会显示在这里。</p><button class="btn btn-tonal" @click="tab = 'discover'">去发现音源</button></div>
        </template>
        <p class="market-caption">已启用不等于每首歌都可播放；多平台插件只占一张安装卡，统一更新和卸载。</p>
      </template>
      <template v-else>
        <div class="market-section"><h3>更新预览</h3><button :disabled="!!busy" @click="checkAll">{{ busy === 'check' ? '检查中…' : '检查全部' }}</button></div><p class="market-caption">这里只检查，不会提前安装。新增权限或平台变化需要确认；包含有更新地址的停用插件。</p>
        <article v-for="c in candidates" :key="c.pluginId" class="installed-card"><h3>{{ c.manifest.name }}</h3><p>v{{ c.previousVersion }} → v{{ c.version }}</p><p v-if="c.versionOrder === 0" class="market-warning">同版本内容发生变化，需人工确认。</p><p v-if="c.permissionsChanged" class="market-warning">权限范围发生变化</p><p v-if="c.removedProviders.length" class="market-warning">移除平台：{{ c.removedProviders.join('、') }}</p><button class="btn btn-tonal" :disabled="!!busy" @click="showUpdate(c)">查看并确认更新</button></article>
        <div v-for="(message, id) in updateErrors" :key="id" class="notice error">{{ installed.find(p => p.pluginId === id)?.name }}：{{ message }}</div><div v-if="!candidates.length && !Object.keys(updateErrors).length" class="empty"><h3>{{ checkedUpdates ? '没有需要确认的新版本' : '还没有检查记录' }}</h3><p>没有更新地址的插件可在来源详情中绑定。</p></div>
      </template>
    </div>
  </div><input ref="fileInput" type="file" accept=".js,.mjs,text/javascript,application/javascript" hidden @change="onFile" />
  <Teleport to="body"><Transition name="market-sheet"><div v-if="dialog" class="sheet-mask market-overlay" :class="{ 'market-full': dialog === 'detail' || dialog === 'sources' }" @click.self="close"><div class="scrim" @click="close" /><section ref="panel" class="market-panel" role="dialog" aria-modal="true" aria-label="音源市场弹层" tabindex="-1"><div class="market-dialog-head"><h2>{{ dialog === 'fetch' ? (error ? '获取失败' : '获取音源') : dialog === 'import' ? '添加音源' : dialog === 'sources' ? '选择搜索来源' : dialog === 'install' ? (pending?.update ? '确认更新' : '确认安装') : dialog === 'config' ? '插件配置' : dialog === 'source' ? '插件来源' : dialog === 'repo' ? '仓库与更新设置' : dialog === 'scene' ? '选择场景音源' : dialog === 'health' ? '平台搜索检测' : '音源详情' }}</h2><button class="iconbtn quiet" aria-label="关闭" :disabled="busy === 'install'" @click="close"><Icon name="close" :size="18" /></button></div>
    <div v-if="error" class="notice error">{{ error }}</div>
    <template v-if="dialog === 'fetch'"><div class="fetch-state"><span class="market-monogram" :style="failedItem ? identity(failedItem.manifestId, fetchingName).style : {}">{{ failedItem ? identity(failedItem.manifestId, fetchingName).label : '↓' }}</span><h3>{{ fetchingName }}</h3><div v-if="busy" class="fetch-spinner" aria-label="下载进行中"></div><p role="status" aria-live="polite">{{ error ? '没有安装或替换任何音源。请重试或切换线路。' : fetchMessage }}</p></div><template v-if="!busy"><h4>下载线路</h4><CatalogLineChoices :value="catalogState.line" :lines="repositoryLines" @change="changeLine" /><button class="btn btn-primary btn-block" @click="retryDownload">重试获取</button></template><button class="btn btn-ghost btn-block mt10" @click="close">{{ busy ? '取消获取' : '返回市场' }}</button><p class="market-caption">优先使用仓库原始线路，连接失败会尝试仓库 Pages；CDN 仅在你主动选择后使用。</p></template>
    <template v-else-if="dialog === 'import'"><p class="market-caption">URL 在线导入继续保留。需要插件文件直链，不是网页或 MusicFree 订阅清单。</p><label class="market-field">插件文件地址<input v-model="inputUrl" inputmode="url" placeholder="https://example.com/plugin.js" aria-label="插件文件地址" /></label><label v-if="/^http:\/\//i.test(inputUrl)" class="market-consent"><input v-model="allowHttp" type="checkbox" />我理解 HTTP 链接没有加密，仍要获取。</label><button class="btn btn-primary btn-block" :disabled="!!busy || !inputUrl.trim()" @click="getUrl">{{ busy === 'fetch' ? '读取中…' : '读取插件信息' }}</button><button class="btn btn-ghost btn-block mt10" :disabled="!!busy" @click="fileInput?.click()"><Icon name="folder" :size="14" />从本地文件安装</button></template>
    <template v-else-if="dialog === 'detail' && detail">
      <div class="market-detail-title"><span class="market-monogram" :style="identity(detail.manifestId, detail.name).style">{{ identity(detail.manifestId, detail.name).label }}</span><div><h3>{{ detail.name }}</h3><p>{{ detail.author || '作者未注明' }} · 社区音源</p></div></div>
      <div class="detail-stats"><div><strong>v{{ detail.version }}</strong><small>清单版本</small></div><div><strong>{{ detail.format === 'lx' ? 'LX' : 'Ceru v2' }}</strong><small>插件格式</small></div><div><strong>未检测</strong><small>播放状态</small></div></div>
      <h4>这个音源能做什么</h4><p class="detail-description">{{ detail.description || '此目录没有额外说明；实际能力将在读取文件后核对。' }}</p>
      <h4>平台与能力声明</h4><div class="detail-chips"><span v-for="p in detailManifest?.contributes?.providers || []" :key="p.id">{{ p.name || p.id }}</span><span v-for="c in detailCapabilities" :key="c">{{ capabilityName(c) }}</span></div><p class="market-caption">{{ detailManifest ? '来自随包文件声明快照，安装时再次核对实际文件；声明不等于播放验证。' : detail.format === 'lx' ? '单个插件提供多个平台，成功启用后显示运行时注册结果。' : '详细能力待读取文件，不根据名称猜测。' }}</p>
      <h4>安装前确认</h4><div class="detail-trust"><Icon name="plugin" :size="23" /><div><strong>你的确认，是安装的最后一步</strong><p>先获取文件，再显示实际权限和访问范围。未经你确认，不执行或启用第三方音源。</p></div></div>
      <h4>来源信息</h4><dl class="detail-source"><div><dt>仓库维护者</dt><dd>hebijunge</dd></div><div><dt>文件作者</dt><dd>{{ detail.author || '未注明' }}</dd></div><div><dt>安装状态</dt><dd>{{ installedFor(detail) ? '已安装' : '未安装' }}</dd></div></dl><details><summary>查看文件链接</summary><code class="market-url">{{ detail.url }}</code><button class="btn btn-ghost" @click="copyLink(detail.url)">复制文件链接</button></details>
      <div class="detail-sticky"><button class="btn btn-primary btn-block" :disabled="!!busy" @click="installedFor(detail) ? (tab = 'installed', close()) : getItem(detail)"><Icon name="download" :size="18" />{{ installedFor(detail) ? '查看已安装音源' : '获取并准备安装' }}</button><p class="market-caption">社区提供，不代表平台官方；可用性以实际运行为准</p></div>
    </template>
    <template v-else-if="dialog === 'install' && pending"><div class="market-detail-title"><span class="market-monogram" :style="identity(pending.manifest.id, pending.manifest.name).style">{{ identity(pending.manifest.id, pending.manifest.name).label }}</span><div><h3>{{ pending.manifest.name }}</h3><p>v{{ pending.manifest.version }} · {{ pending.manifest.author || '作者未注明' }} · {{ pending.manifest.format === 'lx' ? 'LX' : 'Ceru v2' }}</p></div></div><p v-if="pendingExisting" class="market-warning">此 ID 已安装，将更新同一个插件，不增加重复卡片。</p><p v-if="pending.update?.permissionsChanged" class="market-warning">这次更新新增或扩大了权限，请重新确认。</p><p v-if="pending.update?.removedProviders.length" class="market-warning">这次更新移除平台：{{ pending.update.removedProviders.join('、') }}</p><p class="market-caption">{{ pending.manifest.description }}</p><h4>平台声明</h4><div class="installed-platforms"><span v-for="p in pendingPlatforms" :key="p.id">{{ p.name || p.id }}</span></div><p v-if="!pendingPlatforms.length" class="market-caption">平台将在启用后由运行时注册；不伪造平台数量。</p><h4>实际权限清单</h4><div v-for="p in permissions" :key="p.key" class="market-permission"><strong>{{ permissionName(p) }}</strong><p>{{ p.reason || '未说明用途' }}</p><pre v-if="p.scope && Object.keys(p.scope).length">{{ JSON.stringify(p.scope, null, 2) }}</pre></div><p v-if="!permissions.length" class="market-caption">没有声明额外权限。</p><code v-if="pending.sourceUrl" class="market-url">{{ pending.sourceUrl }}</code><label class="market-consent"><input v-model="accepted" type="checkbox" aria-label="确认插件来源与权限" />我已核对来源，并同意上面显示的实际权限。社区插件不代表平台官方认证。</label><button class="btn btn-primary btn-block" :disabled="!accepted || !!busy" @click="confirmInstall">{{ busy === 'install' ? '安装中…' : pending.update || pendingExisting ? '确认更新' : '安装并启用' }}</button><div class="market-batch-actions"><button v-if="batch.length" class="btn btn-ghost" :disabled="!!busy" @click="skipBatch">跳过这一项</button><span v-if="batch.length" class="market-caption">还剩 {{ batch.length }} 个候选，逐项确认</span><button class="btn btn-ghost" :disabled="busy === 'install'" @click="close">取消未完成项</button></div></template>
    <template v-else-if="dialog === 'sources'"><div class="scope-summary"><strong>多选搜索来源</strong><p>已选择 {{ selectedSources.length }} 个。插件可以同时启用；这里勾选的是参与搜索的平台。默认来源用于歌词 / 歌单等单来源操作，播放始终跟随歌曲所属来源。</p></div><div class="market-search"><Icon name="search" :size="16" /><input v-model="providerQuery" aria-label="搜索平台来源" placeholder="搜索平台或所属插件" /></div><div v-for="group in platformGroups.filter(g=>(g.name+g.members.map(m=>m.plugin.name).join(' ')).toLowerCase().includes(providerQuery.toLowerCase()))" :key="group.id" class="provider-group"><h3>{{ group.name }}<small>{{ group.members.length }} 个来源</small></h3><button v-for="member in group.members" :key="sourceKey(member.provider)" class="provider-option" :class="{selected:selectedSources.includes(sourceKey(member.provider))}" role="checkbox" :aria-checked="selectedSources.includes(sourceKey(member.provider))" :disabled="!member.plugin.running" :data-provider="member.provider.providerId" :data-provider-owner="member.plugin.manifestId" @click="toggleSource(member.provider)"><span class="market-monogram" :style="providerIdentity(member.provider).style">{{ providerIdentity(member.provider).label }}</span><span><strong>{{ member.plugin.name }}</strong><small>{{ member.plugin.format==='lx'?'LX 中的 '+group.name:'独立 '+group.name+' 插件' }} · {{ member.plugin.running?'已运行':'已停用' }}</small></span><span v-if="selectedProvider&&sourceKey(selectedProvider)===sourceKey(member.provider)" class="format-badge">默认</span><Icon v-if="selectedSources.includes(sourceKey(member.provider))" name="check" :size="17" /></button></div><p class="market-caption">可同时勾选多个平台、多个插件；取消勾选不会停用或卸载插件。最后勾选的一项作为默认来源。</p><p class="scope-footer">已勾选 {{ selectedSources.length }} 个搜索来源</p><button class="btn btn-primary btn-block" :disabled="!selectedSources.length || !!busy" @click="applySource">使用所选平台</button><button class="btn btn-ghost btn-block mt10" :disabled="!selectedProvider || !!busy" @click="health = ''; open('health')">检测所选平台搜索</button></template>
    <template v-else-if="dialog === 'source' && selectedPlugin"><h3>{{ selectedPlugin.name }} v{{ selectedPlugin.version }}</h3><p>{{ originName(selectedPlugin) }}</p><h4>导入地址</h4><code class="market-url">{{ selectedPlugin.sourceUrl || '本地文件 / 历史来源未记录' }}</code><h4>文件内容摘要</h4><code class="market-url">{{ selectedPlugin.artifactSha256 || '旧记录未保存摘要' }}</code><p class="market-caption">摘要用于识别内容，不代表已经通过第三方安全审计。</p><label class="market-field">更新文件地址<input v-model="updateUrl" inputmode="url" placeholder="同一插件的 .js 文件直链" aria-label="更新文件地址" /></label><button class="btn btn-primary btn-block" :disabled="!!busy || !updateUrl.trim()" @click="bindUpdateUrl">核对 ID 并保存更新地址</button></template>
    <template v-else-if="dialog === 'config' && selectedPlugin"><h3>{{ selectedPlugin.name }}</h3><label v-for="(value, key) in configValues" :key="key" class="market-config"><span>{{ selectedPlugin.configSchema.find((x: any) => x.key === key)?.label || key }}</span><input v-if="typeof value === 'boolean'" v-model="configValues[key]" type="checkbox" /><input v-else-if="typeof value === 'number'" v-model.number="configValues[key]" type="number" /><pre v-else-if="value && typeof value === 'object'" class="market-url">{{ JSON.stringify(value, null, 2) }}</pre><input v-else v-model="configValues[key]" :type="/token|password|cookie/i.test(String(key)) ? 'password' : 'text'" /></label><button class="btn btn-primary btn-block mt14" @click="saveConfig">保存配置</button></template>
          <template v-else-if="dialog === 'repo'"><h3>hebijunge / musicfree-plugins</h3><p class="market-caption">原生清单与 LX 脚本分开。MusicFree 订阅清单不提供直接安装，镜像是线路而不是新的仓库。</p><h4>下载线路</h4><CatalogLineChoices :value="catalogState.line" :lines="repositoryLines" @change="changeLine" /><p>{{ catalogState.loading ? '正在刷新目录…' : catalogState.error || '保留最近一次有效目录，不影响已安装插件' }}</p><label class="market-config"><span>启动时自动更新已安装的音源</span><input type="checkbox" :checked="settingsState.pluginAutoUpdate" @change="updateSettings({ pluginAutoUpdate: ($event.target as HTMLInputElement).checked })" /></label><p class="market-caption">有更新地址且已启用的音源会自动安装安全更新；权限扩大或平台减少时仍需你确认。本地文件需先在来源详情绑定更新地址。</p><p class="market-caption">本版内置了该仓库当前混淆声明的兼容快照。未知的新混淆版本会被安全拒绝，而不是执行脚本来猜权限；标准澜音 / LX 文件仍可正常导入。</p></template>
    <template v-else-if="dialog === 'scene'"><h3>{{ scene }}</h3><p class="market-caption">选择需要的插件。已经安装的跳过，每项会在读取真实文件后单独确认权限。</p><label v-for="p in sceneItems" :key="p.key" class="market-scene-item" :class="{selected:sceneSelected.includes(p.key),installed:!!installedFor(p)}"><span class="market-monogram" :style="identity(p.manifestId,p.name).style">{{ identity(p.manifestId,p.name).label }}</span><span class="scene-item-copy"><strong>{{ p.name }}</strong><small>v{{ p.version }} · {{ p.format === 'lx' ? 'LX 多平台' : 'Ceru v2' }}</small></span><span v-if="installedFor(p)" class="scene-installed">已安装</span><input v-else v-model="sceneSelected" type="checkbox" :value="p.key" :aria-label="'选择 '+p.name" /></label><p v-for="(r, i) in batchResults" :key="i" class="market-caption">{{ r.name }}：{{ r.status }}</p><div class="scene-actions"><p>已选 {{ sceneSelected.length }} 个 · 安装前逐项确认权限</p><button class="btn btn-primary btn-block" :disabled="!!busy || !sceneSelected.length" @click="startBatch">准备所选插件</button><button v-if="batch.length" class="btn btn-ghost btn-block" @click="nextBatch">继续下一项</button></div></template>
    <template v-else-if="dialog === 'health'"><p>{{ (selectedProvider || current)?.name }} · {{ (selectedProvider || current)?.pluginName }}</p><label class="market-field">检测搜索词<input v-model="healthQuery" aria-label="检测搜索词" /></label><button class="btn btn-primary btn-block" :disabled="!!busy" @click="testSearch">{{ busy === 'health' ? '检测中…' : '只检测搜索，不自动播放或下载' }}</button><p v-if="health" class="notice">{{ health }}</p><p class="market-caption">这是当前平台的单次搜索结果，不保证所有歌曲可播，不把失败推广成整个仓库失效。</p></template>
  </section></div></Transition></Teleport></div>
</template>

<style scoped>
.installed-view-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:4px;background:var(--surface-2);border-radius:12px;margin:12px 0 16px}.installed-view-tabs button{display:flex;align-items:center;justify-content:center;min-width:0;min-height:44px;margin:0;padding:10px 12px;background:none;border:0;font:inherit;font-size:13px;line-height:20px;letter-spacing:normal;white-space:nowrap;text-align:center;color:var(--ink-3);border-radius:9px}.installed-view-tabs button:focus-visible{outline:2px solid var(--brand-strong);outline-offset:-2px}.installed-view-tabs .active{background:var(--surface);color:var(--brand-strong);font-weight:650;box-shadow:0 2px 7px #00008}.platform-card{border:1px solid var(--line);border-radius:18px;padding:16px;margin:12px 0;background:var(--surface)}.platform-card header{display:flex;gap:11px;align-items:center;padding-bottom:13px;border-bottom:1px solid var(--line)}.platform-card h3{font-size:17px;margin:0}.platform-card header p{font-size:11px;color:var(--ink-3);margin:6px 0 0}.platform-member{display:flex;gap:10px;align-items:center;padding:14px 0}.member-info{flex:1;min-width:0}.member-info strong{display:block;font-size:14px}.member-info small{display:block;font-size:10px;color:var(--ink-3);line-height:1.8;margin:5px 0}.member-selected{font-size:10px;color:var(--brand-strong);margin-left:7px}.platform-member-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap;border-top:1px solid var(--line);font-size:11px;padding-top:6px}.platform-member-actions small{color:var(--ink-3);margin-right:auto}.platform-member-actions button{min-height:44px;border:0;background:none;color:var(--ink-2);font:inherit;padding:6px}

.scope-footer{font-size:13px;color:var(--brand-strong);font-weight:650;margin:15px 0 10px}.scope-summary{background:var(--tint-soft);border-radius:15px;padding:15px}.scope-summary strong{font-size:17px}.scope-summary p{font-size:12px;color:var(--ink-3);margin:8px 0 0}

.market-page{font-size:15px}.market-page .ttl{font-size:22px;text-align:left}.market-info{margin:8px 0;font-size:13px}.market-search{height:48px;display:flex;align-items:center;gap:10px;background:var(--porcelain-2);padding:0 15px;border-radius:14px;margin:12px 0}.market-search input{min-width:0;flex:1;border:0;background:none;outline:none;font:inherit;color:var(--ink)}
.market-tabs{display:flex;gap:28px;border-bottom:1px solid var(--line);margin-bottom:20px}.market-tabs button{background:none;border:0;color:var(--ink-3);min-height:50px;font:inherit;padding:0 0 10px;position:relative}.market-tabs .active{color:var(--brand-strong,var(--tint));font-weight:650}.market-tabs .active:after{content:'';height:3px;position:absolute;bottom:0;left:0;right:0;background:var(--brand-strong,var(--tint));border-radius:3px}
.market-hero{padding:23px 20px;background:var(--c800);border-radius:22px;color:var(--ink-inv);position:relative;overflow:hidden;min-height:164px}.market-hero .eb{position:relative;font-size:9px;letter-spacing:2px;opacity:.75}.market-hero h2{position:relative;font-size:26px;font-weight:700;line-height:1.45;margin:12px 0 8px}.market-hero p{position:relative;font-size:12px;opacity:.75;margin:0}.hero-orbits{position:absolute;width:155px;height:150px;right:-16px;top:5px;pointer-events:none}.hero-orbits i{position:absolute;width:190px;height:190px;border:1px solid var(--c500);border-radius:50%;opacity:.55;top:3px;left:-6px}.hero-orbits i+i{width:130px;height:130px;top:33px;left:24px}.hero-token{position:absolute;display:grid;place-items:center;width:42px;height:42px;border-radius:13px;font:700 23px/1 sans-serif;box-shadow:0 6px 14px #0002}.hero-token.q{background:#12b596;left:10px;top:86px}.hero-token.kw{background:#e2b224;right:29px;top:21px;font-size:16px}.hero-token.cloud{background:#e75e73;right:26px;bottom:4px}
.market-categories{display:flex;gap:8px;overflow-x:auto;margin:12px 0;scrollbar-width:none}.market-categories button{flex:none;border:0;background:var(--porcelain-2);color:var(--ink-3);border-radius:24px;padding:9px 13px;min-height:44px;font-size:13px}.market-categories .active{background:var(--tint-soft);color:var(--brand-strong,var(--tint));font-weight:650}.market-section{display:flex;justify-content:space-between;gap:8px;align-items:center;margin:19px 0 10px}.market-section h3{margin:0;font-size:18px}.market-section button{font-size:12px;color:var(--ink-3);border:0;background:none;min-height:44px;display:flex;align-items:center;gap:4px}.market-section small{font-size:11px;color:var(--ink-3);font-weight:400;margin-left:5px}.market-caption{font-size:12px;line-height:1.8;color:var(--ink-3);overflow-wrap:anywhere}.catalog-sync{font-size:11px;margin:0 0 12px}.market-warning{color:var(--cinnabar);background:var(--surface-2);border-radius:10px;padding:12px;font-size:13px;line-height:1.8;overflow-wrap:anywhere}
.market-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0 22px}.catalog-card{border:1px solid var(--line-2);border-radius:18px;padding:14px;min-width:0;background:var(--surface)}.catalog-card-head{display:flex;gap:9px;text-align:left;padding:0;border:0;background:none;align-items:center;width:100%;min-height:48px;color:var(--ink)}.catalog-card-head>span:last-child{min-width:0}.catalog-card-head strong{font-size:14px;font-weight:650;display:block;overflow-wrap:anywhere;line-height:1.45}.catalog-card-head small{font-size:11px;color:var(--ink-3);display:block;margin-top:4px}.market-monogram{display:inline-flex;width:42px;height:42px;align-items:center;justify-content:center;background:var(--tint-soft);color:var(--brand-strong,var(--tint));border-radius:13px;flex:none;font:700 22px/1 sans-serif;letter-spacing:-1px}.catalog-card p{font-size:11px;line-height:1.7;color:var(--ink-3);margin:14px 0;min-height:36px}.catalog-foot{display:flex;justify-content:space-between;align-items:center;gap:5px}.format-badge{background:var(--tint-soft);color:var(--brand-strong,var(--tint));padding:5px 7px;border-radius:7px;font-size:10px;white-space:nowrap}.catalog-foot button{border:0;background:var(--tint-soft);color:var(--brand-strong,var(--tint));border-radius:22px;padding:8px 13px;min-height:44px;font-size:13px;font-weight:600}.market-scenes{display:flex;flex-direction:column;gap:10px}.market-scenes button{position:relative;text-align:left;padding:18px;background:var(--surface-2);border:1px solid var(--line);border-radius:16px;font-size:16px;color:var(--ink);min-height:82px}.market-scenes small{display:block;font-size:12px;color:var(--ink-3);margin-top:7px}.market-scenes .i{position:absolute;right:16px;top:30px}
.market-current{display:flex;align-items:center;gap:12px;padding:18px;background:var(--tint-soft);border-radius:18px;margin:16px 0 20px}.market-current>div{flex:1;min-width:0}.market-current strong{font-size:16px;display:block}.market-current small{font-size:12px;color:var(--ink-3);display:block;margin-top:6px}.market-current button{border:0;background:none;color:var(--brand-strong,var(--tint));min-height:44px;font-size:13px}.installed-card{border:1px solid var(--line-2);border-radius:19px;padding:17px;margin:14px 0;background:var(--surface)}.installed-head{display:flex;align-items:center;gap:10px}.installed-head>div{min-width:0;flex:1}.installed-head strong{font-size:16px;display:block;overflow-wrap:anywhere}.installed-head small{font-size:11px;color:var(--ink-3);display:block;margin-top:6px}.status-badge{font-size:11px;color:var(--brand-strong,var(--tint));white-space:nowrap}.status-badge.failed{color:var(--cinnabar)}.installed-head .switch{flex:none}.installed-platforms{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.installed-platforms button,.installed-platforms span{font-size:13px;min-height:44px;display:flex;align-items:center;padding:9px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);color:var(--ink-2)}.installed-platforms .active{background:var(--tint-soft);color:var(--brand-strong,var(--tint));border-color:var(--tint)}.installed-actions{display:flex;gap:4px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:9px;margin-top:13px}.installed-actions button{font-size:12px;color:var(--ink-3);border:0;background:none;padding:7px 9px;min-height:44px}
.market-overlay{position:fixed;inset:0;z-index:1100;display:flex;align-items:flex-end;justify-content:center;animation:none!important;transition:opacity .2s}.market-overlay>.scrim{position:absolute;z-index:0;inset:0;background:#0006}.market-panel{position:relative;z-index:1;width:min(100%,540px);max-height:calc(100vh - 28px);max-height:calc(100dvh - 28px);overflow-y:auto;overscroll-behavior:contain;background:var(--surface);border-radius:24px 24px 0 0;padding:20px 22px calc(18px + env(safe-area-inset-bottom));color:var(--ink);font-size:15px;box-shadow:0 -10px 35px #0002;transition:transform .2s}.market-panel .btn-primary{background:var(--brand-strong,var(--tint));color:var(--surface);min-height:50px;font-size:15px;border-radius:14px}.market-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px}.market-dialog-head h2{font-size:21px;margin:0}.market-panel p{line-height:1.85;overflow-wrap:anywhere}.market-panel h3{font-size:20px;margin:17px 0 10px}.market-panel h4{font-weight:650;font-size:17px;margin:25px 0 13px}.market-field{display:block;font-size:13px;margin:18px 0;color:var(--ink-2)}.market-field input,.market-field select,.market-config input:not([type=checkbox]){display:block;width:100%;min-height:48px;border:1px solid var(--line-2);border-radius:12px;padding:12px;margin-top:9px;background:var(--surface-2);color:var(--ink);font:inherit}.market-url{display:block;font:11px/1.85 var(--mono);overflow-wrap:anywhere;white-space:pre-wrap;background:var(--surface-2);padding:14px;border-radius:11px;color:var(--ink-3);margin:12px 0}.market-detail-title{display:flex;gap:17px;align-items:center;margin:24px 0}.market-detail-title .market-monogram{width:70px;height:70px;font-size:32px;border-radius:21px;box-shadow:0 12px 26px #0001}.market-detail-title h3{margin:0;font-size:25px;overflow-wrap:anywhere}.market-detail-title p{font-size:13px;color:var(--ink-3);margin:8px 0 0}.market-permission{border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}.market-permission strong{font-size:15px}.market-permission p{font-size:12px;color:var(--ink-3);margin:8px 0}.market-permission pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;margin:9px 0}.market-consent{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.9;color:var(--ink-3);margin:20px 0;min-height:44px}.market-consent input{flex:none;width:20px;height:20px;accent-color:var(--tint);margin:3px 0}.market-batch-actions{display:flex;align-items:center;justify-content:space-between;gap:5px;flex-wrap:wrap}
.provider-group h3{display:flex;align-items:center;justify-content:space-between;font-size:16px;margin:25px 0 12px}.provider-group h3 small{font-size:12px;color:var(--ink-3);font-weight:400}.provider-option{display:flex;align-items:center;gap:12px;text-align:left;padding:14px 10px;width:100%;background:none;border:0;border-bottom:1px solid var(--line);color:var(--ink);min-height:75px}.provider-option>span:nth-child(2){flex:1;min-width:0}.provider-option strong{font-size:16px;display:block}.provider-option small{font-size:12px;color:var(--ink-3);display:block;margin-top:6px}.provider-option.selected{color:var(--brand-strong,var(--tint));background:var(--tint-soft);border-radius:12px}.market-config{display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:15px 0;font-size:14px}.market-config input[type=checkbox]{width:22px;height:22px;accent-color:var(--tint);flex:none}.market-config input:not([type=checkbox]){width:55%;margin:0}.market-scene-item{display:flex;gap:11px;align-items:center;min-height:70px;border:1px solid var(--line);border-radius:14px;padding:12px;margin:9px 0;cursor:pointer}.market-scene-item.selected{border-color:var(--tint);background:var(--tint-softer)}.market-scene-item.installed{background:var(--surface-2);cursor:default}.market-scene-item .market-monogram{width:38px;height:38px;font-size:18px;border-radius:11px}.scene-item-copy{flex:1;min-width:0}.market-scene-item strong{display:block;font-size:14px;line-height:1.5}.market-scene-item small{display:block;font-size:11px;color:var(--ink-3);margin-top:3px}.market-scene-item input{appearance:none;-webkit-appearance:none;width:22px;height:22px;flex:none;border:1.5px solid var(--line-2);border-radius:6px;background:var(--surface);position:relative;margin:0}.market-scene-item input:checked{background:var(--brand-strong);border-color:var(--brand-strong)}.market-scene-item input:checked:after{content:'';position:absolute;width:6px;height:10px;border:solid var(--surface);border-width:0 2px 2px 0;left:6px;top:3px;transform:rotate(45deg)}.market-scene-item input:focus-visible{outline:2px solid var(--brand-strong);outline-offset:3px}.scene-installed{font-size:10px;padding:5px 7px;color:var(--ink-3);background:var(--surface);border-radius:6px;white-space:nowrap}.scene-actions{position:sticky;bottom:0;background:var(--surface);padding:10px 0 4px;border-top:1px solid var(--line);margin-top:14px}.scene-actions p{font-size:11px;color:var(--ink-3);margin:0 0 8px}
.market-full .market-panel{height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;border-radius:0;padding-top:calc(20px + env(safe-area-inset-top));padding-bottom:calc(20px + env(safe-area-inset-bottom))}.detail-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:20px 0;margin:25px 0}.detail-stats>div{text-align:center;border-right:1px solid var(--line)}.detail-stats>div:last-child{border:0}.detail-stats strong{display:block;font-size:16px}.detail-stats small{display:block;color:var(--ink-3);font-size:12px;margin-top:7px}.detail-description{color:var(--ink-2)}.detail-chips{display:flex;flex-wrap:wrap;gap:9px}.detail-chips span{font-size:13px;padding:10px 12px;border:1px solid var(--line-2);border-radius:11px}.detail-trust{display:flex;gap:12px;background:var(--surface-2);padding:18px;border-radius:18px;color:var(--brand-strong,var(--tint))}.detail-trust .i{flex:none;margin-top:2px}.detail-trust strong{color:var(--ink);font-size:15px}.detail-trust p{color:var(--ink-3);font-size:12px;margin:9px 0 0}.detail-source{font-size:13px}.detail-source div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:14px 0}.detail-source dt{color:var(--ink-3)}.detail-source dd{margin:0;text-align:right;overflow-wrap:anywhere}.detail-sticky{position:sticky;bottom:calc(-20px - env(safe-area-inset-bottom));background:var(--surface);padding:16px 0 calc(4px + env(safe-area-inset-bottom));margin-top:22px;box-shadow:0 -12px 20px var(--surface)}.detail-sticky p{text-align:center;font-size:11px;margin:9px 0}.market-panel summary{font-size:13px;color:var(--ink-3);min-height:44px;cursor:pointer;padding:12px 0}.fetch-state{text-align:center;padding:12px 0}.fetch-state .market-monogram{width:64px;height:64px;font-size:29px}.fetch-state p{font-size:14px;color:var(--ink-3)}.fetch-spinner{width:28px;height:28px;border:3px solid var(--line-2);border-top-color:var(--tint);border-radius:50%;margin:16px auto;animation:fetch-spin 1s linear infinite}@keyframes fetch-spin{to{transform:rotate(360deg)}}
.market-sheet-enter-from,.market-sheet-leave-to{opacity:0}.market-sheet-enter-from .market-panel,.market-sheet-leave-to .market-panel{transform:translateY(24px)}button:disabled{opacity:.5;cursor:not-allowed}@media(min-width:700px){.market-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.market-overlay{align-items:center}.market-panel,.market-full .market-panel{border-radius:22px;max-height:90vh;max-height:90dvh;height:auto}.market-hero h2{font-size:30px}.hero-orbits{right:20px}}@media(max-width:370px){.catalog-card{padding:11px}.catalog-card-head{gap:7px}.catalog-card .market-monogram{width:36px;height:36px}.catalog-card-head strong{font-size:13px}.installed-card{padding:13px}.status-badge{font-size:10px}}@media(prefers-reduced-motion:reduce){.market-overlay,.market-panel{transition:none!important}.fetch-spinner{animation:none!important}}input:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid var(--tint);outline-offset:3px}

/* Content density mirrors the selected original store prototype. */
.market-search{height:44px;margin:9px 0 5px;border-radius:12px}.market-tabs{min-height:46px;margin-bottom:16px;gap:24px}.market-tabs button{min-height:46px;font-size:14px;padding-bottom:8px}.market-hero{min-height:0;height:132px;padding:17px 18px;border-radius:18px}.market-hero .eb{font-size:8px;letter-spacing:1.8px}.market-hero h2{font-size:23px;line-height:1.28;margin:7px 0 4px;letter-spacing:-.5px}.market-hero p{font-size:11px}.hero-orbits{width:140px;height:124px;right:-5px;top:0}.hero-orbits i{width:165px;height:165px;top:-18px;left:0}.hero-orbits i+i{width:116px;height:116px;top:8px;left:24px}.hero-token{width:37px;height:37px;border-radius:12px;font-size:21px}.hero-token.q{left:6px;top:51px}.hero-token.kw{right:27px;top:9px;font-size:14px}.hero-token.cloud{right:14px;bottom:5px}.market-categories{margin:10px 0 7px;gap:7px}.market-categories button{font-size:12px;padding:7px 12px;min-height:44px}.market-section{margin:12px 0 8px;min-height:30px}.market-section h3{font-size:16px}.market-section button{font-size:11px;min-height:44px}.market-grid{gap:11px;margin:6px 0 13px}.catalog-card{padding:12px 11px;border-radius:15px;border-color:var(--line);box-shadow:0 1px 2px #10251a03}.catalog-card-head{gap:8px;min-height:43px}.catalog-card-head strong{font-size:13px;letter-spacing:-.3px}.catalog-card-head small{font-size:10px;margin-top:3px}.catalog-card .market-monogram{width:38px;height:38px;border-radius:11px;font-size:20px}.catalog-card p{font-size:10px;margin:9px 0 7px;min-height:18px;line-height:18px}.catalog-foot button{font-size:12px;padding:7px 12px;min-height:44px}.catalog-foot .format-badge{font-size:9px;padding:5px 6px}.catalog-sync{margin:8px 0;color:var(--ink-4);font-size:10px}.market-current{padding:15px 14px;border-radius:16px;margin:12px 0 14px}.market-current strong{font-size:15px}.market-current small{font-size:11px}.installed-card{padding:15px;border-color:var(--line);border-radius:17px;margin:12px 0}.installed-head strong{font-size:15px}.installed-head small{font-size:10px}.source-pill{display:inline-flex;align-items:center;gap:4px;border:0;background:var(--surface-2);border-radius:5px;font-size:10px;color:var(--ink-3);padding:4px 6px;margin-top:5px;min-height:28px}.installed-platforms{gap:7px;margin:10px 0}.installed-platforms button{font-size:12px;border-radius:9px;padding:7px 10px}.installed-actions{padding-top:6px;margin-top:9px;justify-content:space-between}.installed-actions button{font-size:11px;padding:7px 6px}.market-detail-title{margin:23px 0 21px}.market-detail-title h3{font-weight:650;letter-spacing:-.5px}.market-panel h4{font-size:16px;font-weight:650;margin-top:23px}.detail-chips span{font-size:12px;padding:10px 12px}.detail-trust{padding:17px;border-radius:15px}.detail-trust strong{font-size:14px}.detail-source{font-size:12px}.detail-sticky .btn-primary{font-weight:650;border-radius:12px}.scope-summary{padding:14px}.provider-group h3{font-size:15px}.provider-option{padding:12px 9px}.provider-option strong{font-size:15px}.provider-option small{font-size:11px}.provider-option.selected{border:1px solid var(--tint);background:var(--tint-soft);margin-top:6px;border-radius:12px}.provider-option.selected+.provider-option{margin-top:5px}
@media(max-width:370px){.catalog-card-head strong{font-size:12px}.catalog-card .market-monogram{width:35px;height:35px}.catalog-card{padding:11px 9px}.market-hero h2{font-size:21px}}@media(min-width:700px){.market-hero{height:150px}.market-hero h2{font-size:26px}.hero-orbits{right:25px;top:10px}}
@media(min-width:768px){
  .market-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .market-overlay{align-items:center;padding:24px}
  .market-panel,.market-full .market-panel{width:min(100%,760px);height:auto;max-height:calc(100vh - 48px);max-height:calc(100dvh - 48px);border-radius:24px;padding:22px 26px}
}
</style>
