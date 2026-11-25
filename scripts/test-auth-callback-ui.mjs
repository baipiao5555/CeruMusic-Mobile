import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../evidence')
const base = 'http://127.0.0.1:5392'
const server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5392', '--strictPort'], {cwd: root, windowsHide: true})
let browser, count = 0, denied = false
const idToken = 'synthetic.' + Buffer.from(JSON.stringify({sub:'fixture-B', name:'离线回调测试账号', nonce:'fixture-nonce'})).toString('base64url') + '.synthetic'
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true})
  const page = await browser.newPage({viewport:{width:390,height:844}})
  await page.addInitScript(() => {
    if (window.top !== window) return
    localStorage.setItem('ceru.update.v1', JSON.stringify({autoCheck:false}))
    localStorage.setItem('ceru.settings.v1', JSON.stringify({pluginAutoUpdate:false}))
  })
  await page.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(base)) return route.continue()
    if (url.endsWith('/oidc/token')) {
      count++
      assert.match(route.request().postData() || '', /code_verifier=fixture-verifier/)
      return route.fulfill({status: denied ? 401 : 200, headers:{'access-control-allow-origin':'*'}, json: denied ? {error_description:'离线测试：凭据交换失败'} : {access_token:'synthetic-access',id_token:idToken,expires_in:3600}})
    }
    if (url.includes('/user-songlist')) return route.fulfill({headers:{'access-control-allow-origin':'*'},json:[]})
    return route.abort()
  })
  await page.goto(base + '/#/cloud')
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(async () => {
    const auth = window.__ceruDebug.auth
    localStorage.setItem('ceru.auth.pending.v1', JSON.stringify({verifier:'fixture-verifier',state:'fixture-state',nonce:'fixture-nonce',createdAt:Date.now()}))
    const url = 'cerumusic://oauth/callback?code=fixture-code&state=fixture-state'
    await Promise.all([auth.handleAuthCallback(url), auth.handleAuthCallback(url)])
  })
  await page.locator('.p-conn').waitFor()
  assert.match(await page.locator('.p-conn').innerText(), /离线回调测试账号/)
  assert.equal(count, 1)
  console.log('PASS real CloudPlaylists UI becomes authenticated after one callback exchange')
  await page.evaluate(() => window.__ceruDebug.auth.logout())
  denied = true
  await page.evaluate(async () => {
    localStorage.setItem('ceru.auth.pending.v1', JSON.stringify({verifier:'fixture-verifier',state:'fixture-state',nonce:'fixture-nonce',createdAt:Date.now()}))
    try { await window.__ceruDebug.auth.handleAuthCallback('cerumusic://oauth/callback?code=denied&state=fixture-state') } catch {}
  })
  await page.getByRole('alert').getByText('离线测试：凭据交换失败', {exact:true}).waitFor()
  await page.screenshot({path:output + '/auth-error-visible.png'})
  console.log('PASS failed callback remains visible in the real login page instead of disappearing with a toast')
} finally { await browser?.close(); server.kill() }
