import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { webcrypto, createHash } from 'node:crypto'

const root = path.resolve(process.env.CERU_AUTH_SOURCE_ROOT || path.join(import.meta.dirname, '..'))
const require = createRequire(path.join(process.env.CERU_DEPENDENCY_ROOT || root, 'package.json'))
const ts = require('typescript'), checks = []
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const jwt = sub => 'synthetic.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.synthetic'
const tokens = (sub, expires = 3600) => ({ access_token: 'synthetic-' + sub, refresh_token: 'synthetic-refresh-' + sub, id_token: jwt(sub), expires_in: expires })
const source = fs.readFileSync(path.join(root, 'src/core/auth.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
function environment(handler, digest) {
  const storage = new Map([['ceru.auth.v1', JSON.stringify({ accessToken: 'synthetic-A', refreshToken: 'synthetic-refresh-A', expiresAt: 0, idToken: jwt('A'), user: { sub: 'A' } })]])
  const opened = [], requests = [], exports = {}
  const context = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Date,
    console: { warn() {} }, crypto: digest ? { getRandomValues: value => webcrypto.getRandomValues(value), subtle: { digest } } : webcrypto,
    btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => Buffer.from(v, 'base64').toString('binary'),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) } })
  const localRequire = id => {
    if (id === 'vue') return { reactive: v => v }
    if (id === '@capacitor/core') return { Capacitor: { isNativePlatform: () => true } }
    if (id === './native/plugins') return { External: { open: async value => { opened.push(value.url) } } }
    if (id === './net') return { errorMessage: (_, fallback) => fallback, httpRequest: request => {
      const params = Object.fromEntries(new URLSearchParams(request.body)); requests.push(params); return handler(params)
    } }
    throw new Error('Unexpected import: ' + id)
  }
  vm.runInContext('(function(exports, require){' + code + '\n})', context, { filename: path.join(root, 'src/core/auth.ts') })(exports, localRequire)
  return { auth: exports, storage, opened, requests }
}
const settled = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }))
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
function callback(env, sub) {
  const pending = JSON.parse(env.storage.get('ceru.auth.pending.v1') || 'null') || { verifier: 'synthetic-verifier', state: 'synthetic-state', nonce: 'synthetic-nonce', createdAt: Date.now() }
  env.storage.set('ceru.auth.pending.v1', JSON.stringify(pending))
  return env.auth.handleAuthCallback(`cerumusic://oauth/callback?code=${sub}&state=${pending.state}`)
}
async function check(name, test) {
  try { const observed = await test(); checks.push({ name, pass: true, observed }) }
  catch (error) { checks.push({ name, pass: false, error: error.message }) }
  console.log(JSON.stringify(checks.at(-1)))
}

