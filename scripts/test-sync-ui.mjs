import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const root = path.resolve(import.meta.dirname, '..'), { chromium } = createRequire(root + '/package.json')('playwright-core')
const out = process.env.CERU_QA_OUT || path.join(os.tmpdir(), 'ceru-sync-ui-qa'), base = process.env.CERU_QA_BASE || 'http://127.0.0.1:5199'
await fs.mkdir(out, { recursive: true })
const checks = [], requests = [], errors = [], data = new Map([['/dav/user-document.txt', { body: 'never-delete', etag: '"user"' }]])
let version = 0
const expectedAuth = 'Basic ' + Buffer.from('qa:ui-only-password').toString('base64')
const server = http.createServer(async (request, response) => {
  for (const [k, v] of Object.entries({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS,PROPFIND,MKCOL', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Depth,If-Match,If-None-Match,Accept', 'Access-Control-Expose-Headers': 'ETag,DAV,Allow,Content-Length', DAV: '1', Allow: 'GET,HEAD,PUT,DELETE,OPTIONS,PROPFIND,MKCOL' })) response.setHeader(k, v)
  if (request.method === 'OPTIONS' && !request.headers.authorization) { response.writeHead(204); return response.end() }
  requests.push({ method: request.method, file: path.basename(request.url), authenticated: request.headers.authorization === expectedAuth })
  if (request.headers.authorization !== expectedAuth) { response.writeHead(401); return response.end() }
  if (request.method === 'OPTIONS') { response.writeHead(200); return response.end() }
  if (request.method === 'PROPFIND') { response.writeHead(207, { 'Content-Type': 'application/xml' }); return response.end('<d:multistatus xmlns:d="DAV:">' + [...data.keys()].map(file => `<d:response><d:href>${file}</d:href></d:response>`).join('') + '</d:multistatus>') }
  const existing = data.get(request.url)
  if (request.method === 'PUT') { const chunks = []; for await (const bytes of request) chunks.push(bytes); if ((request.headers['if-none-match'] === '*' && existing) || (request.headers['if-match'] && request.headers['if-match'] !== existing?.etag)) { response.writeHead(412); return response.end() }; const item = { body: Buffer.concat(chunks).toString('utf8'), etag: '"ui' + (++version) + '"' }; data.set(request.url, item); response.writeHead(existing ? 204 : 201, { ETag: item.etag }); return response.end() }
  if (!existing) { response.writeHead(404); return response.end() }
  if (request.method === 'DELETE') { if (request.headers['if-match'] && request.headers['if-match'] !== existing.etag) { response.writeHead(412); return response.end() }; data.delete(request.url); response.writeHead(204); return response.end() }
  response.writeHead(200, { ETag: existing.etag, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(existing.body) }); response.end(request.method === 'HEAD' ? '' : existing.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: process.env.CERU_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' }), page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === base || url.hostname === '127.0.0.1' && url.port === String(server.address().port) ? route.continue() : route.abort() })
const check = (name, actual, expected = true) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); checks.push({ name, actual, expected, pass }); console.log(JSON.stringify(checks.at(-1))); assert.equal(pass, true, name) }
const libraryState = () => page.evaluate(() => JSON.stringify({ favorites: window.__syncLibrary.libraryState.favorites, playlists: window.__syncLibrary.libraryState.playlists }))
const shot = async name => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true }) }
let fatal
try {
  await page.goto(base + '/#/sync-services', { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: '连接你的 WebDAV' }).waitFor()
  check('sync page has no Ceru login prerequisite', await page.getByText('不要求澜音登录 · 首批仅手动安全备份与恢复', { exact: true }).count(), 1)
  check('web session memory warning is visible', await page.getByText(/Web 版凭据只保存在本次会话内存/).count(), 1)
  for (const name of ['S3', 'OneDrive', 'Google Drive']) check(name + ' explicitly not implemented', await page.getByText(name + '：尚未接入', { exact: true }).count(), 1)
  await shot('sync-services-entry-360x640')
  await page.evaluate(async () => { const view = await (await fetch('/src/views/SyncServices.vue')).text(); const web = view.match(/from\s*"([^"]+core\/sync\/webdav\.ts[^"]*)"/)[1]; const core = await (await fetch(web)).text(); const snapshot = core.match(/from\s*"([^"]+librarySnapshot\.ts[^"]*)"/)[1]; const source = await (await fetch(snapshot)).text(); const lib = source.match(/from\s*"([^"]+library\.ts[^"]*)"/)[1]; window.__syncLibrary = await import(lib); window.__syncLibrary.commitLibraryReplacement({ favorites: [], playlists: [{ id: 'qa-original', name: '同步测试歌单', tracks: [], createdAt: 1 }] }) })
  await page.getByLabel('名称', { exact: true }).fill('QA WebDAV'); await page.getByLabel('专用目录地址').fill('http://127.0.0.1:' + server.address().port + '/dav/'); await page.getByLabel('用户名', { exact: true }).fill('qa'); await page.getByLabel('密码 / 应用密码').fill('ui-only-password')
  check('save remains disabled before explicit scope consent', await page.getByRole('button', { name: '保存安全连接' }).isDisabled())
  await page.getByLabel('只授权此地址和目录').check(); await page.getByLabel('如使用 HTTP').check(); await page.getByRole('button', { name: '保存安全连接' }).click(); await page.getByRole('button', { name: '测试读写与 ETag' }).waitFor()
  check('password never enters localStorage', await page.evaluate(() => Object.values(localStorage).some(value => String(value).includes('ui-only-password'))), false)
  check('password input cleared after saving', await page.getByLabel('密码 / 应用密码').inputValue(), '')
  await page.getByRole('button', { name: '测试读写与 ETag' }).click(); await page.getByText(/真实 ETag 条件写验证通过/).waitFor()
  check('actual CORS HTTP test cleaned only probe files', [...data.keys()].some(name => name.includes('.ceru-test-')), false); check('unrelated remote file untouched', data.get('/dav/user-document.txt').body, 'never-delete')
  await page.getByRole('button', { name: '保存独立新备份' }).click(); await page.getByText('已生成独立新备份，不覆盖已有远端文件。', { exact: true }).waitFor()
  const backup = [...data.keys()].find(file => file.includes('.ceru-backup-')); check('actual remote white-list backup created', Boolean(backup)); check('remote snapshot contains no WebDAV password', data.get(backup).body.includes('ui-only-password'), false)
  await page.getByRole('button', { name: '列出备份', exact: true }).click(); await page.getByText('仅列出澜音专用备份文件。', { exact: true }).waitFor(); check('directory filters non-app files', await page.getByLabel('恢复文件').locator('option').allTextContents().then(names => names.includes('user-document.txt')), false)
  await page.evaluate(() => window.__syncLibrary.commitLibraryReplacement({ favorites: [], playlists: [{ id: 'qa-later', name: '后续本地歌单', tracks: [], createdAt: 2 }] })); const before = await libraryState()
  await page.getByRole('button', { name: '读取恢复预览' }).click(); await page.getByText('预览：尚未恢复', { exact: true }).waitFor(); check('real preview does not mutate local library', await libraryState(), before)
  await page.getByLabel('恢复文件').selectOption('.ceru-library-v1.json'); check('changing file invalidates stale preview', await page.locator('.sync-preview').count(), 0)
  await page.getByLabel('恢复文件').selectOption(path.basename(backup)); await page.getByRole('button', { name: '读取恢复预览' }).click(); await page.getByText('预览：尚未恢复', { exact: true }).waitFor(); await page.getByLabel('恢复方式').selectOption('replace'); await page.getByRole('button', { name: '确认恢复', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: '确认恢复', exact: true }).click(); await page.getByRole('button', { name: '撤销本次恢复' }).waitFor()
  check('restore uses real root atomic API', await page.evaluate(() => window.__syncLibrary.libraryState.playlists[0].name), '同步测试歌单'); await page.getByRole('button', { name: '撤销本次恢复' }).click(); await page.getByText('已撤销本次恢复。', { exact: true }).waitFor(); check('undo restores exact prior library', await libraryState(), before)
  await shot('sync-services-360x640'); check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
  const beforeReload = requests.length; await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: '测试读写与 ETag' }).click(); await page.getByText(/此连接的安全凭据不可用/).waitFor(); check('browser reload cannot silently reuse sensitive session', requests.length, beforeReload)
  check('sensitive credential absent from UI log/report storage', await page.evaluate(() => Object.values(localStorage).some(value => String(value).includes('ui-only-password'))), false)
  await shot('sync-services-session-expired'); check('no browser page errors', errors, [])
  await page.locator('.sync-services .scroll').evaluate(el => { el.scrollTop = 0 }); await shot('sync-services-session-expired-top')
} catch (error) { fatal = error.stack; console.error(fatal); await shot('sync-ui-failed').catch(() => {}) }
finally { await fs.writeFile(path.join(out, 'sync-ui-tests.json'), JSON.stringify({ command: 'node scripts/test-sync-ui.mjs', exitCode: fatal ? 1 : 0, scope: 'Actual Vue UI and genuine CORS loopback DAV HTTP; session-memory credentials only, no AndroidKeyStore or user NAS access', checks, requests, errors, fatal }, null, 2)); await browser.close(); await new Promise(resolve => server.close(resolve)); process.exitCode = fatal ? 1 : 0 }
