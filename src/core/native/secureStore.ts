import { Capacitor, registerPlugin } from '@capacitor/core'
import { mainFrameCapability } from './mainFrameCapability'

export interface SecureStoreStatus {
  backend: 'android-keystore-aes-gcm' | 'session-memory'
  persistent: boolean
  encryptedAtRest: boolean
}
interface NativeSecretStore {
  initialize(): Promise<void>
  status(options: { capability: string }): Promise<SecureStoreStatus>
  get(options: { namespace: string; key: string; capability: string }): Promise<{ value: string | null }>
  set(options: { namespace: string; key: string; value: string; capability: string }): Promise<void>
  remove(options: { namespace: string; key: string; capability: string }): Promise<void>
  clearNamespace(options: { namespace: string; capability: string }): Promise<void>
}
const native = registerPlugin<NativeSecretStore>('SecretStore')
const memory = new Map<string, string>()
const MAX_VALUE_BYTES = 256 * 1024
const android = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
function identity(namespace: string, key?: string): string {
  if (typeof namespace !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(namespace) || (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)))) throw new Error('安全凭据空间或键名无效')
  return `${namespace}\0${key || ''}`
}
export const secureStore = {
  async status(): Promise<SecureStoreStatus> {
    if (!android()) return { backend: 'session-memory', persistent: false, encryptedAtRest: false }
    const status = await native.status({ capability: await mainFrameCapability(native) })
    if (status.backend !== 'android-keystore-aes-gcm' || !status.persistent || !status.encryptedAtRest) throw new Error('Android 安全仓库不可用')
    return status
  },
  async get(namespace: string, key: string): Promise<string | null> {
    if (typeof key !== 'string') throw new Error('安全凭据键名无效')
    const id = identity(namespace, key)
    if (!android()) return memory.get(id) ?? null
    const result = await native.get({ namespace, key, capability: await mainFrameCapability(native) })
    if (result.value !== null && typeof result.value !== 'string') throw new Error('安全凭据读取结果无效')
    return result.value
  },
  async set(namespace: string, key: string, value: string): Promise<void> {
    if (typeof key !== 'string') throw new Error('安全凭据键名无效')
    const id = identity(namespace, key)
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > MAX_VALUE_BYTES) throw new Error('安全凭据大小超过限制')
    if (android()) { await native.set({ namespace, key, value, capability: await mainFrameCapability(native) }); return }
    if (!memory.has(id) && memory.size >= 512) throw new Error('本次会话安全凭据数量超过限制')
    memory.set(id, value)
  },
  async remove(namespace: string, key: string): Promise<void> {
    if (typeof key !== 'string') throw new Error('安全凭据键名无效')
    const id = identity(namespace, key)
    if (android()) { await native.remove({ namespace, key, capability: await mainFrameCapability(native) }); return }
    memory.delete(id)
  },
  async clearNamespace(namespace: string): Promise<void> {
    const prefix = identity(namespace)
    if (android()) { await native.clearNamespace({ namespace, capability: await mainFrameCapability(native) }); return }
    for (const id of memory.keys()) if (id.startsWith(prefix)) memory.delete(id)
  }
}
