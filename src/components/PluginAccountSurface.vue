<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { assertNativeView, type NativeView } from '@shiqianjiang/ceru-plugin-sdk'
import { createAccountSurfaceDocument, createAccountSurfaceSession, subscribeAccountSurface, type AccountSurfaceSpec } from '@/core/plugin/accountSurface'
import { invokePluginAccountAction } from '@/core/plugin/manager'
import { randomUUID } from '@/shims/crypto'
import { validateRemoteUrl } from '@/core/plugin/network'
const props = defineProps<{ spec: AccountSurfaceSpec }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const generation = randomUUID(), frame = ref<HTMLIFrameElement>(), html = ref(''), loading = ref(true), error = ref(''), view = ref<NativeView>(), busy = ref(false)
const session = createAccountSurfaceSession(props.spec, (action, input, signal) => invokePluginAccountAction(props.spec.pluginId, props.spec.accountId, action, input, signal))
let disposed = false, active = false, init: any, inFlight = 0, rendering = false
const unsubscribe = subscribeAccountSurface(event => {
  if (disposed || event.pluginId !== props.spec.pluginId || event.surfaceId !== props.spec.surface.id) return
  if (event.type === 'close-view') void close()
  else if (event.type === 'state' && active) { if (props.spec.surface.kind === 'native') void render(); else send('state', event.state) }
})
function send(type: string, data: any): void { if (!disposed) { try { frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify({ type, data, generation })), '*') } catch { error.value='登录界面消息不能安全序列化' } } }
function image(entity: any): string {
  const url = entity.metadata?.artworkUrl || entity.playlist?.artworkUrl || ''
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(url) && url.length < 2 * 1024 * 1024) return url
  try { return validateRemoteUrl(url).href } catch { return '/default-cover.png' }
}
async function render(): Promise<void> { if(rendering||disposed) return; rendering=true; try{const value = await session.invoke(props.spec.surface.entry, {}); assertNativeView(value); if (!disposed) view.value = value}catch{if(!disposed) error.value='账号页面更新失败'}finally{rendering=false} }
async function perform(action: string, input: any = {}): Promise<void> {
  if (busy.value || disposed) return
  busy.value = true; error.value = ''
  try { await session.invoke(action, input); if (props.spec.surface.kind === 'native') await render(); emit('changed') }
  catch { if (!disposed) error.value = '音源账号操作失败，请检查登录能力与网络。' }
  finally { busy.value = false }
}
async function close(): Promise<void> {
  if (disposed) return
  send('dispose', {}); disposed = true; unsubscribe(); window.removeEventListener('message', receive)
  try { await session.close() } catch { /* Closed UI must not be kept by a failed plugin cleanup. */ }
  emit('changed'); emit('close')
}
async function receive(event: MessageEvent): Promise<void> {
  if (disposed || event.source !== frame.value?.contentWindow || !event.data || typeof event.data !== 'object') return
  const { type, data, generation: remote } = event.data
  if (type === 'ready') { send('init', init); return }
  if (remote !== generation) return
  if (type === 'active' && !active) { active = true; loading.value = false; try { await session.open() } catch { error.value = '音源登录界面初始化失败' }; return }
  if (type === 'failed') { error.value = '音源登录界面加载失败'; loading.value = false; return }
  if (type === 'close-view') { await close(); return }
  if (type !== 'rpc' || typeof data?.id !== 'string') return
  let size = 0; try { size = JSON.stringify(data).length } catch { size = Infinity }
  if (!active || data.method !== 'surface.invoke' || inFlight >= 32 || size > 128 * 1024) { send('rpc-result', { id: data.id, error: '登录界面请求未授权或超过限制' }); return }
  inFlight++
  try { const value = await session.invoke(data.data?.action, data.data?.input ?? {}); send('rpc-result', { id: data.id, value }); emit('changed') }
  catch { send('rpc-result', { id: data.id, error: '账号动作失败或未声明' }) }
  finally { inFlight-- }
}
onMounted(async () => {
  window.addEventListener('message', receive)
  try {
    if (props.spec.surface.kind === 'web') { const doc = await createAccountSurfaceDocument(props.spec, generation); if (disposed) return; init = doc.init; html.value = doc.html; await nextTick() }
    else { active = true; await session.open(); await render(); loading.value = false }
  } catch { if (!disposed) { loading.value = false; error.value = '该音源登录界面目前无法在手机端打开' } }
})
onBeforeUnmount(() => { void close() })
</script>
<template>
  <div class="sheet-mask account-surface-mask" @click.self="close"><div class="scrim" @click="close" /><section class="account-surface sheet" role="dialog" aria-modal="true" :aria-label="spec.title">
    <header class="sh-head"><h2>{{ spec.title }}</h2><button class="iconbtn" aria-label="关闭账号界面" @click="close">×</button></header>
    <p v-if="loading" role="status">正在加载音源登录界面…</p><p v-if="error" role="alert" class="surface-error">{{ error }}</p>
    <iframe v-if="html" ref="frame" :srcdoc="html" sandbox="allow-scripts" :title="spec.title" @load="send('init', init)" />
    <div v-if="view" class="native-account-view"><h3>{{ view.title }}</h3><p>{{ view.description }}</p><div class="native-actions"><button v-for="a in view.actions || []" :key="a.action" class="btn" :class="a.primary ? 'btn-primary' : 'btn-ghost'" :disabled="busy" @click="perform(a.action, a.input)">{{ a.label }}</button></div>
      <section v-for="s in view.sections" :key="s.id"><h3>{{ s.title }}</h3><div v-for="item in s.items" :key="item.ref.id" class="native-entity"><button class="native-item" :disabled="busy || (!s.onOpen && !s.onPlay)" @click="perform((s.onOpen || s.onPlay)!, {ref:item.ref,refs:s.items.map(i=>i.ref)})"><img :src="image(item)" alt="" /><span>{{ item.title }}<small>{{ item.subtitle }}</small></span></button><button v-for="a in s.itemActions || []" :key="a.action" class="btn btn-ghost" :disabled="busy" @click="perform(a.action, {...(a.input as object || {}),ref:item.ref})">{{ a.label }}</button></div></section>
    </div>
  </section></div>
</template>
<style scoped>
.account-surface{height:90vh;height:90dvh;display:flex;flex-direction:column;padding:16px;gap:12px;overflow:auto}.account-surface iframe{border:0;width:100%;flex:1;min-height:260px;background:#fff}.account-surface h2{font-size:18px}.surface-error{color:var(--cinnabar);font-size:13px}.native-account-view p{font-size:12px;color:var(--ink-3);line-height:1.8}.native-actions{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}.native-account-view h3{font-size:16px;margin:12px 0}.native-entity{border-bottom:1px solid var(--line);padding:8px 0}.native-item{display:flex;width:100%;align-items:center;gap:12px;text-align:left}.native-item img{width:48px;height:48px;object-fit:cover;border-radius:8px}.native-item small{display:block;font-size:11px;color:var(--ink-3);margin-top:5px}.account-surface-mask .sheet{max-width:640px}
</style>
