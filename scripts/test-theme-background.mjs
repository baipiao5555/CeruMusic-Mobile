import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const product = 'D:/LX/CeruMusic-Mobile'
const evidence = 'D:/LX/CeruMusic-Mobile-账号主题与同步-2026-11-16/evidence'
const { build } = createRequire(product + '/package.json')('esbuild')
const bundled = await build({ absWorkingDir: product, entryPoints: ['src/core/themeBackground.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' })
const { inspectBackgroundFile, backgroundAppliesToRoute, themeBackgroundScene, themeBackgroundState, THEME_BACKGROUND_LIMITS } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const checks = []
function check(name, actual, expected = true) { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected, result: 'PASS' }); console.log(JSON.stringify(checks.at(-1))) }
async function reject(name, file, pattern) { await assert.rejects(inspectBackgroundFile(file), pattern); check(name, true) }
const png = await fs.readFile(evidence + '/theme-image.png')
const mp4 = await fs.readFile(evidence + '/theme-av.mp4')
const webm = await fs.readFile(evidence + '/theme-video.webm')
check('PNG magic/dimensions override misleading MIME', await inspectBackgroundFile(new Blob([png], { type: 'video/mp4' })), { kind: 'image', mime: 'image/png' })
check('H264/AAC container detected without filename extension', await inspectBackgroundFile(new Blob([mp4], { type: 'application/octet-stream' })), { kind: 'video', mime: 'video/mp4' })
check('WebM magic detected', await inspectBackgroundFile(new Blob([webm])), { kind: 'video', mime: 'video/webm' })
await reject('empty file rejected', new Blob([]), /为空/)
await reject('file bound checked before reading large data', { size: THEME_BACKGROUND_LIMITS.bytes + 1, slice() { throw new Error('Must not read oversize file') } }, /超限/)
const hugePng = Uint8Array.from(png)
new DataView(hugePng.buffer).setUint32(16, 200000)
await reject('PNG pixel bound checked before image decode', new Blob([hugePng]), /分辨率/)
await reject('SVG external/script surface refused', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script></svg>'], { type: 'image/svg+xml' }), /SVG/)
await reject('unknown executable content never trusted by MIME', new Blob(['not-an-image'], { type: 'image/png' }), /未识别/)
await reject('truncated JPEG rejected', new Blob([new Uint8Array([255, 216, 255, 0, 0])]), /JPEG/)
themeBackgroundState.config = { assetId: 'fixture', kind: 'image', mime: 'image/png', name: 'fixture', size: 1, width: 1, height: 1, duration: 0, mask: 0.6, blur: 0, dark: false, fit: 'cover', scope: 'main', motion: 'auto' }
themeBackgroundState.url = 'blob:fixture'
check('default main scope applies home', backgroundAppliesToRoute('/'))
check('default main scope preserves player cover', backgroundAppliesToRoute('/player', 'player'), false)
check('default main scope preserves full lyric cover', backgroundAppliesToRoute('/player', 'lyrics'), false)
themeBackgroundState.config.scope = 'player'
check('explicit player scope includes player', backgroundAppliesToRoute('/player', 'player'))
check('full lyrics inherit explicit player background', backgroundAppliesToRoute('/player', 'lyrics'))
check('player background does not leak to main', backgroundAppliesToRoute('/search', 'player'), false)
themeBackgroundState.config.scope = 'lyrics'
check('lyrics-only keeps main player cover', backgroundAppliesToRoute('/player', 'player'), false)
themeBackgroundScene.value = 'lyrics'
check('runtime scene enables lyrics-only without persistence', backgroundAppliesToRoute('/player'))
themeBackgroundState.config.scope = 'all'
check('explicit all scope includes home', backgroundAppliesToRoute('/'))
check('explicit all scope includes player', backgroundAppliesToRoute('/player'))
themeBackgroundState.url = ''
check('missing asset never claims active background', backgroundAppliesToRoute('/'), false)
const report = { result: 'PASS', checks, sourceSHA256: createHash('sha256').update(await fs.readFile(product + '/src/core/themeBackground.ts')).digest('hex'), scope: 'Pure file-sniff/size/pixel/scope checks; real media decode is covered by mounted browser tests.' }
await fs.writeFile(evidence + '/theme-background-unit.json', JSON.stringify(report, null, 2))
console.log('PASS ' + checks.length + ' background unit checks')
