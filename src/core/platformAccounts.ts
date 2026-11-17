import { reactive, ref } from 'vue'
import { secureStore } from './native/secureStore'
import { openPlatformLogin, verifyPlatformLogin, type PlatformId } from './native/platformLogin'

export const musicPlatforms = [
  { id: 'tx', name: 'QQ音乐', mark: 'QQ', color: '#12ad70', verifiesIdentity: true, webLogin: true },
  { id: 'wy', name: '网易云音乐', mark: 'NE', color: '#e66379', verifiesIdentity: true, webLogin: true },
  { id: 'kg', name: '酷狗音乐', mark: 'KG', color: '#5782cf', verifiesIdentity: false, webLogin: true },
  { id: 'kw', name: '酷我音乐', mark: 'KW', color: '#d8a03c', verifiesIdentity: false, webLogin: true },
  { id: 'mg', name: '咪咕音乐', mark: 'MG', color: '#d14e81', verifiesIdentity: false, webLogin: true },
  { id: 'qs', name: '汽水音乐', mark: 'QS', color: '#8557da', verifiesIdentity: false, webLogin: false }
] as const
type Phase = 'none' | 'saved' | 'verified'
interface Account { phase: Phase; name: string; userId: string; busy: boolean; error: string }
export interface PlatformSession { cookies: string; name?: string; userId?: string }
const empty = (): Account => ({ phase: 'none', name: '', userId: '', busy: false, error: '' })
export const platformAccounts = reactive<Record<PlatformId, Account>>({ tx: empty(), wy: empty(), kg: empty(), kw: empty(), mg: empty(), qs: empty() })
export const platformLoginVisible = ref(false)
const epochs: Record<PlatformId, number> = { tx: 0, wy: 0, kg: 0, kw: 0, mg: 0, qs: 0 }
const writes = new Map<PlatformId, Promise<void>>()
const namespace = (id: PlatformId): string => `music.platform.${id}`
function validSession(value: any): value is PlatformSession {
  return Boolean(value) && typeof value === 'object' && typeof value.cookies === 'string' &&
    value.cookies.length > 0 && value.cookies.length <= 65536 && !/[\r\n]/.test(value.cookies)
}
/** Reads the Keystore-backed platform web session without exposing it to plugins or localStorage. */
export async function readPlatformSession(id: PlatformId): Promise<PlatformSession | null> {
  const raw = await secureStore.get(namespace(id), 'session')
  if (!raw) return null
  let value: any
  try { value = JSON.parse(raw) } catch { throw new Error('平台会话格式无效，请重新登录') }
  if (!validSession(value)) throw new Error('平台会话格式无效，请重新登录')
  return {
    cookies: value.cookies,
    ...(typeof value.name === 'string' && value.name ? { name: value.name.slice(0, 80) } : {}),
    ...(typeof value.userId === 'string' && value.userId ? { userId: value.userId.slice(0, 40) } : {})
  }
}
function current(id: PlatformId, version: number): void { if (epochs[id] !== version) throw new Error('账号已变化，旧登录结果已取消') }
function write(id: PlatformId, action: () => Promise<void>): Promise<void> {
  const next = (writes.get(id) || Promise.resolve()).catch(() => undefined).then(action)
  writes.set(id, next); return next
}
const uid = (value: unknown): string => /^(?:[1-9]\d*)$/.test(String(value)) ? String(value) : ''
export function verifiedIdentity(id: PlatformId, status: number, body: string): { userId: string; name: string } {
  if (status !== 200) throw new Error('平台身份核验未成功，未标记已登录')
  let data: any
  try { data = JSON.parse(body) } catch { throw new Error('平台返回了无效的身份信息') }
  if (id === 'wy' && data.code === 200 && uid(data.account?.id) && uid(data.profile?.userId) === uid(data.account.id)) {
    return { userId: uid(data.account.id), name: String(data.profile.nickname || '网易云用户').slice(0, 80) }
  }
  if (id === 'tx' && data.code === 0 && data.req?.code === 0) {
    const info = data.req.data
    // Require the login-user response, not a publicly readable profile page.
    const userId = uid(info?.musicid || info?.uin || info?.userInfo?.musicid || info?.userInfo?.uin)
    if (userId) return { userId, name: String(info?.nick || info?.nickname || info?.userInfo?.nick || 'QQ音乐用户').slice(0, 80) }
  }
  throw new Error('平台未确认登录身份，请重新登录；不会显示已登录')
}
async function identity(id: PlatformId, session: PlatformSession): Promise<{ userId: string; name: string } | undefined> {
  if (!musicPlatforms.find(p => p.id === id)?.verifiesIdentity) return undefined
  const result = await verifyPlatformLogin(id, session.cookies)
  return verifiedIdentity(id, result.status, result.body)
}
export async function connectPlatform(id: PlatformId): Promise<void> {
  const state = platformAccounts[id]
  if (!musicPlatforms.find(p => p.id === id)?.webLogin) { state.error = '汽水音乐普通用户网页会话尚未接入，请使用官方 App 登录'; return }
  if (state.busy) return
  const version = ++epochs[id]
  state.busy = true; state.error = ''
  try {
    const session: PlatformSession = { cookies: await openPlatformLogin(id) }
    current(id, version)
    if (!session.cookies || session.cookies.length > 65536 || /[\r\n]/.test(session.cookies)) throw new Error('没有取得有效平台会话，原账号未修改')
    let user: { userId: string; name: string } | undefined
    let identityWarning = ''
    try {
      user = await identity(id, session)
    } catch (error) {
      // QQ's web session is still useful even if the optional identity endpoint rejects it.
      // Keep the session and label it unverified instead of discarding a completed web login.
      if (id !== 'tx') throw error
      identityWarning = 'QQ 网页会话已保存，但身份核验失败；平台歌单可能仍无法读取。'
    }
    current(id, version)
    await write(id, async () => { current(id, version); await secureStore.set(namespace(id), 'session', JSON.stringify({ ...session, ...user })) })
    current(id, version)
    Object.assign(state, { phase: user ? 'verified' : 'saved', name: user?.name || '', userId: user?.userId || '', error: identityWarning })
  } catch (error: any) {
    if (epochs[id] === version) state.error = error?.message === 'LOGIN_CANCELLED' ? '' : '登录未完成或身份核验失败，原账号未修改。请检查网页和网络后重试。'
  } finally { if (epochs[id] === version) state.busy = false }
}
export async function refreshPlatformAccounts(): Promise<void> {
  await Promise.all(musicPlatforms.map(async ({ id }) => {
    if (!musicPlatforms.find(p => p.id === id)?.webLogin) return
    const state = platformAccounts[id]
    if (state.busy) return
    const version = ++epochs[id]
    state.busy = true; state.error = ''
    if (state.phase === 'verified') state.phase = 'saved'
    try {
      const session = await readPlatformSession(id)
      current(id, version)
      if (!session) { Object.assign(state, empty(), { busy: true }); return }
      Object.assign(state, { phase: 'saved', name: '', userId: '' })
      const user = await identity(id, session)
      current(id, version)
      if (user) Object.assign(state, { phase: 'verified', ...user })
    } catch { if (epochs[id] === version) state.error = '平台身份未核验；请检查网络或重新登录。' }
    finally { if (epochs[id] === version) state.busy = false }
  }))
}
export async function disconnectPlatform(id: PlatformId): Promise<void> {
  const version = ++epochs[id], state = platformAccounts[id]
  state.busy = true
  try { await write(id, () => secureStore.remove(namespace(id), 'session')); current(id, version); Object.assign(state, empty()) }
  catch { if (epochs[id] === version) { state.busy = false; state.error = '本机会话清除失败，请重试' } }
}
