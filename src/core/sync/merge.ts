import type { LibrarySnapshot, PortablePlaylist, PortableTrack, SyncTombstone, TombstoneKind } from '../librarySnapshot'
import { snapshotTrackKey } from '../librarySnapshot'

export interface MergeConflict {
  playlistId: string
  playlistName: string
  copyId: string
  copyName: string
  reason: 'both-changed' | 'no-baseline'
}

export interface DeletionConflict {
  kind: TombstoneKind
  itemId: string
  name: string
  playlistId?: string
  deletedBy: 'local' | 'remote'
  action: 'kept-local' | 'kept-remote'
  reason: 'delete-vs-edit'
}

export interface TombstoneCounts { total: number; playlists: number; tracks: number; favorites: number }

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
  favoriteAdditions: number
  favoriteResurrections: number
  orderConflict: boolean
  deletedPlaylists: number
  deletedTracks: number
  deletedFavorites: number
  bothDeletedPlaylists: number
  bothDeletedTracks: number
  bothDeletedFavorites: number
  deletionConflicts: number
  restoredTombstones: number
  tombstones: TombstoneCounts
  remoteTombstones: TombstoneCounts
}

export interface MergeOptions { now?: Date; localDeviceId?: string; remoteDeviceId?: string }

export interface MergeResult {
  snapshot: LibrarySnapshot
  conflicts: MergeConflict[]
  deletionConflicts: DeletionConflict[]
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

/** Compares user data only; tombstones belong to synchronization metadata. */
export function snapshotsEqual(a: LibrarySnapshot, b: LibrarySnapshot): boolean {
  const favorites = (tracks: PortableTrack[]): string => tracks.map(track => JSON.stringify(track)).sort().join('\n')
  return favorites(a.favorites) === favorites(b.favorites) &&
    JSON.stringify(a.playlists) === JSON.stringify(b.playlists)
}

/** Compares the complete remote document, including the tombstone ledger. */
export function snapshotDocumentsEqual(a: LibrarySnapshot, b: LibrarySnapshot): boolean {
  const tombstones = (value: LibrarySnapshot): string => JSON.stringify([...(value.tombstones || [])].sort((left, right) =>
    tombstoneKey(left).localeCompare(tombstoneKey(right))))
  return snapshotsEqual(a, b) && tombstones(a) === tombstones(b)
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

function tombstoneKey(item: SyncTombstone): string {
  return `${item.kind}\u0000${item.playlistId || ''}\u0000${item.id}`
}

function countTombstones(tombstones: SyncTombstone[]): TombstoneCounts {
  return {
    total: tombstones.length,
    playlists: tombstones.filter(item => item.kind === 'playlist').length,
    tracks: tombstones.filter(item => item.kind === 'track').length,
    favorites: tombstones.filter(item => item.kind === 'favorite').length
  }
}

function uniqueTracks(tracks: PortableTrack[]): PortableTrack[] {
  const seen = new Set<string>()
  const result: PortableTrack[] = []
  for (const track of tracks) {
    const identity = snapshotTrackKey(track)
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(clone(track))
  }
  return result
}

interface Ledger {
  items: Map<string, SyncTombstone>
  stats: MergeStats
}

function playlistTombstoneKey(id: string): string { return `playlist\u0000\u0000${id}` }
function trackTombstoneKey(playlistId: string, id: string): string { return `track\u0000${playlistId}\u0000${id}` }
function favoriteTombstoneKey(id: string): string { return `favorite\u0000\u0000${id}` }

function ensureTombstone(ledger: Ledger, item: SyncTombstone): void {
  const identity = tombstoneKey(item)
  const existing = ledger.items.get(identity)
  if (!existing || Date.parse(item.deletedAt) > Date.parse(existing.deletedAt)) ledger.items.set(identity, item)
}

function clearTombstone(ledger: Ledger, identity: string): void {
  if (ledger.items.delete(identity)) ledger.stats.restoredTombstones++
}

function playlistTombstone(item: PortablePlaylist, deviceId: string, now: Date): SyncTombstone {
  return { kind: 'playlist', id: item.id, name: item.name, deletedAt: now.toISOString(), deviceId, playlist: clone(item) }
}

function trackTombstone(playlistId: string, item: PortableTrack, deviceId: string, now: Date): SyncTombstone {
  return { kind: 'track', id: snapshotTrackKey(item), name: item.title, deletedAt: now.toISOString(), deviceId,
    playlistId, track: clone(item) }
}

function favoriteTombstone(item: PortableTrack, deviceId: string, now: Date): SyncTombstone {
  return { kind: 'favorite', id: snapshotTrackKey(item), name: item.title, deletedAt: now.toISOString(), deviceId, track: clone(item) }
}

function existingTombstone(ledger: Ledger, kind: TombstoneKind, id: string, playlistId = ''): SyncTombstone | undefined {
  const identity = kind === 'playlist' ? playlistTombstoneKey(id) : kind === 'track' ? trackTombstoneKey(playlistId, id) : favoriteTombstoneKey(id)
  return ledger.items.get(identity)
}

/**
 * Apply a one-sided playlist change. The caller guarantees `other` still
 * equals `base`, so a disappearing base track is an intentional deletion.
 */
function mergeChangedPlaylist(base: PortablePlaylist, prefer: PortablePlaylist, other: PortablePlaylist,
  deviceId: string, preferTracksElsewhere: Set<string>, ledger: Ledger, now: Date): PortablePlaylist {
  const baseTracks = indexTracks(base.tracks)
  const otherTracks = indexTracks(other.tracks)
  const tracks = uniqueTracks(prefer.tracks)
  const kept = new Set(tracks.map(track => snapshotTrackKey(track)))
  for (const identity of kept) clearTombstone(ledger, trackTombstoneKey(prefer.id, identity))
  for (const [identity, track] of baseTracks) {
    if (kept.has(identity) || !otherTracks.has(identity) || preferTracksElsewhere.has(identity)) continue
    if (!existingTombstone(ledger, 'track', identity, prefer.id)) ensureTombstone(ledger, trackTombstone(prefer.id, track, deviceId, now))
    ledger.stats.deletedTracks++
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

/**
 * Record tracks removed on both sides. This also covers the equal-content case
 * where both clients independently deleted the same item.
 */
function recordBothDeletedTracks(base: PortablePlaylist, local: PortablePlaylist, remote: PortablePlaylist,
  deviceId: string, localTracksElsewhere: Set<string>, remoteTracksElsewhere: Set<string>, ledger: Ledger, now: Date): void {
  const localTracks = indexTracks(local.tracks)
  const remoteTracks = indexTracks(remote.tracks)
  for (const [identity, track] of indexTracks(base.tracks)) {
    if (localTracks.has(identity) || remoteTracks.has(identity) ||
      localTracksElsewhere.has(identity) || remoteTracksElsewhere.has(identity)) continue
    if (!existingTombstone(ledger, 'track', identity, base.id)) ensureTombstone(ledger, trackTombstone(base.id, track, deviceId, now))
    ledger.stats.bothDeletedTracks++
  }
}

/**
 * When both sides changed a playlist, a track deleted on only one side is
 * restored into the kept version and reported. The remote version still
 * becomes a conflict copy, so neither deletion nor edit is lost.
 */
function preserveOneSidedTrackDeletions(base: PortablePlaylist, local: PortablePlaylist, remote: PortablePlaylist,
  chosenLocal: PortablePlaylist, localTracksElsewhere: Set<string>, remoteTracksElsewhere: Set<string>,
  deletionConflicts: DeletionConflict[], stats: MergeStats): PortablePlaylist {
  const localTracks = indexTracks(local.tracks)
  const remoteTracks = indexTracks(remote.tracks)
  const tracks = uniqueTracks(chosenLocal.tracks)
  const seen = new Set(tracks.map(track => snapshotTrackKey(track)))
  for (const [identity, baseTrack] of indexTracks(base.tracks)) {
    const mine = localTracks.get(identity)
    const theirs = remoteTracks.get(identity)
    if (Boolean(mine) === Boolean(theirs)) continue
    if ((!mine && localTracksElsewhere.has(identity)) || (!theirs && remoteTracksElsewhere.has(identity))) continue
    const survivor = mine || theirs!
    if (!seen.has(identity)) {
      tracks.push(clone(survivor))
      seen.add(identity)
    }
    deletionConflicts.push({
      kind: 'track',
      itemId: identity,
      name: survivor.title || baseTrack.title,
      playlistId: base.id,
      deletedBy: mine ? 'remote' : 'local',
      action: mine ? 'kept-local' : 'kept-remote',
      reason: 'delete-vs-edit'
    })
    stats.deletionConflicts++
  }
  return { ...chosenLocal, tracks }
}

function mergeFavorites(local: PortableTrack[], baseline: PortableTrack[] | undefined, remote: PortableTrack[],
  localDevice: string, ledger: Ledger, now: Date, deletionConflicts: DeletionConflict[], stats: MergeStats): PortableTrack[] {
  const baseFavorites = indexTracks(baseline || [])
  const localFavorites = indexTracks(local)
  const remoteFavorites = indexTracks(remote)
  const identities = new Set([...localFavorites.keys(), ...remoteFavorites.keys(), ...baseFavorites.keys()])
  const favorites: PortableTrack[] = []
  for (const identity of identities) {
    const mine = localFavorites.get(identity)
    const theirs = remoteFavorites.get(identity)
    const base = baseFavorites.get(identity)
    const identityTombstone = favoriteTombstoneKey(identity)
    if (mine && theirs) {
      const localChanged = base ? !portableTrackEqual(mine, base) : true
      const remoteChanged = base ? !portableTrackEqual(theirs, base) : true
      favorites.push(clone(localChanged || !remoteChanged ? mine : theirs))
      clearTombstone(ledger, identityTombstone)
    } else if (mine) {
      const deleted = existingTombstone(ledger, 'favorite', identity)
      if (base && portableTrackEqual(mine, base)) {
        if (deleted) stats.deletedFavorites++
        else {
          favorites.push(clone(mine))
          stats.favoriteResurrections++
        }
      } else if (base) {
        favorites.push(clone(mine))
        if (deleted) {
          clearTombstone(ledger, identityTombstone)
          deletionConflicts.push({ kind: 'favorite', itemId: identity, name: mine.title, deletedBy: 'remote', action: 'kept-local', reason: 'delete-vs-edit' })
          stats.deletionConflicts++
        }
      } else {
        favorites.push(clone(mine))
        clearTombstone(ledger, identityTombstone)
      }
    } else if (theirs) {
      if (base && portableTrackEqual(theirs, base)) {
        ensureTombstone(ledger, favoriteTombstone(theirs, localDevice, now))
        stats.deletedFavorites++
      } else if (base) {
        favorites.push(clone(theirs))
        clearTombstone(ledger, identityTombstone)
        deletionConflicts.push({ kind: 'favorite', itemId: identity, name: theirs.title, deletedBy: 'local', action: 'kept-remote', reason: 'delete-vs-edit' })
        stats.deletionConflicts++
      } else {
        favorites.push(clone(theirs))
        clearTombstone(ledger, identityTombstone)
        stats.favoriteAdditions++
      }
    } else if (base) {
      if (!existingTombstone(ledger, 'favorite', identity)) ensureTombstone(ledger, favoriteTombstone(base, localDevice, now))
      stats.bothDeletedFavorites++
    }
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
 * Three-way merge with conservative deletion propagation:
 * - a deletion travels only when the other side still equals the baseline;
 * - a deletion racing an edit is restored/kept and reported;
 * - items deleted at baseline live as full-copy tombstones for review/restore;
 * - playlist deletions retain the entire playlist, track deletions retain
 *   their playlist id and portable track, and favorite deletions retain the
 *   portable favorite;
 * - v1 inputs are accepted by the parser and enter here without tombstones.
 */
export function mergeSnapshots(local: LibrarySnapshot, baseline: LibrarySnapshot | undefined, remote: LibrarySnapshot, options: MergeOptions = {}): MergeResult {
  const now = options.now ? new Date(options.now.getTime()) : new Date()
  const localDevice = local.deviceId || options.localDeviceId || 'local-device'
  const remoteDevice = remote.deviceId || options.remoteDeviceId || 'remote-device'
  const localMap = indexPlaylists(local.playlists)
  const remoteMap = indexPlaylists(remote.playlists)
  const baseMap = baseline ? indexPlaylists(baseline.playlists) : new Map<string, PortablePlaylist>()
  const localTrackKeys = new Set(local.playlists.flatMap(playlist => playlist.tracks.map(track => snapshotTrackKey(track))))
  const remoteTrackKeys = new Set(remote.playlists.flatMap(playlist => playlist.tracks.map(track => snapshotTrackKey(track))))
  const ids = [...local.playlists.map(item => item.id), ...remote.playlists.map(item => item.id), ...(baseline?.playlists.map(item => item.id) || [])]
  const uniqueIds = [...new Set(ids)]
  const usedIds = new Set(uniqueIds)
  const chosen = new Map<string, PortablePlaylist>()
  const copies: PortablePlaylist[] = []
  const conflicts: MergeConflict[] = []
  const deletionConflicts: DeletionConflict[] = []
  const stats: MergeStats = {
    localPlaylists: local.playlists.length, remotePlaylists: remote.playlists.length,
    baselinePlaylists: baseline?.playlists.length || 0, mergedPlaylists: 0,
    localOnlyPlaylists: 0, remoteOnlyPlaylists: 0, conflictCopies: 0,
    resurrectedPlaylists: 0, deletedBothPlaylists: 0,
    favoriteAdditions: 0, favoriteResurrections: 0, orderConflict: false,
    deletedPlaylists: 0, deletedTracks: 0, deletedFavorites: 0,
    bothDeletedPlaylists: 0, bothDeletedTracks: 0, bothDeletedFavorites: 0,
    deletionConflicts: 0, restoredTombstones: 0,
    tombstones: { total: 0, playlists: 0, tracks: 0, favorites: 0 },
    remoteTombstones: countTombstones(remote.tombstones || [])
  }
  const ledger: Ledger = { items: new Map(), stats }
  for (const source of [baseline, local, remote]) {
    for (const item of source?.tombstones || []) ensureTombstone(ledger, clone(item))
  }

  for (const id of uniqueIds) {
    const mine = localMap.get(id)
    const theirs = remoteMap.get(id)
    const base = baseMap.get(id)
    const identityTombstone = playlistTombstoneKey(id)
    if (mine && theirs) {
      if (portablePlaylistEqual(mine, theirs)) {
        chosen.set(id, clone(mine))
        if (base) recordBothDeletedTracks(base, mine, theirs, localDevice, localTrackKeys, remoteTrackKeys, ledger, now)
        clearTombstone(ledger, identityTombstone)
        continue
      }
      if (!base) {
        chosen.set(id, clone(mine))
        const copy = conflictCopy(theirs, usedIds, now)
        copies.push(copy)
        conflicts.push({ playlistId: id, playlistName: mine.name, copyId: copy.id, copyName: copy.name, reason: 'no-baseline' })
        clearTombstone(ledger, identityTombstone)
        continue
      }
      const localChanged = !portablePlaylistEqual(mine, base)
      const remoteChanged = !portablePlaylistEqual(theirs, base)
      if (!localChanged) {
        chosen.set(id, mergeChangedPlaylist(base, theirs, mine, remoteDevice, remoteTrackKeys, ledger, now))
      } else if (!remoteChanged) {
        chosen.set(id, mergeChangedPlaylist(base, mine, theirs, localDevice, localTrackKeys, ledger, now))
      } else {
        chosen.set(id, preserveOneSidedTrackDeletions(base, mine, theirs, clone(mine), localTrackKeys, remoteTrackKeys, deletionConflicts, stats))
        const copy = conflictCopy(theirs, usedIds, now)
        copies.push(copy)
        conflicts.push({ playlistId: id, playlistName: mine.name, copyId: copy.id, copyName: copy.name, reason: 'both-changed' })
        recordBothDeletedTracks(base, mine, theirs, localDevice, localTrackKeys, remoteTrackKeys, ledger, now)
      }
      clearTombstone(ledger, identityTombstone)
    } else if (mine) {
      const deletedRemotely = existingTombstone(ledger, 'playlist', id)
      if (base && portablePlaylistEqual(mine, base)) {
        if (deletedRemotely) {
          stats.deletedPlaylists++
        } else {
          chosen.set(id, clone(mine))
          stats.resurrectedPlaylists++
        }
      } else if (base) {
        chosen.set(id, clone(mine))
        if (deletedRemotely) {
          clearTombstone(ledger, identityTombstone)
          deletionConflicts.push({ kind: 'playlist', itemId: id, name: mine.name, deletedBy: 'remote', action: 'kept-local', reason: 'delete-vs-edit' })
          stats.deletionConflicts++
        }
      } else {
        chosen.set(id, clone(mine))
        clearTombstone(ledger, identityTombstone)
        stats.localOnlyPlaylists++
      }
    } else if (theirs) {
      if (base && portablePlaylistEqual(theirs, base)) {
        ensureTombstone(ledger, playlistTombstone(theirs, localDevice, now))
        stats.deletedPlaylists++
      } else if (base) {
        chosen.set(id, clone(theirs))
        clearTombstone(ledger, identityTombstone)
        deletionConflicts.push({ kind: 'playlist', itemId: id, name: theirs.name, deletedBy: 'local', action: 'kept-remote', reason: 'delete-vs-edit' })
        stats.deletionConflicts++
      } else {
        chosen.set(id, clone(theirs))
        clearTombstone(ledger, identityTombstone)
        stats.remoteOnlyPlaylists++
      }
    } else if (base) {
      if (!existingTombstone(ledger, 'playlist', id)) ensureTombstone(ledger, playlistTombstone(base, localDevice, now))
      stats.bothDeletedPlaylists++
      stats.deletedBothPlaylists++
    }
  }

  for (const copy of copies) chosen.set(copy.id, copy)
  const favorites = mergeFavorites(local.favorites, baseline?.favorites, remote.favorites, localDevice, ledger, now, deletionConflicts, stats)
  const localSideChanged = baseline ? !snapshotsEqual(local, baseline) : false
  const remoteSideChanged = baseline ? !snapshotsEqual(remote, baseline) : false
  const order = mergedOrder(local.playlists, remote.playlists, chosen, Boolean(baseline), localSideChanged, remoteSideChanged, stats)
  const playlistTombstones = new Set([...ledger.items.values()].filter(item => item.kind === 'playlist').map(item => item.id))
  const liveTracks = new Set([...chosen.values()].flatMap(playlist => playlist.tracks.map(track => snapshotTrackKey(track))))
  for (const [identity, item] of ledger.items) {
    if (item.kind === 'playlist' && chosen.has(item.id)) ledger.items.delete(identity)
    if (item.kind === 'track') {
      if (liveTracks.has(item.id) || playlistTombstones.has(item.playlistId || '')) ledger.items.delete(identity)
    }
    if (item.kind === 'favorite' && favorites.some(track => snapshotTrackKey(track) === item.id)) ledger.items.delete(identity)
  }
  const tombstones = [...ledger.items.values()].sort((left, right) => tombstoneKey(left).localeCompare(tombstoneKey(right)))
  stats.tombstones = countTombstones(tombstones)
  stats.conflictCopies = conflicts.length
  const snapshot: LibrarySnapshot = {
    schema: 'ceru.library.sync',
    version: 2,
    deviceId: local.deviceId || localDevice,
    createdAt: now.toISOString(),
    favorites,
    playlists: order.map(id => clone(chosen.get(id)!)),
    tombstones
  }
  stats.mergedPlaylists = snapshot.playlists.length
  return { snapshot, conflicts, deletionConflicts, stats }
}
