import type { Track } from './track'
import type { PlaylistImportDraft } from './library'

export const PLAYLIST_FILE_LIMITS = {
  inputBytes: 8 * 1024 * 1024,
  decodedBytes: 32 * 1024 * 1024,
  playlists: 500,
  tracks: 20000,
  depth: 32,
  nodes: 600000
} as const

export interface FilePlaylistProvider {
  providerId: string
  pluginId: string
  pluginName: string
  format?: string
}

export interface PlaylistFilePreview {
  format: string
  drafts: PlaylistImportDraft[]
  counts: { records: number; tracks: number; invalid: number; duplicates: number; pending: number; invalidPlaylists: number }
  warnings: string[]
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function text(value: unknown, max = 512): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function identifier(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value, 256)
}

function scalarId(value: unknown): string | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : identifier(value)
}

function artwork(value: unknown): string {
  try {
    const url = new URL(text(value, 2048))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    // Portable references must not carry signed query strings or credentials.
    url.search = ''; url.hash = ''
    return url.href
  } catch { return '' }
}

function boundedJSON(input: string): unknown {
  // Reject deep nesting before JSON.parse allocates a deep object tree.
  let depth = 0, quoted = false, escape = false
  for (const char of input) {
    if (quoted) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') {
      if (++depth > PLAYLIST_FILE_LIMITS.depth) throw new Error('文件嵌套超限（最多 32 层）')
    } else if (char === '}' || char === ']') depth--
  }
  let result: unknown
  try { result = JSON.parse(input) } catch { throw new Error('文件不是有效 JSON，可能已损坏') }
  const stack = [result]
  let nodes = 0
  while (stack.length) {
    const value = stack.pop()
    if (++nodes > PLAYLIST_FILE_LIMITS.nodes) throw new Error('文件字段数量超限')
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) {
        if (stack.length + nodes >= PLAYLIST_FILE_LIMITS.nodes) throw new Error('文件字段数量超限')
        stack.push(child)
      }
    }
  }
  return result
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : (n >>> 1)
  return n >>> 0
})

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  if (input.length < 18 || input[2] !== 8 || (input[3] & 0xe0)) throw new Error('gzip 文件头损坏')
  const trailer = new DataView(input.buffer, input.byteOffset + input.length - 8, 8)
  const expectedLength = trailer.getUint32(4, true)
  if (expectedLength > PLAYLIST_FILE_LIMITS.decodedBytes) throw new Error('解压大小超限（最多 32 MB）')
  const chunks: Uint8Array[] = []
  let size = 0, crc = 0xffffffff
  const append = (chunk: Uint8Array) => {
    size += chunk.byteLength
    if (size > PLAYLIST_FILE_LIMITS.decodedBytes) throw new Error('解压大小超限（最多 32 MB）')
    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    chunks.push(chunk)
  }
  try {
    if (typeof DecompressionStream === 'function') {
      const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          append(value)
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error }
      finally { reader.releaseLock() }
    } else {
      // Chrome 99 has no DecompressionStream. Reuse the installed decoder; 1 KB
      // input chunks bound each inflation allocation, not just the final result.
      const { Gunzip } = await import('fflate')
      const decoder = new Gunzip(append)
      decoder.onmember = () => { throw new Error('不支持多段 gzip，请重新导出 LX 歌单') }
      for (let offset = 0; offset < input.length; offset += 1024) {
        decoder.push(input.subarray(offset, offset + 1024), offset + 1024 >= input.length)
      }
    }
  } catch (error) {
    if (error instanceof Error && /超限|多段/.test(error.message)) throw error
    throw new Error('gzip 解压失败，文件可能损坏或不完整')
  }
  if (size !== expectedLength || ((crc ^ 0xffffffff) >>> 0) !== trailer.getUint32(0, true)) {
    throw new Error('gzip 大小或 CRC 校验失败，文件已损坏')
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}

