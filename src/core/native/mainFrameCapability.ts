const KEY = '__ceruPrivilegedMainFrame_v1'
interface Initializer { initialize(): Promise<void> }
const guardedLoggers = new WeakSet<object>()
function protectNativeLogs(): void {
  const cap = (window as any).Capacitor
  if (!cap || guardedLoggers.has(cap) || typeof cap.logToNative !== 'function' || typeof cap.logFromNative !== 'function') return
  const toNative = cap.logToNative, fromNative = cap.logFromNative
  const sensitive = (data: any): boolean => ['SecretStore', 'SyncHttp', 'LocalMedia'].includes(data?.pluginId)
  cap.logToNative = (data: any): void => { if (!sensitive(data)) toNative.call(cap, data) }
  cap.logFromNative = (data: any): void => { if (!sensitive(data)) fromNative.call(cap, data) }
  guardedLoggers.add(cap)
}

/** Keep this value inside trusted root clients; never place it in plugin RPC, logs, config or snapshots. */
export async function mainFrameCapability(native: Initializer): Promise<string> {
  if (typeof window === 'undefined' || window.top !== window) throw new Error('敏感原生服务只允许应用主框架调用')
  protectNativeLogs()
  // initialize is intentionally public/non-sensitive and triggers lazy Plugin.load.
  // Waiting for the injected key before invoking it would deadlock a fresh bridge.
  await native.initialize()
  protectNativeLogs()
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = (window as any)[KEY]
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return value
    await new Promise<void>(resolve => setTimeout(resolve, 25))
  }
  throw new Error('安全主框架能力不可用；未降级到明文凭据或开放网络')
}
