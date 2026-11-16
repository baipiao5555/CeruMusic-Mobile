import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const product = 'D:/LX/CeruMusic-Mobile'
const evidence = 'D:/LX/CeruMusic-Mobile-第一阶段与兼容修复-2026-11-16/evidence'
const baseline = process.argv.includes('--baseline')
const { chromium } = createRequire(product + '/package.json')('playwright-core')
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const checks = [], errors = [], requests = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => requests.push(request.url()))
await page.route('https://**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }))
// The app auto-installs its demo on an empty store; keep this case genuinely plugin-free.
await page.route('**/demo-plugin.js', route => route.fulfill({ status: 404, body: 'plugin-free test' }))
await page.addInitScript(() => {
  if (top !== window) return
  localStorage.setItem('ceru.update.v1', '{"autoCheck":false}')
  localStorage.setItem('ceru.settings.v1', '{"cloudLyrics":false,"pluginAutoUpdate":false,"logsEnabled":false}')
  localStorage.setItem('ceru.library.v1', '{"favorites":[],"playlists":[{"id":"original","name":"原有歌单","tracks":[],"createdAt":1}]}')
})
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected, result: 'PASS' }); console.log(JSON.stringify(checks.at(-1))) }
try {
  await page.goto('http://127.0.0.1:5197', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/library'))
  await page.locator('.playlist-actions').getByRole('button', { name: '导入歌单' }).click()
  check('no plugins installed', await page.evaluate(() => window.__ceruDebug.pluginState.plugins.length), 0)
  if (baseline) {
    check('baseline has no local file input', await page.locator('input[type=file]').count(), 0)
    check('baseline asks to install importer plugin', await page.locator('.imp-empty').textContent().then(text => text.includes('当前没有插件')), true)
    await page.screenshot({ path: evidence + '/file-import-before.png' })
  } else {
    check('file tab reachable without plugin', await page.getByRole('button', { name: '本地文件', exact: true }).count(), 1)
    const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1')))
    const reactiveSnapshot = () => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('.file-body').__vueParentComponent.setupState.libraryState)))
    const upload = async file => {
      await page.locator('input[type=file]').setInputFiles(evidence + '/file-import-fixtures/' + file)
      await page.waitForFunction(() => document.querySelector('.file-picker')?.textContent.includes('选择歌单文件'))
    }
    await page.evaluate(() => {
      window.__libraryWrites = []
      const save = Storage.prototype.setItem
      window.__originalSetItem = save
      Storage.prototype.setItem = function (key, value) {
        if (key === 'ceru.library.v1') {
          if (window.__failLibrary) throw new DOMException('fixture quota full', 'QuotaExceededError')
          window.__libraryWrites.push({ before: JSON.parse(JSON.stringify(document.querySelector('.file-body').__vueParentComponent.setupState.libraryState)), next: JSON.parse(value) })
        }
        return save.call(this, key, value)
      }
    })
    const original = await snapshot()
    await upload('all-v2.lxmc')
    check('all-file preview shows both playlists', await page.locator('.file-drafts input').count(), 2)
    check('preview counts visible and honest', await page.locator('.file-counts').textContent().then(text => /6 首有效.*1 条无效.*1 条重复.*6 首待匹配/.test(text)), true)
    check('preview does not write library', await snapshot(), original)
    await page.locator('.file-drafts input').nth(1).uncheck()
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByText('导入完成', { exact: true }).waitFor()
    let saved = await snapshot()
    check('only selected draft committed', saved.playlists.map(item => item.name), ['LX 单歌单样本', '原有歌单'])
    check('new playlist UUID not external ID', saved.playlists[0].id !== 'external-list-1', true)
    check('external playlist ID preserved only as origin', saved.playlists[0].origin.externalId, 'external-list-1')
    check('all parsed tracks retained without plugins', saved.playlists[0].tracks.length, 6)
    check('one atomic persistence write', await page.evaluate(() => window.__libraryWrites.length), 1)
    check('reactive state changes only after persistence', await page.evaluate(() => window.__libraryWrites[0].before.playlists.map(item => item.name)), ['原有歌单'])
    check('reactive library matches persisted snapshot', await reactiveSnapshot(), saved)
    await page.screenshot({ path: evidence + '/file-import-report.png' })
    await page.getByRole('button', { name: '撤销本次导入', exact: true }).click()
    check('undo restores original persisted library', await snapshot(), original)
    check('undo restores original reactive library', await reactiveSnapshot(), original)
    await page.evaluate(() => { window.__libraryWrites = []; window.__failLibrary = true })
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.waitForTimeout(100)
    console.log('storage failure diagnostic', await page.evaluate(() => ({ error: document.querySelector('.file-body')?.__vueParentComponent.setupState.fileError, fail: window.__failLibrary, reports: document.querySelectorAll('.file-report').length, sheet: !!document.querySelector('.file-body') })))
    await page.getByRole('alert').filter({ hasText: '导入未完成' }).waitFor()
    check('storage failure preserves persisted data', await snapshot(), original)
    check('storage failure preserves reactive data', await reactiveSnapshot(), original)
    check('storage failure never reports success', await page.getByText('导入完成', { exact: true }).count(), 0)
    await page.evaluate(() => { window.__failLibrary = false })
    // Gzip fallback with feature absent, including actual file input and lazy fflate import.
    await page.evaluate(() => { window.__nativeDecompress = window.DecompressionStream; window.DecompressionStream = undefined })
    await upload('single-v2.lxmc')
    check('no DecompressionStream browser fallback parses file', await page.locator('.file-drafts input').count(), 1)
    await page.evaluate(() => { window.DecompressionStream = window.__nativeDecompress })
    await page.locator('#file-mode').selectOption('merge')
    await page.locator('#file-target').selectOption('original')
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByText('导入完成', { exact: true }).waitFor()
    saved = await snapshot()
    check('merge imports into selected target only', saved.playlists.map(item => [item.id, item.tracks.length]), [['original', 6]])
    await upload('single-v2.lxmc')
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByText('导入完成', { exact: true }).waitFor()
    check('merge duplicate source identity skipped, unknown identities retained', (await snapshot()).playlists[0].tracks.length, 8)
    check('merge reports skipped count', await page.locator('.file-report').textContent().then(text => text.includes('跳过 4 首')), true)
    await page.getByRole('button', { name: '撤销本次导入', exact: true }).click()
    check('merge undo restores target order/count', (await snapshot()).playlists[0].tracks.length, 6)
    await upload('legacy-double.json')
    check('browser legacy double JSON preview', await page.locator('.file-format').textContent().then(text => text.includes('二次序列化')), true)
    await page.locator('#file-mode').selectOption('replace')
    const beforeReplace = await snapshot()
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByRole('alertdialog', { name: '替换原有歌单？' }).waitFor()
    check('replace waits for separate danger confirmation', await snapshot(), beforeReplace)
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
    check('cancel replacement changes nothing', await snapshot(), beforeReplace)
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认替换', exact: true }).click()
    await page.getByText('导入完成', { exact: true }).waitFor()
    check('confirmed replace truly updates target', (await snapshot()).playlists[0].tracks.map(item => item.title), ['旧版QQ'])
    // Exercise the real mounted library delete action/API while the import report stays open.
    await page.evaluate(() => {
      const library = document.querySelector('.library-screen').__vueParentComponent.setupState
      void library.removePlaylist(library.playlists[0])
    })
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
    const changed = await snapshot()
    await page.getByRole('button', { name: '撤销本次导入', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '其他改动' }).waitFor()
    check('undo refuses intervening real API edit', await snapshot(), changed)
    await upload('invalid.json')
    await page.getByRole('alert').filter({ hasText: '有效 JSON' }).waitFor()
    check('corrupt file does not write', await snapshot(), changed)
    check('corrupt file has no stale commit button', await page.getByRole('button', { name: '确认导入', exact: true }).isDisabled(), true)
    await page.locator('input[type=file]').setInputFiles({ name: 'oversize.json', mimeType: 'application/json', buffer: Buffer.alloc(8 * 1024 * 1024 + 1, 32) })
    await page.getByRole('alert').filter({ hasText: '文件大小超限' }).waitFor()
    check('oversize file does not write', await snapshot(), changed)
    await page.locator('input[type=file]').setInputFiles({ name: 'desktop.cpl', mimeType: 'text/plain', buffer: Buffer.from('U2FsdGVkX18abc') })
    await page.getByRole('alert').filter({ hasText: '尚未支持' }).waitFor()
    check('AES input clearly unsupported and unchanged', await snapshot(), changed)
    await upload('all-v2.lxmc')
    await page.locator('#file-mode').selectOption('new')
    await page.waitForTimeout(50)
    check('valid preview can still commit after errors', await page.getByRole('button', { name: '确认导入', exact: true }).isEnabled(), true)
    await page.screenshot({ path: evidence + '/file-import-preview.png' })
    const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    check('mobile preview has no horizontal overflow', horizontal, false)
    check('no music download/resolve fetch during file import', requests.filter(url => /musicUrl|audio\.wav|\/download\//.test(url)).length, 0)
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    const importer = `exports.manifest={manifestVersion:2,id:'ceru.phase1.import.fixture',name:'导入回归音源',version:'1.0.0',engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'}},contributes:{providers:[{id:'import-fixture',name:'导入测试',protocols:['https'],qualities:['128k']}],playlistImporters:[{id:'test',title:'回归歌单导入',providerId:'import-fixture'}]}};
exports.activate=core=>{core.providers.register('import-fixture',{tracks:{search:async()=>({items:[]}),resolve:async()=>({ok:false,error:{message:'fixture does not play'}})}});core.playlistImporters.register('test',{getTracks:async request=>({name:'平台链接回归样本',items:[{ref:{providerId:'import-fixture',kind:'track',scope:'provider',id:'page'+(request.cursor||'1')},title:'平台导入歌曲',capabilities:['play'],metadata:{artists:['测试歌手'],qualities:['128k']}}],...(request.cursor?{}:{nextCursor:'2'})})})};`
    await page.evaluate(async source => { await window.__ceruDebug.installPlugin(source, { enable: true, grantDeclared: true }) }, importer)
    await page.locator('.playlist-actions').getByRole('button', { name: '导入歌单' }).click()
    check('platform importer remains available beside file tab', await page.locator('#imp-value').count(), 1)
    await page.locator('#imp-value').fill('https://playlist.fixture.test/list/1')
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await page.waitForFunction(() => location.hash.startsWith('#/playlist/') && !document.querySelector('.imp-tabs'))
    saved = await snapshot()
    check('existing plugin paging/import/navigation preserved', [saved.playlists[0].name, saved.playlists[0].tracks.length, saved.playlists[0].tracks.map(item => item.id)], ['平台链接回归样本', 2, ['page1', 'page2']])
    const lxFixture = `/**
 * @name Phase1 LX file import fixture
 * @version 1.0.0
 * @author Ceru test
 */
const {EVENT_NAMES,on,send}=globalThis.lx;
on(EVENT_NAMES.request,({source,action,info})=>{if(source!=='kw'||action!=='musicUrl'||info.musicInfo.songmid!=='101')throw new Error('LX import provider identity lost');return 'https://playlist.fixture.test/portable-id-101.mp3'});
send(EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`
    await page.evaluate(async source => { await window.__ceruDebug.installPlugin(source, { enable: true, grantDeclared: true }) }, lxFixture)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/library'))
    await page.locator('.playlist-actions').getByRole('button', { name: '导入歌单' }).click()
    await page.getByRole('button', { name: '本地文件', exact: true }).click()
    await upload('single-v2.lxmc')
    check('installed LX source binds only matching platforms', await page.locator('.file-counts').textContent().then(text => text.includes('4 首待匹配')), true)
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByText('导入完成', { exact: true }).waitFor()
    saved = await snapshot()
    check('matched imported reference uses running LX provider', [saved.playlists[0].tracks[0].providerId, saved.playlists[0].tracks[0].ref.data.lxMusicInfo.songmid], ['kw', '101'])
    check('nonmatching platforms stay pending', saved.playlists[0].tracks[1].providerId, 'lx-pending:kg')
    const resolved = await page.evaluate(async track => {
      const provider = window.__ceruDebug.allProviders().find(item => item.providerId === 'kw' && item.pluginId === track.pluginId)
      return window.__ceruDebug.invokeProvider(provider, 'tracks.resolve', [track.ref, '128k'])
    }, saved.playlists[0].tracks[0])
    check('real LX bridge resolves imported platform ID without internal ID', [resolved.ok, resolved.url], [true, 'https://playlist.fixture.test/portable-id-101.mp3'])
    check('mounted app has no page errors', errors, [])
  }
} finally {
  await page.screenshot({ path: evidence + '/file-import-' + (baseline ? 'baseline' : 'modified') + '-last.png' })
  const source = await fs.readFile(product + '/src/components/ImportPlaylistSheet.vue')
  const report = { phase: baseline ? 'baseline' : 'modified', checks, errors, sourceSHA256: createHash('sha256').update(source).digest('hex'), parserSHA256: baseline ? undefined : createHash('sha256').update(await fs.readFile(product + '/src/core/playlistFile.ts')).digest('hex'), librarySHA256: createHash('sha256').update(await fs.readFile(product + '/src/core/library.ts')).digest('hex'), requests, scope: 'Mounted Vue router and actual commit API; generated/export-shaped fixtures only; feature-absent simulation is not Android or actual Chrome99.' }
  await fs.writeFile(evidence + '/file-import-' + (baseline ? 'baseline' : 'modified') + '.json', JSON.stringify(report, null, 2))
  await browser.close()
}
