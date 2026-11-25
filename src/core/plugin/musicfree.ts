import { parse } from 'acorn'
import snapshots from './musicfree-manifests.json'
import { installMusicFreeAdapter } from './musicfree-runtime'
import { lxLyrics } from './lx'
import { sha256Hex } from '../storage/idb'

export interface MusicFreeMetadata {
  file?: string; name: string; platform: string; version: string; author?: string; description?: string
  primaryKey?: string[]; supportedQualities?: string[]; keys: string[]
  userVariables?: Array<{ key: string; name?: string; defaultValue?: string | number | boolean }>
}
export const MUSICFREE_PREFIX = 'musicfree.hebijunge.'
export const musicFreeSnapshots = snapshots as Record<string, MusicFreeMetadata>
export function musicFreeSlug(file: string): string {
  return file.replace(/(?:\.plugin)?\.v[0-9.]+\.js$|-v[0-9.]+\.js$/i, '').replace(/-source$/, '')
}
export function musicFreeManifest(meta: MusicFreeMetadata): any {
  const slug = musicFreeSlug(meta.file || meta.platform.replace(/[^a-z0-9_-]/gi, '').toLowerCase())
  const config = Object.fromEntries((meta.userVariables || []).filter(item => typeof item.key === 'string').slice(0,80).map(item => [item.key, item.defaultValue ?? '']))
  const providerId = meta.platform.toLowerCase().match(/^[a-z][a-z0-9_-]{0,60}$/)?.[0] || slug
  return {
    manifestVersion:2, id:MUSICFREE_PREFIX+slug, name:meta.name || meta.platform, version:meta.version, ...(meta.author?{author:meta.author}:{}),
    description:meta.description || 'MusicFree 插件兼容适配', homepage:'https://github.com/hebijunge/musicfree-plugins',
    engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'}, modules:{logic:{entry:'logic.main'}},
    permissions:[{key:'network',name:'network.request',reason:'MusicFree 插件通过受限代理访问公开音源服务；不获得应用账号或本地文件权限'}],
    config,
    contributes:{
      providers:[{id:providerId,name:meta.name||meta.platform,protocols:['https'],qualities:meta.supportedQualities?.length?meta.supportedQualities:['128k','320k','flac']}],
      ...(meta.keys.includes('importMusicSheet') ? {playlistImporters:[{id:'mf-import',title:(meta.name||meta.platform)+'歌单导入',providerId}]} : {})
    }
  }
}

/** Standard exports can be read as syntax; unknown obfuscation is never executed during import. */
function staticMusicFreeMetadata(code: string): MusicFreeMetadata | null {
  try {
    const ast: any = parse(code,{ecmaVersion:'latest',sourceType:'script'})
    for (const statement of ast.body) {
      const expression=statement.type==='ExpressionStatement'?statement.expression:null
      if(expression?.type!=='AssignmentExpression'||expression.left.type!=='MemberExpression')continue
      if(expression.left.object?.name!=='module'||expression.left.property?.name!=='exports'||expression.right.type!=='ObjectExpression')continue
      const properties=expression.right.properties.filter((p:any)=>p.type==='Property'&&!p.computed)
      const key=(p:any)=>p.key.name||p.key.value
      const literal=(name:string)=>properties.find((p:any)=>key(p)===name)?.value
      const strings=(name:string)=>literal(name)?.type==='ArrayExpression'?literal(name).elements.filter((p:any)=>p?.type==='Literal'&&typeof p.value==='string').map((p:any)=>p.value):undefined
      const platform=literal('platform'),version=literal('version')
      if(platform?.type!=='Literal'||typeof platform.value!=='string'||version?.type!=='Literal'||typeof version.value!=='string')continue
      return {platform:platform.value,name:literal('name')?.value||platform.value,version:version.value,author:literal('author')?.value||'',description:literal('description')?.value||'',primaryKey:strings('primaryKey'),supportedQualities:strings('supportedQualities'),keys:properties.map(key)}
    }
  } catch {}
  return null
}

