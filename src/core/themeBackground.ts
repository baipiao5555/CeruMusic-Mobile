import { nextTick, reactive, ref } from 'vue'
import { idb } from './storage/idb'
import { randomUUID } from '../shims/crypto'

export type ThemeBackgroundScene = 'main' | 'player' | 'lyrics'
export type ThemeBackgroundScope = 'main' | 'player' | 'lyrics' | 'all'
export interface ThemeBackgroundConfig {
  assetId: string
  kind: 'image' | 'video'
  mime: string
  name: string
  size: number
  width: number
  height: number
  duration: number
  mask: number
  blur: number
  dark: boolean
  fit: 'cover' | 'contain'
  scope: ThemeBackgroundScope
  motion: 'auto' | 'poster'
}
interface BackgroundRecord { version: 1; config: ThemeBackgroundConfig; blob: Blob; poster: Blob | null }
interface BackgroundAsset { blob: Blob; poster: Blob | null; url: string; posterUrl: string; mime: string; kind: 'image' | 'video'; width: number; height: number; duration: number }

export const THEME_BACKGROUND_KEY = 'theme.background.v1'
export const THEME_BACKGROUND_LIMITS = { bytes: 256 * 1024 * 1024, pixels: 32_000_000, probeMs: 20000 } as const
export const themeBackgroundScene = ref<ThemeBackgroundScene>('main')
export const themeBackgroundState = reactive({ initialized: false, saving: false, probing: false, playbackUnavailable: false, error: '', config: null as ThemeBackgroundConfig | null, url: '', posterUrl: '' })
let currentBlob: Blob | null = null
let currentPoster: Blob | null = null
let restoring: Promise<void> | null = null
let generation = 0
let cancelProbe: (() => void) | null = null

function textAt(bytes: Uint8Array, start: number, length: number): string { return String.fromCharCode(...bytes.subarray(start, start + length)) }
function dimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > THEME_BACKGROUND_LIMITS.pixels) throw new Error('图片/视频分辨率无效或超限（最多 3200 万像素）')
}

/** Sniff a bounded header, never expand an entire video into JS/base64. */
export async function inspectBackgroundFile(file: Blob): Promise<{ kind: 'image' | 'video'; mime: string }> {
  if (!file.size) throw new Error('背景文件为空')
  if (file.size > THEME_BACKGROUND_LIMITS.bytes) throw new Error('背景文件超限（最多 256 MB）；请压缩后重试')
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && textAt(bytes, 1, 3) === 'PNG' && bytes[0] === 137) {
    dimensions(view.getUint32(16), view.getUint32(20)); return { kind: 'image', mime: 'image/png' }
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 255) { offset++; continue }
      const marker = bytes[offset + 1]
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        dimensions(view.getUint16(offset + 7), view.getUint16(offset + 5)); return { kind: 'image', mime: 'image/jpeg' }
      }
      const length = view.getUint16(offset + 2)
      if (length < 2) break
      offset += length + 2
    }
    throw new Error('JPEG 图片头损坏或无法安全读取尺寸，请重新导出图片')
  }
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(textAt(bytes, 0, 6))) {
    dimensions(view.getUint16(6, true), view.getUint16(8, true)); return { kind: 'image', mime: 'image/gif' }
  }
  if (bytes.length >= 30 && textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP') {
    const format = textAt(bytes, 12, 4)
    if (format === 'VP8X') dimensions(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16))
    else if (format === 'VP8L') dimensions(1 + bytes[21] + ((bytes[22] & 63) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10))
    else if (format === 'VP8 ') dimensions(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383)
    else throw new Error('无法安全识别 WebP 图片尺寸')
    return { kind: 'image', mime: 'image/webp' }
  }
  if (bytes.length >= 26 && textAt(bytes, 0, 2) === 'BM') {
    dimensions(view.getInt32(18, true), Math.abs(view.getInt32(22, true))); return { kind: 'image', mime: 'image/bmp' }
  }
  if (bytes.length >= 16 && textAt(bytes, 4, 4) === 'ftyp') {
    const brand = textAt(bytes, 8, 4)
    if (['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1'].includes(brand)) {
      let found = false
      for (let offset = 0; offset + 16 <= bytes.length; offset++) {
        if (textAt(bytes, offset, 4) === 'ispe') { dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12)); found = true; break }
      }
      if (!found) throw new Error('无法安全读取 AVIF/HEIC 尺寸，请转换为 PNG/JPEG')
      return { kind: 'image', mime: ['avif', 'avis'].includes(brand) ? 'image/avif' : 'image/heic' }
    }
    return { kind: 'video', mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' }
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: 'video', mime: textAt(bytes, 0, Math.min(bytes.length, 4096)).includes('webm') ? 'video/webm' : 'video/x-matroska' }
  }
  if (/<svg[\s>]|<\?xml/i.test(textAt(bytes, 0, Math.min(bytes.length, 512)))) throw new Error('不支持含外部资源/脚本的 SVG；请导出 PNG/JPEG 图片')
  throw new Error('未识别为可安全读取的图片或视频；可选 PNG/JPEG/WebP/GIF/BMP/AVIF/HEIC 或 MP4/MOV/WebM，编码仍需设备实际支持')
}

