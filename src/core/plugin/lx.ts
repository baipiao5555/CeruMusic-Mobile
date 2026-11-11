import runtime from './lx-runtime.js?raw'
import type { SandboxArtifact } from './sandbox'
import { LX_SOURCE_NAMES } from './lx-catalog'

export function inspectLxPlugin(code: string): any | null {
  const header = code.match(/^\s*\/\*([\s\S]*?)\*\//)?.[1]
  if (!header || !/\blx\b/.test(code) || /\bexports\s*\.\s*manifest\s*=/.test(code)) return null
  const fields: Record<string, string> = {}
  for (const match of header.matchAll(/^\s*\*?\s*@(\w+)[ \t]+([^\r\n]*)/gm)) {
    fields[match[1]] = match[2].trim().slice(0, 1024)
  }
  if (!fields.name) return null
  return {
    format: 'lx',
    id: `lx:${fields.author ?? ''}:${fields.name}`,
    name: fields.name,
    version: fields.version || '1.0.0',
    author: fields.author || '',
    description: fields.description || '',
    homepage: fields.homepage || '',
    permissions: [{ key: 'network', name: 'network.request', reason: '访问音源服务与歌曲目录' }],
    contributes: { providers: [] }
  }
}

export function createLxArtifact(code: string, manifest: any): SandboxArtifact {
  return {
    header: {
      manifest: {
        ...manifest,
        modules: { logic: { entry: 'lx.logic' } },
        contributes: { commands: [{ id: 'lx-request', action: 'lx-request' }] }
      }
    },
    modules: {
      'lx.logic': `(core) => (${runtime})(core, ${JSON.stringify(code)}, ${JSON.stringify({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        homepage: manifest.homepage
      })})`
    },
    resources: {}
  }
}

export function lxProviders(sources: any): any[] {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return []
  return Object.entries(LX_SOURCE_NAMES).flatMap(([id, name]) => {
    const source = sources[id]
    if (source?.type !== 'music' || !Array.isArray(source.actions)) return []
    const actions = source.actions.filter((action: any) =>
      ['musicUrl', 'lyric', 'pic'].includes(action)
    )
    if (!actions.includes('musicUrl')) return []
    const qualities = Array.isArray(source.qualitys)
      ? [...new Set(source.qualitys.filter((item: any) => typeof item === 'string' && item.length <= 32))].slice(0, 32)
      : []
    if (!qualities.length) return []
    return [{
      id,
      name,
      qualities,
      protocols: ['http', 'https'],
      actions
    }]
  })
}

export function lxLyrics(value: any): any {
  if (Array.isArray(value?.lines)) return value
  const text = typeof value === 'string' ? value : value?.lyric ?? ''
  const parse = (input: string): Array<{ startTimeMs: number; text: string }> => {
    const result: Array<{ startTimeMs: number; text: string }> = []
    const offset = Number(input.match(/\[offset:([+-]?\d+)\]/i)?.[1]) || 0
    for (const row of input.split(/\r?\n/)) {
      const text = row.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim()
      if (!text) continue
      for (const match of row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) {
        result.push({
          startTimeMs: Math.max(0, Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000) + offset),
          text
        })
      }
    }
    return result.sort((a, b) => a.startTimeMs - b.startTimeMs)
  }
  const translations = new Map(
    parse(String(value?.tlyric ?? '')).map((line) => [line.startTimeMs, line.text])
  )
  return {
    lines: parse(String(text)).map((line) => ({
      ...line,
      translation: translations.get(line.startTimeMs)
    }))
  }
}