await check('Normal refresh remains single-flight and does not change session generation', async () => {
  const response = deferred(), env = environment(() => response.promise)
  const version = env.auth.getAuthSessionVersion?.()
  const a = env.auth.getAccessToken(), b = env.auth.getAccessToken()
  response.resolve({ status: 200, data: tokens('A') })
  assert.equal(await a, 'synthetic-A'); assert.equal(await b, 'synthetic-A')
  assert.equal(env.requests.length, 1)
  if (version !== undefined) assert.equal(env.auth.getAuthSessionVersion(), version)
  return { requests: env.requests.length, user: env.auth.authState.user.sub }
})
await check('Logout cancels a late refresh instead of restoring the signed-out account', async () => {
  const response = deferred(), env = environment(() => response.promise)
  const pending = settled(env.auth.getAccessToken())
  env.auth.logout()
  response.resolve({ status: 200, data: tokens('A') })
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(env.auth.authState.authenticated, false)
  assert.equal(env.storage.has('ceru.auth.v1'), false)
  return { lateRefreshRejected: true, authenticated: false }
})
await check('Starting a new login invalidates old refresh results', async () => {
  const response = deferred(), env = environment(() => response.promise)
  const pending = settled(env.auth.getAccessToken())
  const version = env.auth.getAuthSessionVersion?.()
  await env.auth.login()
  if (version !== undefined) assert.ok(env.auth.getAuthSessionVersion() > version)
  response.resolve({ status: 200, data: tokens('A') })
  assert.equal((await pending).ok, false)
  assert.equal(env.opened.length, 1)
  const url = new URL(env.opened[0])
  assert.equal(url.searchParams.get('redirect_uri'), 'cerumusic://oauth/callback')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  return { oldRefreshRejected: true, pkceRedirectUnchanged: true }
})
await check('Logout cancels a callback already exchanging its authorization code', async () => {
  const response = deferred(), env = environment(() => response.promise)
  const pending = settled(callback(env, 'B'))
  env.auth.logout()
  response.resolve({ status: 200, data: tokens('B') })
  assert.equal((await pending).ok, false)
  assert.equal(env.auth.authState.authenticated, false)
  assert.equal(env.auth.authState.loading, false)
  return { callbackRejected: true, authenticated: false }
})
await check('Old refresh failures/finally cannot clear B or interrupt B single-flight refresh', async () => {
  const old = deferred(), current = deferred()
  const env = environment(params => params.grant_type === 'authorization_code'
    ? Promise.resolve({ status: 200, data: tokens('B', 60) })
    : params.refresh_token === 'synthetic-refresh-A' ? old.promise : current.promise)
  const a = settled(env.auth.getAccessToken())
  const before = env.auth.getAuthSessionVersion?.()
  await callback(env, 'B')
  if (before !== undefined) assert.ok(env.auth.getAuthSessionVersion() > before)
  const firstB = settled(env.auth.getAccessToken())
  old.resolve({ status: 401, data: {} }); await a
  assert.equal(env.auth.authState.user?.sub, 'B')
  const secondB = settled(env.auth.getAccessToken())
  assert.equal(env.requests.filter(p => p.refresh_token === 'synthetic-refresh-B').length, 1)
  current.resolve({ status: 200, data: tokens('B') })
  assert.equal((await firstB).ok, true); assert.equal((await secondB).ok, true)
  return { user: 'B', newRefreshRequests: 1 }
})
await check('A superseded callback neither overwrites C nor clears its loading state', async () => {
  const bResponse = deferred(), cResponse = deferred()
  const env = environment(params => params.code === 'B' ? bResponse.promise : cResponse.promise)
  const b = settled(callback(env, 'B'))
  await env.auth.login()
  const c = settled(callback(env, 'C'))
  bResponse.resolve({ status: 200, data: tokens('B') })
  assert.equal((await b).ok, false)
  assert.equal(env.auth.authState.loading, true)
  cResponse.resolve({ status: 200, data: tokens('C') })
  assert.equal((await c).ok, true)
  assert.equal(env.auth.authState.user.sub, 'C')
  assert.equal(env.auth.authState.loading, false)
  return { staleCallbackRejected: true, user: 'C' }
})
await check('Logout during PKCE generation prevents delayed login from opening or restoring pending state', async () => {
  const digest = deferred(), env = environment(() => { throw new Error('No HTTP expected') }, () => digest.promise)
  const pending = settled(env.auth.login())
  env.auth.logout()
  digest.resolve(new Uint8Array(32).buffer)
  assert.equal((await pending).ok, false)
  assert.equal(env.opened.length, 0)
  assert.equal(env.storage.has('ceru.auth.pending.v1'), false)
  return { canceled: true, browserOpenCount: 0 }
})
await check('A new authorization does not inherit the prior account refresh token or identity', async () => {
  const env = environment(() => Promise.resolve({ status: 200, data: { access_token: 'synthetic-B', expires_in: 3600 } }))
  await callback(env, 'B')
  const stored = JSON.parse(env.storage.get('ceru.auth.v1'))
  assert.equal(stored.refreshToken, undefined)
  assert.equal(stored.idToken, undefined)
  assert.equal(stored.user, null)
  return { previousAccountFieldsDiscarded: true }
})
await nextTurn()
const exitCode = checks.some(item => !item.pass) ? 1 : 0
const result = { command: 'node scripts/test-account-session.mjs', sourceRoot: root, exitCode,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  scope: 'Actual auth.ts transpiled/executed with synthetic deferred token responses and Vue/Capacitor stubs; no network or real accounts', checks }
if (process.env.CERU_QA_OUT) {
  fs.mkdirSync(process.env.CERU_QA_OUT, { recursive: true })
  fs.writeFileSync(path.join(process.env.CERU_QA_OUT, 'account-session-tests.json'), JSON.stringify(result, null, 2))
}
process.exitCode = exitCode
