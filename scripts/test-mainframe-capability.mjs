import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
const root = path.resolve(import.meta.dirname, '..'), { chromium } = createRequire(root + '/package.json')('playwright-core')
const out = process.env.CERU_QA_OUT || path.join(os.tmpdir(), 'ceru-mainframe-qa'), base = process.env.CERU_QA_BASE || 'http://127.0.0.1:5199'
await fs.mkdir(out, { recursive: true })
const key = '__ceruPrivilegedMainFrame_v1', capability = randomBytes(32).toString('hex'), checks = [], attempts = [], secret = 'synthetic-mainframe-only-secret'
const check = (name, actual, expected = true) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); checks.push({ name, actual, expected, pass }); console.log(JSON.stringify(checks.at(-1))); assert.equal(pass, true, name) }
const browser = await chromium.launch({ executablePath: process.env.CERU_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext(), page = await context.newPage()
page.on('pageerror', error => console.error('QA frame error: ' + error.message))
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin !== base) return route.abort()
  if (url.pathname === '/src/core/native/mainFrameCapability.ts') { const response = await route.fetch(); return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } }) }
  return route.continue()
})
await context.exposeBinding('qaLegacyNative', async ({ page: owner }, request) => {
  // A deliberate all-frame callable legacy bridge model; no Android native execution claim.
  if (request.method === 'initialize') { await owner.evaluate(({ key, capability }) => { if (!Object.prototype.hasOwnProperty.call(window, key)) Object.defineProperty(window, key, { value: capability, enumerable: false, writable: false, configurable: false }) }, { key, capability }); return null }
  const authorized = request.capability === capability
  attempts.push({ plugin: request.plugin, method: request.method, authorized })
  return authorized ? { value: secret } : { error: 'CAPABILITY_DENIED' }
})
let fatal
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const result = await page.evaluate(async ({ key }) => {
    const logs = []; window.Capacitor = { logToNative: data => logs.push(JSON.stringify(data)), logFromNative: data => logs.push(JSON.stringify(data)) }
    const { mainFrameCapability } = await import('/src/core/native/mainFrameCapability.ts')
    let called = 0
    const native = { initialize: async () => { called++; window.Capacitor.logToNative({ pluginId: 'SecretStore', options: {} }); await window.qaLegacyNative({ plugin: 'SecretStore', method: 'initialize' }) } }
    const capability = await mainFrameCapability(native)
    window.Capacitor.logToNative({ pluginId: 'SecretStore', options: { capability, value: 'synthetic-mainframe-only-secret' } })
    window.Capacitor.logFromNative({ pluginId: 'SecretStore', result: { value: 'synthetic-mainframe-only-secret' } })
    window.Capacitor.logToNative({ pluginId: 'SyncHttp', options: { capability, Authorization: 'synthetic-mainframe-only-secret' } })
    window.Capacitor.logFromNative({ pluginId: 'SyncHttp', result: { body: 'synthetic-mainframe-only-secret' } })
    const privateLogs = logs.length
    window.Capacitor.logToNative({ pluginId: 'PublicPlugin', options: { harmless: true } })
    const reply = await window.qaLegacyNative({ plugin: 'SecretStore', method: 'get', capability })
    const descriptor = Object.getOwnPropertyDescriptor(window, key)
    return { called, length: capability.length, enumerable: descriptor.enumerable, writable: descriptor.writable, privateLogs, publicLogs: logs.length, authorizedValuePresent: Boolean(reply.value), persisted: Object.values(localStorage).some(value => String(value).includes(capability)) }
  }, { key })
  check('first native call is initialize before key wait', result.called, 1)
  check('root capability is256bits/64hex', result.length, 64)
  check('injected root key is nonenumerable', result.enumerable, false)
  check('injected root key is not writable', result.writable, false)
  check('SecretStore/SyncHttp debug payloads suppressed both directions', result.privateLogs, 0)
  check('other plugin debug logs remain intact', result.publicLogs, 1)
  check('trusted root can call privileged backend', result.authorizedValuePresent)
  check('capability never enters localStorage', result.persisted, false)
  await page.evaluate(async ({ base, key }) => { const helper = (await import('/src/core/native/mainFrameCapability.ts')).mainFrameCapability.toString(); const frame = document.createElement('iframe'); frame.id = 'legacy-opaque'; frame.setAttribute('sandbox', 'allow-scripts'); frame.srcdoc = `<script>(async function(){window.__qaProgress="started";try{var rpcId=0;window.qaLegacyNative=function(request){return new Promise(function(resolve){var id=++rpcId;var listener=function(event){if(event.source===parent&&event.data&&event.data.qa==="legacy-native-reply"&&event.data.id===id){window.removeEventListener("message",listener);resolve(event.data.result)}};window.addEventListener("message",listener);parent.postMessage({qa:"legacy-native-request",id:id,request:request},"*")})};var mainFrameCapability=(${helper});var key=${JSON.stringify(key)},readDenied=false,wrappedDenied=false,calls=0;try{void parent[key]}catch(e){readDenied=true}try{await mainFrameCapability({initialize:async()=>{calls++}})}catch(e){wrappedDenied=true}var init=await window.qaLegacyNative({plugin:'SecretStore',method:'initialize'});var denied=[];for(var p of [['SecretStore','status'],['SecretStore','get'],['SecretStore','set'],['SecretStore','remove'],['SecretStore','clearNamespace'],['SyncHttp','authorize'],['SyncHttp','revoke'],['SyncHttp','request']]){var r=await window.qaLegacyNative({plugin:p[0],method:p[1],namespace:'other-owner',origin:'http://unapproved.invalid/'});denied.push(r.error==='CAPABILITY_DENIED'&&!r.value)}parent.postMessage({qa:'legacy-frame-result',readDenied,wrappedDenied,calls,initReturnedNoNonce:init===null,denied},'*');}catch(e){parent.postMessage({qa:'legacy-frame-result',fatal:String(e)},'*')}})();</script>`; window.__legacyResult = null; window.addEventListener('message', async event => { if(event.source !== frame.contentWindow)return; if(event.data?.qa === 'legacy-native-request'){const result=await window.qaLegacyNative(event.data.request);frame.contentWindow.postMessage({qa:'legacy-native-reply',id:event.data.id,result},'*');return} if(event.data?.qa === 'legacy-frame-result')window.__legacyResult=event.data }); document.body.appendChild(frame) }, { base, key })
  await page.waitForFunction(() => window.__legacyResult)
  const child = await page.evaluate(() => window.__legacyResult)
  if (child.fatal) throw new Error('Opaque test fixture failed: ' + child.fatal)
  check('real opaque iframe cannot read root nonce by SOP', child.readDenied)
  check('wrapped iframe request refused before initialize', child.wrappedDenied && child.calls === 0)
  check('raw legacy initialize never returns nonce to iframe', child.initReturnedNoNonce)
  check('raw legacy bridge calls without nonce deny all8 sensitive methods', child.denied.every(Boolean) && child.denied.length === 8)
  check('legacy child has zero authorized sensitive attempts', attempts.filter(a => !a.authorized).length, 8)
  await page.screenshot({ path: path.join(out, 'mainframe-capability-root-and-opaque.png'), fullPage: true })
} catch (error) { fatal = error.stack; console.error(fatal) }
finally { await fs.writeFile(path.join(out, 'mainframe-capability-tests.json'), JSON.stringify({ command: 'node scripts/test-mainframe-capability.mjs', exitCode: fatal ? 1 : 0, scope: 'Real browser opaque-origin isolation + deliberately all-frame callable legacy native binding model; native Java guards compiled/tested separately; no Android device reproduction claim', checks, attempts, fatal }, null, 2)); await browser.close(); process.exitCode = fatal ? 1 : 0 }
