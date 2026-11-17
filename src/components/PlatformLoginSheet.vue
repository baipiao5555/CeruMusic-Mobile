<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { authState, displayName, login } from '@/core/auth'
import { connectPlatform, disconnectPlatform, musicPlatforms, platformAccounts, refreshPlatformAccounts } from '@/core/platformAccounts'
import { supportsPlatformLogin, type PlatformId } from '@/core/native/platformLogin'
import { confirmAction } from '@/core/confirm'
import { External } from '@/core/native/plugins'
const emit = defineEmits<{ close: [] }>()
const router = useRouter(), error = ref('')
async function ceru(): Promise<void> {
  if (authState.authenticated) { emit('close'); await router.push('/cloud'); return }
  try { await login() } catch { error.value = '澜音登录页打开失败，请检查网络' }
}
async function remove(id: PlatformId): Promise<void> {
  if (await confirmAction({ title: '清除此平台的本机会话？', body: '不删除平台歌单、本地音乐或其他账号。', confirmText: '清除', danger: true })) await disconnectPlatform(id)
}
async function openPlatform(id: PlatformId): Promise<void> {
  if (id !== 'qs') { await connectPlatform(id); return }
  if (await confirmAction({ title: '汽水音乐登录说明', body: '已添加汽水平台入口，但普通用户网页登录会话尚未接入。目前确认的官网提供 App 下载；合作平台账号不是听歌账号。请在汽水官方 App 中登录，澜音不会显示虚假的已登录状态。', confirmText: '打开官方页面', cancelText: '知道了' })) {
    try { await External.open({ url: 'https://qishui.douyin.com/' }) } catch { error.value = '官方页面打开失败，请检查网络' }
  }
}
onMounted(() => { void refreshPlatformAccounts() })
</script>
<template>
  <div class="sheet-mask" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="sheet platform-sheet" role="dialog" aria-modal="true" aria-label="登录音乐平台">
      <div class="grab" />
      <header class="sh-head"><h2 class="sh-title">登录音乐平台</h2><button class="iconbtn quiet" aria-label="关闭平台选择" @click="emit('close')"><Icon name="close" :size="18" /></button></header>
      <div class="platform-content">
        <p class="intro">在官方网页完成登录，账号彼此独立。不会切换歌曲音源。</p>
        <button class="ceru-row" @click="ceru"><span class="platform-mark ceru-mark"><Icon name="user" :size="21" /></span><span class="row-copy"><strong>澜音应用账号</strong><small>{{ authState.authenticated ? displayName() : '连接手机与电脑的澜音云歌单' }}</small></span><span class="row-action">{{ authState.authenticated ? '云歌单' : '登录' }}</span><Icon name="chevron-right" :size="14" /></button>
        <div class="platform-heading"><h3>音乐平台</h3><span>官方网页登录</span></div>
        <div v-for="p in musicPlatforms" :key="p.id" class="platform-row">
          <button class="platform-open" :disabled="(p.webLogin && !supportsPlatformLogin()) || platformAccounts[p.id].busy" @click="openPlatform(p.id)">
            <span class="platform-mark" :style="{color:p.color,background:p.color+'18'}">{{ p.mark }}</span>
            <span class="row-copy"><strong>{{ p.name }}</strong><small>{{ !p.webLogin ? '官方 App 登录 · 普通用户网页会话未接入' : platformAccounts[p.id].phase === 'verified' ? '已登录 · '+platformAccounts[p.id].name : platformAccounts[p.id].phase === 'saved' ? '会话已保存 · 身份未核验' : p.verifiesIdentity ? '登录后核验平台身份' : '专用登录界面 · 身份接口尚未适配' }}</small></span>
            <span class="row-action">{{ !p.webLogin ? '说明' : platformAccounts[p.id].busy ? '处理中' : platformAccounts[p.id].phase === 'none' ? '登录' : '重登录' }}</span>
          </button>
          <button v-if="platformAccounts[p.id].phase !== 'none'" class="clear-session" :disabled="platformAccounts[p.id].busy" :aria-label="'清除'+p.name+'本机会话'" @click="remove(p.id)"><Icon name="logout" :size="17" /></button>
          <p v-if="platformAccounts[p.id].error" class="platform-error" role="alert">{{ platformAccounts[p.id].error }}</p>
        </div>
        <p v-if="error" class="platform-error" role="alert">{{error}}</p>
        <p class="login-note">{{ supportsPlatformLogin() ? '仅在你点“完成登录”后获取平台会话；复制的凭据在本机 Keystore 加密保存，不交给音源。' : 'Web 预览不获取平台会话。请安装 Android 客户端使用；不会冒充网页登录成功。' }}<br>平台登录只保存官方网页会话，不会自动把平台歌单加入“云端歌单”；当前云端歌单仍只读取澜音账号。平台歌单读取/导入尚未接入，平台登录也不等于会员播放权限。</p>
      </div>
    </section>
  </div>
</template>
<style scoped>
.platform-sheet{max-height:85vh;padding-bottom:calc(14px + var(--safe-bottom));overflow:auto;background:var(--surface)}.platform-content{padding:0 var(--pad)}.intro{font-size:12px;color:var(--ink-3);line-height:1.7;margin-bottom:15px}.ceru-row{display:flex;align-items:center;gap:11px;width:100%;padding:14px 12px;border:1px solid var(--line-2);border-radius:15px;text-align:left}.platform-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;font-size:12px;font-weight:750;flex:none}.ceru-mark{color:var(--tint);background:var(--tint-softer)}.row-copy{flex:1;min-width:0}.row-copy strong,.row-copy small{display:block}.row-copy strong{font-size:13px;font-weight:650}.row-copy small{font-size:10px;color:var(--ink-3);margin-top:4px;line-height:1.6;overflow-wrap:anywhere}.row-action{flex:none;font-size:11px;color:var(--tint);padding:7px 9px;border:1px solid var(--line-2);border-radius:8px}.platform-heading{display:flex;align-items:center;justify-content:space-between;margin:22px 0 8px}.platform-heading h3{font-size:16px;margin:0}.platform-heading span{font-size:10px;color:var(--ink-3)}.platform-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border-bottom:1px solid var(--line-2)}.platform-open{flex:1;display:flex;align-items:center;gap:11px;text-align:left;min-height:72px;min-width:0;padding:10px 0}.platform-open:disabled .row-action{color:var(--ink-3)}.clear-session{width:36px;min-height:44px;margin-left:5px;color:var(--ink-3)}.platform-error{grid-column:1/-1;width:100%;font-size:11px;color:var(--cinnabar);line-height:1.7;margin:0 0 9px}.login-note{margin:16px 0 0;padding:12px;border-radius:12px;background:var(--surface-2);font-size:10px;line-height:1.8;color:var(--ink-3)}
</style>
