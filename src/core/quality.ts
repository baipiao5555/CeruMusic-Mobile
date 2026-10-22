import { selectQuality } from '@shiqianjiang/ceru-plugin-sdk/quality'
import { allProviders } from './plugin/manager'

const KNOWN_ORDER = [
  'low',
  'standard',
  'high',
  'lossless',
  '128k',
  '192k',
  '320k',
  'flac',
  'flac24bit',
  'hires',
  'atmos',
  'atmos_plus',
  'master'
]

const LABELS: Record<string, string> = {
  low: '标准',
  standard: '高品质',
  high: '超高品质',
  lossless: '无损',
  '128k': '标准',
  '192k': '高品',
  '320k': '超高',
  flac: '无损',
  flac24bit: '超高解析',
  hires: '高清臻音',
  atmos: '全景环绕',
  atmos_plus: '全景增强',
  master: '超清母带'
}

const DESCRIPTIONS: Record<string, string> = {
  low: '适合网络较慢的环境，节省流量',
  standard: '平衡音质与文件大小，推荐选择',
  high: '高音质体验，适合有线网络',
  lossless: '最佳音质体验，需要较好的网络环境',
  '128k': '基础音质，文件较小',
  '192k': '良好音质，适合大多数场景',
  '320k': '高品质音质，接近 CD 品质',
  flac: '无损音质，完整还原原始录音',
  flac24bit: '更饱满清晰的高解析度音质，最高 192kHz/24bit',
  hires: '声音听感加强，96kHz/24bit',
  atmos: '沉浸式空间环绕音感，最高 5.1 声道',
  atmos_plus: '音源提供的增强环绕音质',
  master: '母带级音质，192kHz/24bit'
}

export function qualityLabel(quality: string | null | undefined): string {
  if (!quality) return '自动'
  return LABELS[quality] ?? quality
}

export function qualityDescription(quality: string | null | undefined): string {
  if (!quality) return '自动选择当前歌曲可用的最高音质'
  return DESCRIPTIONS[quality] ?? '由插件提供的自定义音质'
}

/** 插件常用的两套音质命名：抽象档位与码率/格式档位。 */
const ABSTRACT_TIERS = ['low', 'standard', 'high', 'lossless']
const FORMAT_TIERS = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']

/**
 * 设置页展示的默认音质档位：插件声明的档位 + 同一套命名下的其余档位。
 * 当前音源没有的档位不会报错，播放时会自动回落到最接近的可用档位。
 */
export function availableQualities(): string[] {
  const values: string[] = []
  for (const provider of allProviders()) {
    for (const quality of provider.qualities) {
      if (quality && !values.includes(quality)) values.push(quality)
    }
  }
  const family = values.some((quality) => ABSTRACT_TIERS.includes(quality))
    ? ABSTRACT_TIERS
    : FORMAT_TIERS
  for (const quality of family) {
    if (!values.includes(quality)) values.push(quality)
  }
  return values.sort((a, b) => {
    const left = KNOWN_ORDER.indexOf(a)
    const right = KNOWN_ORDER.indexOf(b)
    if (left === -1 && right === -1) return 0
    if (left === -1) return 1
    if (right === -1) return -1
    return left - right
  })
}

/** The best quality a track advertises, used for the compact list badge. */
export function highestQuality(qualities: string[] | null | undefined): string {
  if (!qualities?.length) return ''
  let best = qualities[0]
  let bestRank = KNOWN_ORDER.indexOf(best)
  for (const quality of qualities) {
    const rank = KNOWN_ORDER.indexOf(quality)
    if (rank > bestRank) {
      best = quality
      bestRank = rank
    }
  }
  return best
}

/**
 * Resolve the quality sent to the plugin. An empty request means "highest
 * available"; otherwise pick the requested quality or the closest lower one.
 */
export function selectPlaybackQuality(
  order: string[],
  available: string[],
  requested: string
): string | undefined {
  const choices = available.length ? [...available] : [...order]
  if (!choices.length) return undefined
  if (!requested) return choices[choices.length - 1]

  const usableOrder = [...order]
  for (const quality of choices) {
    if (!usableOrder.includes(quality)) usableOrder.push(quality)
  }
  return selectQuality(usableOrder, choices, requested) ?? choices[choices.length - 1]
}