function release(asset: { url: string; posterUrl: string }): void {
  if (asset.url) URL.revokeObjectURL(asset.url)
  if (asset.posterUrl && asset.posterUrl !== asset.url) URL.revokeObjectURL(asset.posterUrl)
}

async function probe(file: Blob): Promise<BackgroundAsset> {
  const token = generation
  const info = await inspectBackgroundFile(file)
  if (token !== generation) throw new Error('背景操作已取消')
  const blob = new Blob([file], { type: info.mime })
  const url = URL.createObjectURL(blob)
  let posterUrl = ''
  try {
    if (info.kind === 'image') {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('图片解码超时，请选择其他图片')), THEME_BACKGROUND_LIMITS.probeMs)
        cancelProbe = () => { clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; reject(new Error('背景操作已取消')) }
        image.onload = () => { clearTimeout(timer); resolve() }
        image.onerror = () => { clearTimeout(timer); reject(new Error('设备不能解码该图片，或文件已损坏；原背景未替换')) }
        image.src = url
      })
      if (token !== generation) throw new Error('背景操作已取消')
      dimensions(image.naturalWidth, image.naturalHeight)
      if (info.mime === 'image/gif') {
        // ponytail: GIF uses a static <=1280px first frame; explicit video covers
        // animated backgrounds with a controllable decoder/visibility lifecycle.
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('设备无法生成 GIF 静态首帧')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const still = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('GIF 静态首帧生成失败')), 'image/png'))
        if (token !== generation) throw new Error('背景操作已取消')
        image.src = ''; URL.revokeObjectURL(url)
        return { ...info, mime: 'image/png', blob: still, poster: null, url: URL.createObjectURL(still), posterUrl: '', width: canvas.width, height: canvas.height, duration: 0 }
      }
      return { ...info, blob, poster: null, url, posterUrl: '', width: image.naturalWidth, height: image.naturalHeight, duration: 0 }
    }
    const video = document.createElement('video')
    video.defaultMuted = true; video.muted = true; video.volume = 0; video.playsInline = true; video.preload = 'auto'
    video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.disablePictureInPicture = true
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('视频首帧解码超时，请转换为 MP4/H.264 后重试')), THEME_BACKGROUND_LIMITS.probeMs)
        cancelProbe = () => { clearTimeout(timer); video.pause(); video.removeAttribute('src'); video.load(); reject(new Error('背景操作已取消')) }
        video.onloadedmetadata = () => {
          try { dimensions(video.videoWidth, video.videoHeight) }
          catch (error) { clearTimeout(timer); reject(error) }
        }
        video.onloadeddata = () => { clearTimeout(timer); resolve() }
        video.onerror = () => { clearTimeout(timer); reject(new Error(`设备不支持该视频编码或文件已损坏（媒体错误 ${video.error?.code ?? '未知'}）；原背景未替换`)) }
        video.src = url
        video.load()
      })
      dimensions(video.videoWidth, video.videoHeight)
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('视频时长无效，不支持直播流或无法读取的文件')
      try { await video.play() } catch { throw new Error('静音视频自动播放被设备阻止；请改用图片或调整设备播放权限') }
      if (token !== generation) throw new Error('背景操作已取消')
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('设备无法生成视频首帧预览，请使用图片背景')
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const poster = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('视频首帧预览生成失败')), 'image/jpeg', 0.8))
      if (token !== generation) throw new Error('背景操作已取消')
      posterUrl = URL.createObjectURL(poster)
      return { ...info, blob, poster, url, posterUrl, width: video.videoWidth, height: video.videoHeight, duration: video.duration }
    } finally {
      video.pause(); video.onloadeddata = null; video.onloadedmetadata = null; video.onerror = null; video.removeAttribute('src'); video.load()
    }
  } catch (error) { release({ url, posterUrl }); throw error }
  finally { if (token === generation) cancelProbe = null }
}

