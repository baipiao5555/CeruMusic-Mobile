import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
assert.equal(manifest.includes('澜音歌词共享'), true)
assert.equal(manifest.includes('澜音账号登录回调'), true)
assert.equal(manifest.includes('婢滈煶'), false, 'manifest still contains mojibake')

const webdav = readFileSync('src/core/sync/webdav.ts', 'utf8')
const media = readFileSync('src/core/sync/webdavMedia.ts', 'utf8')
const shared = readFileSync('src/core/sync/nativeHttp.ts', 'utf8')
assert.equal(webdav.includes("import { nativeSyncHttp as native } from './nativeHttp'"), true)
assert.equal(media.includes("import { nativeSyncHttp as native } from './nativeHttp'"), true)
const registrations = [webdav, media, shared]
  .flatMap(source => [...source.matchAll(/registerPlugin<[^>]+>\('SyncHttp'\)/g)])
assert.equal(registrations.length, 1, 'SyncHttp must have exactly one JS registration')

const cache = readFileSync('android/app/src/main/java/com/ceru/music/mobile/AudioCacheServer.java', 'utf8')
const safetyAt = cache.indexOf('NetworkSafety.validate(context, new URL(upstream))')
const cacheKeyAt = cache.indexOf('new File(dir, sha1(upstream)')
assert.ok(safetyAt > 0, 'audio cache proxy must validate upstream URLs')
assert.ok(safetyAt < cacheKeyAt, 'validation must happen before any upstream request or cache lookup')
assert.equal(cache.includes('writeError(out, 403'), true)
console.log('PASS manifest encoding, single SyncHttp registration, and audio cache upstream guard')