function qualityInfo(raw: Record<string, any>): { types: any[]; _types: Record<string, any> } {
  const details: Record<string, any> = {}
  const entries = Array.isArray(raw.qualitys ?? raw.types) ? (raw.qualitys ?? raw.types).slice(0, 32) : []
  for (const [type, value] of Object.entries(object(raw._qualitys ?? raw._types)).slice(0, 32)) {
    entries.push({ ...object(value), type })
  }
  for (const entry of entries) {
    const value = object(entry)
    let type = text(typeof entry === 'string' ? entry : value.type, 32)
    if (type === 'flac32bit') type = 'flac24bit'
    if (!['128k', '192k', '320k', 'flac', 'flac24bit', 'wav', 'ape'].includes(type)) continue
    details[type] = {
      ...(details[type] ?? {}),
      ...(text(value.size, 32) ? { size: text(value.size, 32) } : {}),
      ...(identifier(value.hash) ? { hash: identifier(value.hash) } : {})
    }
  }
  return { types: Object.entries(details).map(([type, value]) => ({ type, ...value })), _types: details }
}

function normalizeTrack(value: unknown, v2: boolean, providers: FilePlaylistProvider[]): Track | null {
  const raw = object(value), source = text(raw.source, 32), name = text(raw.name)
  if (!source || !name) return null
  const meta = v2 ? object(raw.meta) : raw
  // LX v2 internal raw.id is NOT a provider song ID. See LX toOldMusicInfo.
  const songmidValue = scalarId(v2 ? meta.songId : raw.songmid)
  const songmid = identifier(songmidValue)
  const hash = identifier(meta.hash)
  const platformId = source === 'kg' ? hash : songmid
  const knownSource = ['kw', 'kg', 'tx', 'wy', 'mg'].includes(source)
  const local = source === 'local'
  const provider = knownSource && platformId ? providers.find(item => item.format === 'lx' && item.providerId === source) : undefined
  const pending = local ? 'local-file' : !platformId ? 'identity' : !provider ? 'source' : ''
  const providerId = provider ? source : 'lx-pending:' + source
  const id = !local && platformId ? platformId : crypto.randomUUID()
  const qualities = qualityInfo(meta)
  const interval = text(raw.interval, 32)
  const parts = interval.split(':').map(Number)
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0
  const musicInfo: Record<string, any> = {
    source, name, singer: text(raw.singer), songmid: local ? '' : songmidValue,
    id: local ? '' : songmidValue, interval, albumName: text(v2 ? meta.albumName : raw.albumName),
    albumId: scalarId(meta.albumId), img: artwork(v2 ? meta.picUrl : raw.img),
    types: qualities.types, _types: qualities._types, typeUrl: {}
  }
  if (source === 'kg') musicInfo.hash = hash
  if (source === 'tx') {
    musicInfo.songId = scalarId(v2 ? meta.id : raw.songId)
    musicInfo.strMediaMid = identifier(meta.strMediaMid)
    musicInfo.albumMid = identifier(meta.albumMid)
  }
  if (source === 'mg') musicInfo.copyrightId = identifier(meta.copyrightId)
  // Paths are metadata for later user matching, never Android MediaStore IDs.
  const localFile: Record<string, string> = local ? { fileName: text(meta.filePath ?? meta.songId ?? raw.filePath ?? raw.songmid, 2048).split(/[\\/]/).pop() ?? '', ext: text(meta.ext, 16) } : {}
  return {
    id, providerId, pluginId: provider?.pluginId ?? '', providerName: provider?.pluginName ?? (local ? '待匹配本机文件' : '待选择音源'),
    title: name, artist: musicInfo.singer || '未知歌手', album: musicInfo.albumName,
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 86400000) : 0,
    artwork: musicInfo.img || '/default-cover.png', qualities: qualities.types.map(item => item.type),
    ref: {
      id, kind: 'track', scope: 'provider', providerId,
      ...(provider ? { pluginId: provider.pluginId } : {}),
      data: { lxMusicInfo: musicInfo, fileImport: { format: 'lx', source, pending, ...(platformId && !local ? { identity: platformId } : {}), ...localFile } }
    }
  }
}