function options(patch: Partial<ThemeBackgroundConfig>, base?: ThemeBackgroundConfig | null): Pick<ThemeBackgroundConfig, 'mask' | 'blur' | 'dark' | 'fit' | 'scope' | 'motion'> {
  const input = { mask: 0.6, blur: 0, dark: false, fit: 'cover', scope: 'main', motion: 'auto', ...base, ...patch }
  return {
    mask: Math.min(0.95, Math.max(0, Number(input.mask) || 0)), blur: Math.min(30, Math.max(0, Number(input.blur) || 0)), dark: input.dark === true,
    fit: input.fit === 'contain' ? 'contain' : 'cover', scope: ['main', 'player', 'lyrics', 'all'].includes(input.scope) ? input.scope as ThemeBackgroundScope : 'main', motion: input.motion === 'poster' ? 'poster' : 'auto'
  }
}

function publish(asset: BackgroundAsset | null, config: ThemeBackgroundConfig | null): void {
  const old = { url: themeBackgroundState.url, posterUrl: themeBackgroundState.posterUrl }
  currentBlob = asset?.blob ?? null; currentPoster = asset?.poster ?? null
  themeBackgroundState.config = config; themeBackgroundState.url = asset?.url ?? ''; themeBackgroundState.posterUrl = asset?.posterUrl ?? ''
  themeBackgroundState.error = ''; themeBackgroundState.playbackUnavailable = false
  if (old.url !== themeBackgroundState.url) release(old)
}

export async function restoreThemeBackground(force = false): Promise<void> {
  if (restoring) return restoring
  if (themeBackgroundState.saving) return
  if (themeBackgroundState.initialized && !force) return
  const token = generation
  themeBackgroundState.probing = true
  restoring = (async () => {
    let candidate: BackgroundAsset | null = null
    try {
      await nextTick()
      const saved = await idb.get<BackgroundRecord>('kv', THEME_BACKGROUND_KEY)
      if (token !== generation) return
      if (!saved) return
      if (saved.version !== 1 || !(saved.blob instanceof Blob) || !saved.config?.assetId) throw new Error('已保存的背景记录无效；当前使用默认背景，请重新选择文件')
      try { candidate = await probe(saved.blob) }
      catch (error) {
        if (token !== generation) return
        if (saved.config.kind !== 'video' || !(saved.poster instanceof Blob) || saved.blob.size > THEME_BACKGROUND_LIMITS.bytes) throw error
        dimensions(saved.config.width, saved.config.height)
        candidate = await probe(saved.poster)
        if (candidate.kind !== 'image') { release(candidate); candidate = null; throw new Error('已保存的视频首帧不是有效图片') }
        if (token !== generation) { release(candidate); return }
        // Keep the original video Blob on disk, but expose only a validated image
        // URL until the user replaces it with a video this device can decode.
        candidate = { ...candidate, kind: 'video', mime: saved.config.mime, blob: saved.blob, poster: saved.poster, posterUrl: candidate.url, width: saved.config.width, height: saved.config.height, duration: saved.config.duration }
        publish(candidate, { ...saved.config, ...options(saved.config), size: saved.blob.size })
        themeBackgroundState.playbackUnavailable = true
        themeBackgroundState.error = `视频恢复时无法播放，已显示保存的首帧；原素材仍保留。${error instanceof Error ? error.message : '设备解码失败'}`
        return
      }
      if (token !== generation) { release(candidate); return }
      const config: ThemeBackgroundConfig = { ...saved.config, ...options(saved.config), kind: candidate.kind, mime: candidate.mime, size: candidate.blob.size, width: candidate.width, height: candidate.height, duration: candidate.duration }
      publish(candidate, config)
    } catch (error) {
      if (candidate) release(candidate)
      if (token === generation) themeBackgroundState.error = `背景恢复失败：${error instanceof Error ? error.message : '读取存储失败'}`
    } finally {
      if (token === generation) { themeBackgroundState.initialized = true; themeBackgroundState.probing = false; restoring = null }
    }
  })()
  return restoring
}

