<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AccountSummary } from '@shiqianjiang/ceru-plugin-sdk'
import Icon from '@/components/Icon.vue'
import ImportPlaylistSheet from '@/components/ImportPlaylistSheet.vue'
import PluginAccountSurface from '@/components/PluginAccountSurface.vue'
import { authState, displayName, login, logout } from '@/core/auth'
import { cloudState } from '@/core/cloud'
import { pluginState, pluginAccountSummary, logoutPluginAccount, getPluginAccountSurface, invalidatePluginAccountCache } from '@/core/plugin/manager'
import { secureStore } from '@/core/native/secureStore'
import type { AccountSurfaceSpec } from '@/core/plugin/accountSurface'
import { confirmAction } from '@/core/confirm'
const router = useRouter(), selected = ref('ceru'), error = ref(''), showImport = ref(false), surface = ref<AccountSurfaceSpec>(), busy = ref('')
const secureMessage = ref('')
const summaries = ref<Record<string, AccountSummary>>({}), failures = ref<Record<string, string>>({})
const defaults = [{id:'ceru',name:'澜音'}, {id:'tx',name:'QQ音乐'}, {id:'kg',name:'酷狗音乐'}, {id:'kw',name:'酷我音乐'}, {id:'wy',name:'网易云音乐'}, {id:'mg',name:'咪咕音乐'}, {id:'qs',name:'汽水音乐'}]
const platforms = computed(() => [...defaults, ...pluginState.plugins.flatMap(p => p.providers).filter(p => !defaults.some(d => d.id === p.id) && !['mix','local','demo'].includes(p.id)).filter((p,i,a) => a.findIndex(v => v.id === p.id) === i).map(p => ({id:p.id,name:p.name}))])
const owners = computed(() => pluginState.plugins.filter(p => p.providers.some(v => v.id === selected.value)))
const entries = computed(() => pluginState.plugins.filter(p => p.enabled && p.running).flatMap(p => p.accountItems.map(item => ({...item,pluginId:p.pluginId,pluginName:p.name,key:JSON.stringify([p.pluginId,item.id]),compatible:p.surfaces.some(s => s.id === item.view && ['native','web'].includes(s.kind))}))))
const displayed = computed(() => selected.value === 'ceru' ? entries.value : entries.value.filter(e => owners.value.some(p => p.pluginId === e.pluginId)))
const revisions = new Map<string,number>(); let disposed = false
async function refresh(): Promise<void> {
  const active = new Set(entries.value.map(e=>e.key))
  summaries.value = Object.fromEntries(Object.entries(summaries.value).filter(([key])=>active.has(key)))
  for (const item of entries.value) {
    const revision=(revisions.get(item.key)||0)+1; revisions.set(item.key,revision)
    try { const value=await pluginAccountSummary(item.pluginId,item.id); if(disposed || revisions.get(item.key)!==revision || !entries.value.some(e=>e.key===item.key)) continue; summaries.value={...summaries.value,[item.key]:value}; const next={...failures.value}; delete next[item.key]; failures.value=next }
    catch { if(!disposed && revisions.get(item.key)===revision) failures.value={...failures.value,[item.key]:'账号状态读取失败，请检查音源与权限'} }
  }
}
async function ceruLogin(): Promise<void> { error.value=''; try{await login()}catch{error.value='澜音登录页打开失败，请检查网络'} }
async function ceruLogout(): Promise<void> {
  if(!await confirmAction({title:'退出澜音账号？',body:'仅退出本机澜音账号，不影响平台账号、本地歌单或下载。',confirmText:'退出',danger:true})) return
  logout(); cloudState.playlists=[]; cloudState.error=''
}
function open(item:any):void { error.value=''; try{surface.value=getPluginAccountSurface(item.pluginId,item.id)}catch(e:any){error.value=e?.message||'音源登录界面未适配'} }
function closeSurface():void { if(surface.value) invalidatePluginAccountCache(surface.value.pluginId); surface.value=undefined; void refresh() }
async function signOut(item:any):Promise<void> {
  if(!await confirmAction({title:`退出${item.title}？`,body:'执行此音源声明的退出动作，保留已导入的本地歌单，不退出澜音账号。',confirmText:'退出',danger:true})) return
  busy.value=item.key; try{summaries.value={...summaries.value,[item.key]:await logoutPluginAccount(item.pluginId,item.id)};await refresh()}catch{error.value='音源退出或状态核验失败，请刷新重试'}finally{busy.value=''}
}
function foreground():void {if(document.visibilityState==='visible') void refresh()}
watch(() => entries.value.map(e=>e.key).join('|'), () => { if(surface.value && !entries.value.some(e=>e.pluginId===surface.value?.pluginId&&e.id===surface.value?.accountId)) surface.value=undefined; void refresh() })
onMounted(()=>{void refresh();void secureStore.status().then(s=>{secureMessage.value=s.persistent?'新平台音源会话在本机使用 Android Keystore 加密保存。':'浏览器中平台音源会话仅在本次页面会话保留，重开需重新登录。'}).catch(()=>{secureMessage.value='安全仓库不可用，请更新 Android 客户端。'});document.addEventListener('visibilitychange',foreground)})
onBeforeUnmount(()=>{disposed=true;revisions.clear();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
  <div class="screen accounts-page"><div class="scroll safe-t accounts-scroll">
    <header class="navrow"><button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="20" /></button><h1>账号与服务</h1><span class="iconbtn" /></header>
    <div class="pad"><p class="account-note">澜音账号、音乐平台账号和同步连接分别管理，可同时存在。</p>
      <nav class="account-platforms" aria-label="选择登录平台"><button v-for="p in platforms" :key="p.id" :aria-pressed="selected===p.id" :class="{on:selected===p.id}" @click="selected=p.id">{{p.name}}</button></nav>
      <p v-if="error" class="account-error" role="alert">{{error}}</p>
      <section v-if="selected==='ceru'" class="account-card ceru-account"><h2>澜音应用账号</h2><p>{{authState.authenticated?displayName():'尚未登录澜音'}}</p><small>连接澜音云歌单，读取并导入到本机；不代表登录 QQ 等音乐平台，也不是双向同步。</small><div class="account-actions"><button v-if="!authState.authenticated" class="btn btn-primary" @click="ceruLogin">登录澜音</button><button v-else class="btn btn-ghost" @click="ceruLogout">退出澜音</button><button class="btn btn-ghost" @click="router.push('/cloud')">澜音云歌单</button></div></section>
      <section v-else class="account-card platform-status"><h2>{{platforms.find(p=>p.id===selected)?.name}}</h2><p v-if="!owners.length">尚未安装此平台的音源。</p><template v-else><p v-for="p in owners" :key="p.pluginId">{{p.name}}：{{!p.enabled||!p.running?'音源停用':p.accountItems.length?'有音源声明的账号入口，请核对其账户类型':'未声明平台账号登录'}}</p></template><small>平台选择不会改变歌曲音源。仅有播放、搜索或分享导入能力，不能据此开放登录或读取本人歌单。</small><div class="account-actions"><button class="btn btn-ghost" @click="router.push('/plugins')">管理音源</button><button class="btn btn-ghost" @click="showImport=true">分享链接／本地文件导入</button></div></section>
      <h2 class="account-section-title">音源声明的账号入口</h2><p class="account-note">以下入口与状态由对应 v2 音源提供，可能是音乐平台账号，也可能是音源授权账号，请以音源说明为准。{{secureMessage}}</p>
      <p v-if="!displayed.length" class="account-empty">当前没有可用账号入口。LX 音源和未声明 accountItems 的音源不能在这里登录平台。</p>
      <section v-for="item in displayed" :key="item.key" class="account-card plugin-account"><h3>{{item.title}}</h3><small>{{item.pluginName}}</small><p>{{failures[item.key] || (summaries[item.key] ? (summaries[item.key].signedIn?'已连接 · ':'未连接 · ')+summaries[item.key].displayName : '账号状态待核验')}}</p><small v-if="!item.compatible">此音源的登录界面类型尚未安全适配。</small><div class="account-actions"><button class="btn btn-primary" :disabled="!item.compatible||busy===item.key" @click="open(item)">{{summaries[item.key]?.signedIn?'管理账号':'打开登录界面'}}</button><button v-if="item.logoutAction && summaries[item.key]?.signedIn" class="btn btn-ghost" :disabled="busy===item.key" @click="signOut(item)">退出此账号</button></div></section>
      <h2 class="account-section-title">同步与本地导入</h2><div class="account-actions"><button class="btn btn-ghost" @click="router.push('/sync-services')">WebDAV 等同步服务</button><button class="btn btn-ghost" @click="showImport=true">导入歌单</button></div>
    </div>
  </div><ImportPlaylistSheet v-if="showImport" @close="showImport=false" /><PluginAccountSurface v-if="surface" :key="surface.pluginId+surface.accountId" :spec="surface" @close="closeSurface" @changed="refresh" /></div>
</template>
<style scoped>
.accounts-scroll{padding-bottom:calc(var(--dock-h) + 32px)}.navrow h1{flex:1;text-align:center;font-size:19px}.account-note,.account-empty{font-size:12px;line-height:1.8;color:var(--ink-3);margin:12px 0}.account-platforms{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.account-platforms button{padding:10px 12px;border-radius:10px;background:var(--porcelain-2);font-size:12px}.account-platforms button.on{background:var(--tint-soft);color:var(--brand-strong)}.account-card{padding:16px;border:1px solid var(--line-2);border-radius:14px;margin:12px 0;background:var(--surface)}.account-card h2,.account-section-title{font-size:17px}.account-card h3{font-size:15px}.account-card p{font-size:13px;line-height:1.8;margin:8px 0}.account-card small{display:block;font-size:11px;line-height:1.8;color:var(--ink-3)}.account-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.account-actions .btn{font-size:12px;white-space:normal;line-height:1.5;min-height:40px;height:auto;padding:10px 12px}.account-section-title{margin:24px 0 10px}.account-error{font-size:12px;color:var(--cinnabar);line-height:1.8}
</style>
