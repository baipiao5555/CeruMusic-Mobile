import { Capacitor, registerPlugin } from '@capacitor/core'
import { mainFrameCapability } from './mainFrameCapability'

interface NativeSyncKeepAlive {
  initialize(): Promise<void>
  start(options: { capability: string }): Promise<void>
  stop(options: { capability: string }): Promise<void>
  status(options: { capability: string }): Promise<{ running: boolean }>
}

const native = registerPlugin<NativeSyncKeepAlive>('SyncKeepAlive')
const android = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export function supportsSyncKeepAlive(): boolean {
  return android()
}

export async function syncKeepAliveStatus(): Promise<boolean> {
  if (!android()) return false
  return (await native.status({ capability: await mainFrameCapability(native) })).running === true
}

export async function setSyncKeepAlive(enabled: boolean): Promise<void> {
  if (!android()) return
  const capability = await mainFrameCapability(native)
  if (enabled) await native.start({ capability })
  else await native.stop({ capability })
}
