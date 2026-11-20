import { sha256Hex } from '../storage/idb'
import { knownCatalogManifests } from './catalogManifests'

/** No code runs during import preparation. Only this exact, verified snapshot gets a static header. */
export async function normalizeKnownPluginCode(input: string): Promise<string> {
  const code = input.replace(/^\uFEFF/, '').trim()
  const manifest = knownCatalogManifests[await sha256Hex(code)]
  if (!manifest) return input
  return 'exports.manifest = ' + JSON.stringify(manifest) + ';\n' +
    'exports.activate = function(core) {\nvar compatExports = {}; var compatModule = { exports: compatExports };\n' +
    '(function(exports, module) {\n' + code + '\n})(compatExports, compatModule);\n' +
    'var activate = compatModule.exports.activate || compatExports.activate;\n' +
    'if (typeof activate !== "function") throw new Error("插件缺少 activate");\nreturn activate(core);\n};\n'
}
