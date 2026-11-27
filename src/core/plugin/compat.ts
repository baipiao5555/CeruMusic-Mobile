import { sha256Hex } from '../storage/idb'
import { knownCatalogManifests } from './catalogManifests'
import { adaptMusicFreeCode, musicFreeSnapshots } from './musicfree'
import { inspectLxPlugin } from './lx'

/** No code runs during import preparation. Only this exact, verified snapshot gets a static header. */
export async function normalizeKnownPluginCode(input: string, sourceName?: string): Promise<string> {
  const code = input.replace(/^\uFEFF/, '').trim()
  const hash = await sha256Hex(code)
  const knownMusicFree = musicFreeSnapshots[hash]
  if (knownMusicFree) return (await adaptMusicFreeCode(code, knownMusicFree, sourceName))!
  const manifest = knownCatalogManifests[hash]
  if (manifest) {
    return 'exports.manifest = ' + JSON.stringify(manifest) + ';\n' +
      'exports.activate = function(core) {\nvar compatExports = {}; var compatModule = { exports: compatExports };\n' +
      '(function(exports, module) {\n' + code + '\n})(compatExports, compatModule);\n' +
      'var activate = compatModule.exports.activate || compatExports.activate;\n' +
      'if (typeof activate !== "function") throw new Error("插件缺少 activate");\nreturn activate(core);\n};\n'
  }
  // A Ceru v2 or LX file must never be reinterpreted as an unknown MusicFree
  // script merely because its URL ends in .js. That previously replaced the
  // declared ID and version before the market's identity check ran.
  const declaredCeru = /\bexports\s*\.\s*manifest\s*=/.test(code)
  const declaredLx = Boolean(inspectLxPlugin(code))
  const repositoryCeru = /(?:^|\/)ceru-plugins\/[\w.-]+\.ceru\.js(?:[?#]|$)/.test(sourceName || '')
  if (declaredCeru || declaredLx || repositoryCeru) return input
  const musicFree = await adaptMusicFreeCode(code, undefined, sourceName)
  return musicFree || input
}
