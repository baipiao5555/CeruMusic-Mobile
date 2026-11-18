import { secureStore } from './secureStore'

const MARKER = 'ceru.platform-login.removed.v1'
const NAMESPACES = ['tx', 'wy', 'kg', 'kw', 'mg', 'qs'].map(id => `music.platform.${id}`)

/** Removes platform cookies saved by the removed built-in web-login feature. */
export async function cleanupLegacyPlatformSessions(): Promise<void> {
  if (typeof localStorage === 'undefined') return
  try {
    if (localStorage.getItem(MARKER) === '1') return
  } catch {
    return
  }
  let complete = true
  for (const namespace of NAMESPACES) {
    try {
      await secureStore.clearNamespace(namespace)
    } catch {
      complete = false
    }
  }
  if (complete) {
    try {
      localStorage.setItem(MARKER, '1')
    } catch {}
  }
}