export async function replaceThemeBackground(file: File): Promise<void> {
  await restoreThemeBackground()
  if (themeBackgroundState.saving) throw new Error('背景正在保存，请稍后再试')
  const token = generation
  themeBackgroundState.saving = true; themeBackgroundState.probing = true; themeBackgroundState.error = ''
  let candidate: BackgroundAsset | null = null
  try {
    await nextTick()
    if (token !== generation) throw new Error('背景操作已取消')
    candidate = await probe(file)
    if (token !== generation) throw new Error('背景操作已取消')
    const config: ThemeBackgroundConfig = { ...options({}, themeBackgroundState.config), assetId: randomUUID(), kind: candidate.kind, mime: candidate.mime, name: file.name.split(/[\\/]/).pop()?.slice(0, 240) || '背景文件', size: candidate.blob.size, width: candidate.width, height: candidate.height, duration: candidate.duration }
    await idb.set('kv', THEME_BACKGROUND_KEY, { version: 1, config, blob: candidate.blob, poster: candidate.poster } satisfies BackgroundRecord)
    if (token !== generation) { release(candidate); return }
    publish(candidate, config)
  } catch (error) {
    if (candidate) release(candidate)
    const message = error instanceof Error ? error.message : '未知错误'
    if (token === generation) themeBackgroundState.error = `背景未替换：${message}。请检查格式、设备解码能力或存储空间。`
    throw error
  } finally { if (token === generation) { themeBackgroundState.saving = false; themeBackgroundState.probing = false } }
}

export async function updateThemeBackground(patch: Partial<Pick<ThemeBackgroundConfig, 'mask' | 'blur' | 'dark' | 'fit' | 'scope' | 'motion'>>): Promise<void> {
  if (!themeBackgroundState.config || !currentBlob) throw new Error('请先选择背景文件')
  if (themeBackgroundState.saving) throw new Error('背景正在保存，请稍后再试')
  themeBackgroundState.saving = true
  const token = generation
  try {
    const config = { ...themeBackgroundState.config, ...options(patch, themeBackgroundState.config) }
    await idb.set('kv', THEME_BACKGROUND_KEY, { version: 1, config, blob: currentBlob, poster: currentPoster } satisfies BackgroundRecord)
    if (token === generation) { themeBackgroundState.config = config; if (!themeBackgroundState.playbackUnavailable) themeBackgroundState.error = '' }
  } catch (error) { themeBackgroundState.error = '背景设置未保存，请检查存储空间后重试'; throw error }
  finally { if (token === generation) themeBackgroundState.saving = false }
}

export async function clearThemeBackground(): Promise<void> {
  if (themeBackgroundState.saving) throw new Error('背景正在保存，请稍后再试')
  themeBackgroundState.saving = true
  const token = generation
  try { await idb.del('kv', THEME_BACKGROUND_KEY); if (token === generation) publish(null, null) }
  catch (error) { themeBackgroundState.error = '背景未清除，存储操作失败；原背景仍保留'; throw error }
  finally { if (token === generation) themeBackgroundState.saving = false }
}

export function backgroundAppliesToRoute(path: string, scene: ThemeBackgroundScene = themeBackgroundScene.value): boolean {
  const scope = themeBackgroundState.config?.scope
  if (!scope || !themeBackgroundState.url) return false
  const current = path.startsWith('/player') ? (scene === 'lyrics' ? 'lyrics' : 'player') : 'main'
  return scope === 'all' || scope === current || (scope === 'player' && current === 'lyrics')
}

export function disposeThemeBackground(): void {
  generation++; restoring = null
  const cancel = cancelProbe; cancelProbe = null; cancel?.()
  publish(null, null)
  themeBackgroundState.initialized = false; themeBackgroundState.saving = false; themeBackgroundState.probing = false
}
