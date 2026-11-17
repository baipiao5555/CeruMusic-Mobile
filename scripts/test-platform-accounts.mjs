import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const base = process.env.CERU_QA_BASE || 'http://127.0.0.1:5311'
const out = process.env.CERU_QA_DIR
if (!out) throw Error('CERU_QA_DIR required')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const checks = [], errors = []
try {
 const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
 await page.addInitScript(() => {
  if (window.top !== window) return
  localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
  window.__loginTest = { store: {}, input: 'MUSIC_U=synthetic', response: { status: 200, body: JSON.stringify({ code: 200, account: { id: 42 }, profile: { userId: 42, nickname: '回归测试' } }) }, failWrite: false, failVerify: false }
 })
 page.on('pageerror', e => errors.push(e.message))
 await page.route('**/*', async route => {
  const u = new URL(route.request().url())
  if (u.pathname === '/src/core/native/platformLogin.ts') return route.fulfill({ contentType: 'text/javascript', body: `export const supportsPlatformLogin=()=>true;export async function openPlatformLogin(){if(window.__loginTest.input==='CANCEL')throw Error('LOGIN_CANCELLED');return window.__loginTest.input};export async function verifyPlatformLogin(){if(window.__loginTest.failVerify)throw Error('network');return window.__loginTest.response}` })
  if (u.pathname === '/src/core/native/secureStore.ts') return route.fulfill({ contentType: 'text/javascript', body: `export const secureStore={async get(n,k){return window.__loginTest.store[n+':'+k]||null},async set(n,k,v){if(window.__loginTest.failWrite)throw Error('quota');window.__loginTest.store[n+':'+k]=v},async remove(n,k){delete window.__loginTest.store[n+':'+k]}}` })
  if (u.hostname === '127.0.0.1') return route.continue()
  return route.abort()
 })
 await page.goto(base + '/#/library')
 await page.locator('.profile-main').waitFor()
 const result = await page.evaluate(async () => {
  const m = await import('/src/core/platformAccounts.ts')
  const t = window.__loginTest, checks = []
  const check = (name, pass) => { checks.push({ name, pass }); if (!pass) throw Error(name) }
  for (const body of [{code:200,account:null,profile:null},{code:200,account:{id:1},profile:{userId:2}},{code:0,req:{code:1000}},{code:0,req:{code:0,data:{}}}]) {
   let rejected=false;try{m.verifiedIdentity(body.code===200?'wy':'tx',200,JSON.stringify(body))}catch{rejected=true}
   check('anonymous/mismatched/expired/incomplete identity rejected '+checks.length,rejected)
  }
  await m.connectPlatform('wy')
  check('valid identity saved and verified only after storage',m.platformAccounts.wy.phase==='verified'&&m.platformAccounts.wy.userId==='42')
  const original=t.store['music.platform.wy:session']
  t.response={status:200,body:'{"code":200,"account":null,"profile":null}'}
  await m.connectPlatform('wy')
  check('failed new login preserves existing session',t.store['music.platform.wy:session']===original)
  t.input='CANCEL';await m.connectPlatform('wy')
  check('cancel preserves original and is not an error',t.store['music.platform.wy:session']===original&&!m.platformAccounts.wy.error)
  t.input='bad\r\nCookie: secret';await m.connectPlatform('wy')
  check('header injection rejected',t.store['music.platform.wy:session']===original)
  t.input='qm_keyst=synthetic; qqmusic_uin=99';t.response={status:200,body:'{"code":0,"req":{"code":0,"data":{"musicid":99,"nick":"QQ测试"}}}'}
  await m.connectPlatform('tx')
  check('QQ login-user identity accepted',m.platformAccounts.tx.phase==='verified'&&m.platformAccounts.tx.userId==='99')
  t.failWrite=true;await m.connectPlatform('kw')
  check('storage failure never reports saved',m.platformAccounts.kw.phase==='none'&&!t.store['music.platform.kw:session'])
  t.failWrite=false;t.input='KuGoo=synthetic';await m.connectPlatform('kg')
  check('unadapted platform saved but never labeled verified',m.platformAccounts.kg.phase==='saved')
  t.failVerify=true;await m.refreshPlatformAccounts()
  check('offline restart removes verified label but preserves session',m.platformAccounts.wy.phase==='saved'&&t.store['music.platform.wy:session']===original)
  await m.disconnectPlatform('wy')
  check('logout clears only selected platform',!t.store['music.platform.wy:session']&&!!t.store['music.platform.tx:session']&&m.platformAccounts.wy.phase==='none')
  check('no credential in localStorage',!Object.keys(localStorage).some(k=>/platform/.test(k)))
  return checks
 })
 checks.push(...result)
 await page.locator('.profile-main').click()
 await page.getByRole('dialog', { name: '登录音乐平台' }).waitFor()
 await page.screenshot({ path: path.join(out, 'platform-picker-390.png'), fullPage: true })
 for (const width of [360, 412]) {
  await page.setViewportSize({ width, height: width===360?640:915 })
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({ path: path.join(out, `platform-picker-${width}.png`), fullPage: true })
 }
 checks.push({name:'mobile picker mounted with no horizontal overflow at 360/390/412',pass:true})
 const source = await readFile(path.resolve(import.meta.dirname,'../android/app/src/main/java/com/ceru/music/mobile/PlatformLoginPlugin.java'),'utf8')
 assert(!source.includes('addJavascriptInterface'))
 assert(source.includes('handler.cancel()')&&source.includes('setInstanceFollowRedirects(false)')&&source.includes('MIXED_CONTENT_NEVER_ALLOW'))
 checks.push({name:'static native boundary: no JS bridge, TLS/redirect checks present',pass:true})
 assert.equal(errors.length,0)
} catch(e) { errors.push(e.stack);process.exitCode=1 }
finally {await browser.close();await writeFile(path.join(out,'platform-account-tests.json'),JSON.stringify({scope:'actual TS/Vue in Chrome with synthetic native-login and storage responses; NOT Android/real-account verification',checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors,pass:!errors.length}));}
