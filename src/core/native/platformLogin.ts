import { Capacitor, registerPlugin } from '@capacitor/core'
import { mainFrameCapability } from './mainFrameCapability'

export type PlatformId = 'tx' | 'wy' | 'kg' | 'kw'
interface NativePlatformLogin {
  initialize(): Promise<void>
  open(options: { platform: PlatformId; capability: string }): Promise<{ cookies: string }>
  verify(options: { platform: PlatformId; cookies: string; capability: string }): Promise<{ status: number; body: string }>
}
const native = registerPlugin<NativePlatformLogin>('PlatformLogin')
export const supportsPlatformLogin = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export async function openPlatformLogin(platform: PlatformId): Promise<string> {
  if (!supportsPlatformLogin()) throw new Error('网页登录会话获取需要 Android 客户端；普通浏览器不能读取其他网站的登录凭据。')
  return (await native.open({ platform, capability: await mainFrameCapability(native) })).cookies
}
export async function verifyPlatformLogin(platform: PlatformId, cookies: string): Promise<{ status: number; body: string }> {
  if (!supportsPlatformLogin()) throw new Error('请在 Android 客户端核验平台会话')
  return native.verify({ platform, cookies, capability: await mainFrameCapability(native) })
}