/** Last-resort metadata for an arbitrary online MusicFree file. It never executes
 * plugin code; name/version come from the file name and playback starts at 128k. */
export function musicFreeMetadataFromName(sourceName?: string): MusicFreeMetadata | null {
  if (!sourceName) return null
  let name = sourceName.split(/[?#]/)[0].split('/').pop() || ''
  try { name = decodeURIComponent(name) } catch {}
  if (!/\.js$/i.test(name)) return null
  const version = name.match(/(?:\.plugin)?\.v(\d+(?:\.\d+){0,3})\.js$/i)?.[1]
    || name.match(/-v(\d+(?:\.\d+){0,3})\.js$/i)?.[1]
    || '1.0.0'
  const slug = musicFreeSlug(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) return null
  const display: Record<string,string> = { qq:'QQ音乐', kuwo:'酷我音乐', kugou:'酷狗音乐', netease:'网易云音乐', migu:'咪咕音乐', qishui:'汽水音乐', bilibili:'B站', 'apple-music':'Apple Music', applemusic:'Apple Music' }
  return { name: display[slug] || slug, platform: slug, version, author: '在线导入', primaryKey: [], supportedQualities: ['128k'], keys: [] }
}

export async function adaptMusicFreeCode(code: string, known?: MusicFreeMetadata, sourceName?: string): Promise<string | null> {
  const meta=known || staticMusicFreeMetadata(code) || musicFreeMetadataFromName(sourceName)
  if(!meta)return null
  const manifest=musicFreeManifest(meta)
  if (!meta.file) manifest.id='musicfree.custom.'+(await sha256Hex(meta.platform+'\u0000'+(meta.author||''))).slice(0,32)
  return 'exports.manifest = '+JSON.stringify(manifest)+';\nexports.activate = function(core) { return ('+
    installMusicFreeAdapter.toString()+')(core,'+JSON.stringify(code)+','+JSON.stringify(manifest)+','+JSON.stringify(meta)+',('+lxLyrics.toString()+')); };\n'
}

/** Existing installations store the serialized adapter. Rebuild only our static wrapper,
 * without executing source, changing plugin identity, grants, config or stored bytes. */
export async function refreshMusicFreeAdapter(code: string, manifest: any): Promise<string> {
  if (!manifest.id?.startsWith('musicfree.')) return code
  let source: string | undefined
  try {
    const ast: any = parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
    for (const statement of ast.body) {
      const assignment = statement.type === 'ExpressionStatement' ? statement.expression : undefined
      const left = assignment?.left
      if (assignment?.type !== 'AssignmentExpression' || left?.object?.name !== 'exports' || left?.property?.name !== 'activate') continue
      const activation = assignment.right
      const call = activation.type === 'FunctionExpression' && activation.body.body[0]?.type === 'ReturnStatement' ? activation.body.body[0].argument : undefined
      if (call?.type === 'CallExpression' && call.callee?.type === 'FunctionExpression' && call.arguments[0]?.name === 'core' && typeof call.arguments[1]?.value === 'string') source = call.arguments[1].value
    }
  } catch { return code }
  if (source === undefined) return code
  const normalized = source.replace(/^\uFEFF/, '').trim()
  const updated = await adaptMusicFreeCode(normalized, musicFreeSnapshots[await sha256Hex(normalized)])
  if (!updated) return code
  const next = JSON.parse(updated.slice('exports.manifest = '.length, updated.indexOf(';\nexports.activate')))
  for (const key of ['id', 'version', 'permissions', 'contributes', 'config', 'engines', 'modules']) {
    if (JSON.stringify(next[key]) !== JSON.stringify(manifest[key])) throw new Error('MusicFree 兼容层更新不能改变插件声明：' + key)
  }
  return updated
}
