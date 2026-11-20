import type { ResourceRef } from '@shiqianjiang/ceru-plugin-sdk'

export interface Track {
  id: string
  providerId: string
  providerName: string
  platformName?: string
  /** Client-owned same-recording candidates; never accepted from plugin metadata. */
  alternatives?: Track[]
  pluginId: string
  ref: ResourceRef
  title: string
  artist: string
  album: string
  durationMs: number
  artwork: string
  qualities: string[]
  color?: string
  /** Native scanner-owned file URI; plugin entities never populate this field. */
  localPath?: string
}

export interface TrackSource {
  name?: string
  pluginId: string
  pluginName: string
  qualities: string[]
}

export function toTrack(entity: any, provider: TrackSource): Track {
  const metadata = entity.metadata ?? {}
  const metadataQualities = Array.isArray(metadata.qualities) ? metadata.qualities : []
  const providerQualities = Array.isArray(provider.qualities) ? provider.qualities : []
  return {
    id: entity.ref.id,
    providerId: entity.ref.providerId,
    pluginId: provider.pluginId,
    providerName: provider.pluginName,
    platformName: provider.name,
    ref: entity.ref,
    title: entity.title ?? '未知歌曲',
    artist: (metadata.artists ?? []).join(' / ') || entity.subtitle || '未知歌手',
    album: metadata.album?.title ?? '',
    durationMs: Number(metadata.durationMs) || 0,
    artwork: metadata.artworkUrl || '/default-cover.png',
    qualities: metadataQualities.length ? metadataQualities : providerQualities,
    color: entity.extensions?.demoColor
  }
}