/** Offline only: detect bytes/schema, extract playlist fields, never install scripts. */
export async function parsePlaylistFile(input: Uint8Array, providers: FilePlaylistProvider[] = []): Promise<PlaylistFilePreview> {
  if (!input.length) throw new Error('文件为空')
  if (input.byteLength > PLAYLIST_FILE_LIMITS.inputBytes) throw new Error('文件大小超限（最多 8 MB）')
  const compressed = input[0] === 0x1f && input[1] === 0x8b
  const bytes = compressed ? await gunzip(input) : input
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim() }
  catch { throw new Error('文件编码无效，应为 UTF-8 JSON') }
  if (/^U2FsdGVkX1/.test(content)) throw new Error('已识别澜音 AES 歌单（.cpl/.cmpl），本阶段尚未支持；请使用 LX .lxmc/.json')
  let payload = boundedJSON(content), doubleJSON = false
  if (typeof payload === 'string') { payload = boundedJSON(payload); doubleJSON = true }
  const root = object(payload), type = text(root.type, 64)
  if ('version' in root && ![1, 2, '1', '2'].includes(root.version)) throw new Error('未支持的歌单版本')
  let lists: unknown[]
  switch (type) {
    case 'playListPart': case 'playListPart_v2': case 'defautlList': lists = [root.data]; break
    case 'playList': case 'playList_v2': lists = root.data; break
    case 'allData': lists = root.defaultList ? [root.defaultList] : root.playList; break
    case 'allData_v2': lists = root.playList; break
    default: throw new Error('未识别的歌单格式；仅支持 LX 歌单和备份中的歌单部分')
  }
  if (!Array.isArray(lists)) throw new Error('LX 歌单结构损坏：缺少列表数组')
  if (lists.length > PLAYLIST_FILE_LIMITS.playlists) throw new Error('歌单数量超限（最多 500 个）')
  const counts = { records: 0, tracks: 0, invalid: 0, duplicates: 0, pending: 0, invalidPlaylists: 0 }
  const format = `LX ${type} · ${compressed ? 'gzip JSON' : 'JSON'}${doubleJSON ? ' · 旧版二次序列化' : ''}`
  const drafts: PlaylistImportDraft[] = []
  for (const value of lists) {
    const list = object(value)
    if (!Array.isArray(list.list)) { counts.invalidPlaylists++; continue }
    counts.records += list.list.length
    if (counts.records > PLAYLIST_FILE_LIMITS.tracks) throw new Error('曲目数量超限（最多 20000 条）')
    const tracks: Track[] = [], seen = new Set<string>()
    for (const value of list.list) {
      const track = normalizeTrack(value, type.endsWith('_v2'), providers)
      if (!track) { counts.invalid++; continue }
      const data = object(track.ref.data?.fileImport)
      const key = data.identity ? data.source + ':' + data.identity : ''
      if (key && seen.has(key)) { counts.duplicates++; continue }
      if (key) seen.add(key)
      if (data.pending) counts.pending++
      tracks.push(track); counts.tracks++
    }
    drafts.push({
      name: text(list.name, 200) || (type === 'defautlList' ? '默认歌单' : '导入歌单'), tracks,
      ...(text(list.description, 2000) ? { description: text(list.description, 2000) } : {}),
      ...(artwork(list.cover) ? { cover: artwork(list.cover) } : {}),
      origin: { type: 'file', format, ...(identifier(list.id) ? { externalId: identifier(list.id) } : {}) }
    })
  }
  if (!drafts.length) throw new Error('没有有效歌单，未修改本地音乐库')
  const warnings = ['仅导入歌单元数据；不会下载或复制音乐，不导入设置、脚本和账号。']
  if (counts.pending) warnings.push('待匹配曲目已保留：音源不匹配或缺少平台 ID 时不会绑定其他插件；本机文件需重新扫描匹配。')
  if (counts.invalid || counts.invalidPlaylists) warnings.push('部分记录无效，确认导入将只保留预览中的有效项。')
  return { format, drafts, counts, warnings }
}
