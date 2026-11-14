import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 播放缓存（Android）。
 *
 * 原生起一个只监听 127.0.0.1 的小型 HTTP 代理：第一次播放某个音频地址时，
 * 数据一边回给播放器一边写进 cacheDir/audio，整首放完就落成完整文件；
 * 之后再播同一个地址直接读本地，不再产生任何流量。
 *
 * 网页环境没有这个服务，cachedAudioUrl() 原样返回，不影响调试。
 */
interface AudioCacheNative {
  start(): Promise<{ port: number; token: string }>
  size(): Promise<{ bytes: number }>
  clear(): Promise<{ bytes: number }>
}

const NativeAudioCache = registerPlugin<AudioCacheNative>('AudioCache')

interface Endpoint {
  base: string
  token: string
}

let endpoint: Endpoint | null = null
let starting: Promise<Endpoint | null> | null = null

async function ensureEndpoint(): Promise<Endpoint | null> {
  if (endpoint) return endpoint
  if (!Capacitor.isNativePlatform()) return null
  if (!starting) {
    starting = NativeAudioCache.start()
      .then((result) => {
        endpoint = { base: `http://127.0.0.1:${result.port}`, token: result.token }
        return endpoint
      })
      .catch(() => null)
      .finally(() => {
        starting = null
      })
  }
  return starting
}

/** 从地址里猜音频扩展名，缓存的本地文件没有后缀，靠它回正确的 Content-Type。 */
function extensionOf(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  const match = path.match(/\.(flac|m4a|aac|mp4|ogg|opus|wav|mp3)$/i)
  return match ? match[1].toLowerCase() : ''
}

/** 把远程音频地址换成本机缓存代理地址；不可用时原样返回。 */
export async function cachedAudioUrl(url: string): Promise<string> {
  if (!url || !/^https?:/i.test(url)) return url
  const target = await ensureEndpoint()
  if (!target) return url
  const ext = extensionOf(url)
  const suffix = ext ? `&x=${ext}` : ''
  return `${target.base}/cache?t=${target.token}&u=${encodeURIComponent(url)}${suffix}`
}

/**
 * 本机音乐的播放地址：交给同一个本机服务按 MediaStore id 直出，
 * 支持 Range（拖进度），也不会复制文件。
 */
export async function localAudioUrl(id: string): Promise<string> {
  const target = await ensureEndpoint()
  if (!target) return ''
  return `${target.base}/local?t=${target.token}&id=${encodeURIComponent(id)}`
}

export async function audioCacheSize(): Promise<number> {  if (!Capacitor.isNativePlatform()) return 0
  try {
    const result = await NativeAudioCache.size()
    return Number(result?.bytes) || 0
  } catch {
    return 0
  }
}

export async function clearAudioCache(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await NativeAudioCache.clear()
  } catch {
    /* 缓存清不掉不影响播放 */
  }
}
