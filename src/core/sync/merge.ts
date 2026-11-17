import type { LibrarySnapshot, PortablePlaylist, PortableTrack } from '../librarySnapshot'
import { snapshotTrackKey } from '../librarySnapshot'

export interface MergeConflict {
  playlistId: string
  playlistName: string
  copyId: string
  copyName: string
  reason: 'both-changed' | 'no-baseline'
}

export interface MergeStats {
  localPlaylists: number
  remotePlaylists: number
  baselinePlaylists: number
  mergedPlaylists: number
  localOnlyPlaylists: number
  remoteOnlyPlaylists: number
  conflictCopies: number
  resurrectedPlaylists: number
  deletedBothPlaylists: number
  resurrectedTracks: number
  favoriteAdditions: number
  favoriteResurrections: number
  orderConflict: boolean
}

export interface MergeOptions { now?: Date }

export interface MergeResult {
  snapshot: LibrarySnapshot
  conflicts: MergeConflict[]
  stats: MergeStats
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function portableTrackEqual(a: PortableTrack, b: PortableTrack): boolean {
  return a.id === b.id && a.title === b.title && a.artist === b.artist && a.album === b.album &&
    a.durationMs === b.durationMs && a.artwork === b.artwork &&
    JSON.stringify(a.qualities) === JSON.stringify(b.qualities) &&
    a.source.manifestId === b.source.manifestId && a.source.providerId === b.source.providerId &&
    a.source.kind === b.source.kind && a.source.id === b.source.id &&
    a.source.requiresRebind === b.source.requiresRebind
}

export function portablePlaylistEqual(a: PortablePlaylist, b: PortablePlaylist): boolean {
  return a.id === b.id && a.name === b.name && a.description === b.description && a.cover === b.cover &&
    a.createdAt === b.createdAt && a.tracks.length === b.tracks.length &&
    a.tracks.every((track, index) => portableTrackEqual(track, b.tracks[index]))
}

export function snapshotsEqual(a: LibrarySnapshot, b: LibrarySnapshot): boolean {
  const favorites = (tracks: PortableTrack[]): string => tracks.map(track => JSON.stringify(track)).sort().join('\n')
  return favorites(a.favorites) === favorites(b.favorites) &&
    JSON.stringify(a.playlists) === JSON.stringify(b.playlists)
}

function indexTracks(tracks: PortableTrack[]): Map<string, PortableTrack> {
  const index = new Map<string, PortableTrack>()
  for (const track of tracks) {
    const identity = snapshotTrackKey(track)
    if (!index.has(identity)) index.set(identity, track)
  }
  return index
}

function indexPlaylists(playlists: PortablePlaylist[]): Map<string, PortablePlaylist> {
  return new Map(playlists.map(playlist => [playlist.id, playlist]))
}

/**
 * Apply the changes of one side while refusing to propagate deletions.
 * `prefer` is the side that changed; `other` equals the baseline. Tracks that
 * `prefer` removed are put back, so a first sync can never silently delete
 * remote or local tracks.
 */
function mergeChangedPlaylist(base: PortablePlaylist, prefer: PortablePlaylist, other: PortablePlaylist, stats: MergeStats): PortablePlaylist {
  const baseTracks = indexTracks(base.tracks)
  const seen = new Set<string>()
  const tracks: PortableTrack[] = []
  for (const track of prefer.tracks) {
    const identity = snapshotTrackKey(track)
    if (seen.has(identity)) continue
    seen.add(identity)
    tracks.push(clone(track))
  }
  for (let index = 0; index < other.tracks.length; index++) {
    const track = other.tracks[index]
    const identity = snapshotTrackKey(track)
    if (seen.has(identity)) continue
    const copy = clone(track)
    let insertAt = tracks.length
    for (let next = index + 1; next < other.tracks.length; next++) {
      const nextIdentity = snapshotTrackKey(other.tracks[next])
      const found = tracks.findIndex(item => snapshotTrackKey(item) === nextIdentity)
      if (found >= 0) { insertAt = found; break }
    }
    tracks.splice(insertAt, 0, copy)
    seen.add(identity)
    if (baseTracks.has(identity)) stats.resurrectedTracks++
  }
  return {
    id: prefer.id,
    name: prefer.name,
    description: prefer.description,
    cover: prefer.cover,
    createdAt: prefer.createdAt,
    tracks
  }
}

function mergeFavorites(local: PortableTrack[], baseline: PortableTrack[] | undefined, remote: PortableTrack[], stats: MergeStats): PortableTrack[] {
  const baseFavorites = indexTracks(baseline || [])
  const remoteFavorites = indexTracks(remote)
  const seen = new Set<string>()
  const favorites: PortableTrack[] = []
  for (const track of local) {
    const identity = snapshotTrackKey(track)
    if (seen.has(identity)) continue
    const remoteTrack = remoteFavorites.get(identity)
    const baseTrack = baseFavorites.get(identity)
    if (remoteTrack) {
      const localChanged = baseTrack ? !portableTrackEqual(track, baseTrack) : true
      const remoteChanged = baseTrack ? !portableTrackEqual(remoteTrack, baseTrack) : true
      // Same identity: metadata differences are never worth a conflict copy.
      const chosen = localChanged || !remoteChanged ? track : remoteTrack
      favorites.push(clone(chosen))
    } else {
      // A remote removal is not propagated in the first version.
      favorites.push(clone(track))
    }
    seen.add(identity)
  }
  for (const track of remote) {
    const identity = snapshotTrackKey(track)
    if (seen.has(identity)) continue
    favorites.push(clone(track))
    seen.add(identity)
    if (baseFavorites.has(identity)) stats.favoriteResurrections++
    else stats.favoriteAdditions++
  }
  return favorites
}

function stamp(now: Date): { name: string; id: string } {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const year = now.getFullYear()
  const month = pad(now.getMonth() + 1)
  const day = pad(now.getDate())
  const hour = pad(now.getHours())
  const minute = pad(now.getMinutes())
  return { name: `${year}-${month}-${day} ${hour}${minute}`, id: `${year}${month}${day}${hour}${minute}` }
}

function conflictCopy(source: PortablePlaylist, usedIds: Set<string>, now: Date): PortablePlaylist {
  const marker = stamp(now)
  const baseId = source.id.slice(0, 400)
  let id = `${baseId}-conflict-${marker.id}`
  let suffix = 2
  while (usedIds.has(id)) id = `${baseId}-conflict-${marker.id}-${suffix++}`
  usedIds.add(id)
  return { ...clone(source), id, name: `${source.name} (冲突副本 ${marker.name})`.slice(0, 512), createdAt: now.getTime() }
}

function mergedOrder(local: PortablePlaylist[], remote: PortablePlaylist[], chosen: Map<string, PortablePlaylist>, hasBaseline: boolean, localSideChanged: boolean, remoteSideChanged: boolean, stats: MergeStats): string[] {
  const ids = new Set(chosen.keys())
  const localOrder = local.map(item => item.id).filter(id => ids.has(id))
  const remoteOrder = remote.map(item => item.id).filter(id => ids.has(id))
  if (localSideChanged && remoteSideChanged && localOrder.join('\u0000') !== remoteOrder.join('\u0000')) stats.orderConflict = true
  let order: string[]
  if (hasBaseline && !localSideChanged) {
    order = [...remoteOrder, ...localOrder.filter(id => !remoteOrder.includes(id))]
  } else if (hasBaseline && !remoteSideChanged) {
    order = [...localOrder, ...remoteOrder.filter(id => !localOrder.includes(id))]
  } else {
    const localCommon = localOrder.filter(id => remoteOrder.includes(id))
    order = [...localOrder, ...remoteOrder.filter(id => !localCommon.includes(id))]
  }
  for (const id of ids) if (!order.includes(id)) order.push(id)
  return order
}

/**
 * Three-way merge with a conservative deletion policy:
 * - one-sided change is applied, but deletions are restored;
 * - both sides changing the same playlist keeps the local version and a
 *   timestamped conflict copy of the remote version;
 * - favorites merge by stable source identity;
 * - there is no tombstone or trash in this first version, so a deletion only
 *   disappears when both sides removed the same item.
 */
export function mergeSnapshots(local: LibrarySnapshot, baseline: LibrarySnapshot | undefined, remote: LibrarySnapshot, options: MergeOptions = {}): MergeResult {
  const now = options.now ? new Date(options.now.getTime()) : new Date()
  const localMap = indexPlaylists(local.playlists)
  const remoteMap = indexPlaylists(remote.playlists)
  const baseMap = baseline ? indexPlaylists(baseline.playlists) : new Map<string, PortablePlaylist>()
  const ids = [...local.playlists.map(item => item.id), ...remote.playlists.map(item => item.id), ...(baseline?.playlists.map(item => item.id) || [])]
  const uniqueIds = [...new Set(ids)]
  const usedIds = new Set(uniqueIds)
  const chosen = new Map<string, PortablePlaylist>()
  const copies: PortablePlaylist[] = []
  const conflicts: MergeConflict[] = []
  const stats: MergeStats = {
    localPlaylists: local.playlists.length, remotePlaylists: remote.playlists.length,
    baselinePlaylists: baseline?.playlists.length || 0, mergedPlaylists: 0,
    localOnlyPlaylists: 0, remoteOnlyPlaylists: 0, conflictCopies: 0,
    resurrectedPlaylists: 0, deletedBothPlaylists: 0, resurrectedTracks: 0,
    favoriteAdditions: 0, favoriteResurrections: 0, orderConflict: false
  }
  for (const id of uniqueIds) {
    const mine = localMap.get(id)
    const theirs = remoteMap.get(id)
    const base = baseMap.get(id)
    if (mine && theirs) {
      if (portablePlaylistEqual(mine, theirs)) {
        chosen.set(id, clone(mine))
        continue
      }
      if (!base) {
        chosen.set(id, clone(mine))
        const copy = conflictCopy(theirs, usedIds, now)
        copies.push(copy)
        conflicts.push({ playlistId: id, playlistName: mine.name, copyId: copy.id, copyName: copy.name, reason: 'no-baseline' })
        continue
      }
      const localChanged = !portablePlaylistEqual(mine, base)
      const remoteChanged = !portablePlaylistEqual(theirs, base)
      if (!localChanged) {
        chosen.set(id, mergeChangedPlaylist(base, theirs, mine, stats))
      } else if (!remoteChanged) {
        chosen.set(id, mergeChangedPlaylist(base, mine, theirs, stats))
      } else {
        chosen.set(id, clone(mine))
        const copy = conflictCopy(theirs, usedIds, now)
        copies.push(copy)
        conflicts.push({ playlistId: id, playlistName: mine.name, copyId: copy.id, copyName: copy.name, reason: 'both-changed' })
      }
    } else if (mine) {
      chosen.set(id, clone(mine))
      if (!theirs) stats.localOnlyPlaylists++
    } else if (theirs) {
      chosen.set(id, clone(theirs))
      stats.remoteOnlyPlaylists++
      if (base) stats.resurrectedPlaylists++
    } else if (base) {
      stats.deletedBothPlaylists++
    }
  }
  for (const copy of copies) chosen.set(copy.id, copy)
  const localSideChanged = baseline ? !snapshotsEqual(local, baseline) : false
  const remoteSideChanged = baseline ? !snapshotsEqual(remote, baseline) : false
  const order = mergedOrder(local.playlists, remote.playlists, chosen, Boolean(baseline), localSideChanged, remoteSideChanged, stats)
  const snapshot: LibrarySnapshot = {
    schema: 'ceru.library.sync',
    version: 1,
    createdAt: now.toISOString(),
    favorites: mergeFavorites(local.favorites, baseline?.favorites, remote.favorites, stats),
    playlists: order.map(id => clone(chosen.get(id)!))
  }
  stats.mergedPlaylists = snapshot.playlists.length
  stats.conflictCopies = conflicts.length
  return { snapshot, conflicts, stats }
}
