import { SurfaceSession } from '@shiqianjiang/ceru-plugin-core/surface'
import type { PluginManifest, SurfaceDeclaration, JsonValue } from '@shiqianjiang/ceru-plugin-sdk'

export interface AccountSurfaceSpec { pluginId: string; accountId: string; title: string; manifest: PluginManifest; surface: SurfaceDeclaration; code?: string; resources: Record<string, any> }
export interface AccountSurfaceEvent { pluginId: string; surfaceId: string; type: string; state?: any }
const listeners = new Set<(event: AccountSurfaceEvent) => void>()
export function accountSurfaceEvent(event: AccountSurfaceEvent): void { for (const listener of listeners) listener(event) }
export function subscribeAccountSurface(listener: (event: AccountSurfaceEvent) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function createAccountSurfaceSession(spec: AccountSurfaceSpec, dispatch: (action: string, input: JsonValue, signal?: AbortSignal) => Promise<any>): SurfaceSession { return new SurfaceSession(spec.surface, spec.manifest, dispatch) }
let runtime: Promise<string[]> | undefined
function base64(text: string): string { const bytes = new TextEncoder().encode(text); let b = ''; for (let n = 0; n < bytes.length; n += 32768) b += String.fromCharCode(...bytes.subarray(n, n + 32768)); return btoa(b) }
/** Browser equivalent of the official Node surface-document helper, same sandbox policy. */
export async function createAccountSurfaceDocument(spec: AccountSurfaceSpec, generation: string): Promise<{ html: string; init: any }> {
  if (spec.surface.kind !== 'web' || !spec.code) throw new Error('登录界面没有可用的 Web 模块')
  runtime ??= Promise.all(['/compat.js', '/plugin-runtime/sandbox.js', '/plugin-runtime/catalog.json'].map(async url => { const r = await fetch(url); if (!r.ok) throw new Error('登录运行时加载失败'); return r.text() })).catch(error => { runtime = undefined; throw error })
  const [compat, sandbox, catalog] = await runtime
  const script = (code: string) => `<script src="data:text/javascript;base64,${base64(code)}"></script>`
  return { html: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">` +
    '<style>html,body{margin:0;color:#202428;background:#fff}</style><div id="plugin-root"></div>' + script(compat) + script(sandbox) + script(`globalThis.__ceruStart(${spec.code});`),
    init: { generation, mode: 'production', kind: 'web', manifest: spec.manifest, resources: spec.resources, catalog: JSON.parse(catalog), mount: { kind: 'page' } } }
}
