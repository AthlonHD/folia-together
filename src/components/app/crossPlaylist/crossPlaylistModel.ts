import type { SongResult } from '../../../types';
import { getPlaybackSourceRef, normalizePlaybackSongSource } from '../../../utils/appPlaybackGuards';

// src/components/app/crossPlaylist/crossPlaylistModel.ts
// The playlist that can hold songs from any online platform, kept on the device (see crossPlaylistStore.ts).
//
// Made so that it can be synced between devices later without being reshaped: every playlist and every entry has an id of its own,
// a playlist records when it last changed, and a playlist that is deleted stays behind as a mark with the time it was deleted
// (otherwise a device that still has it would bring it back). Two copies of the same playlist are told apart by `updatedAt`:
// the later change wins whole.
//
// Only songs of the online platforms go in: a local file or a Navidrome track means nothing on another device.

export interface CrossPlaylistEntry {
    /** Own id of this place in the playlist (the place keeps its identity when it moves). */
    id: string;
    providerId: string;
    mediaId: string;
    addedAt: number;
    /** The song as it was when it was added: enough to show it and to play it, without asking the platform first. */
    song: SongResult;
}

export interface CrossPlaylist {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    entries: CrossPlaylistEntry[];
    /** Set when the playlist was deleted: it is kept as a mark, and not shown. */
    deletedAt?: number;
}

export const CROSS_PLAYLIST_EXPORT_FORMAT = 'folia-cross-playlists';
export const CROSS_PLAYLIST_EXPORT_VERSION = 1;

/** Fields that describe the moment a song was seen, not the song: they would only go stale in a saved playlist. */
const VOLATILE_SONG_FIELDS = ['playbackSourceRevision', 'onlineLyricsState', 'matchedLyricsSource', 'matchedLyricsProviderPlatform', 'replayGain'] as const;

let idCounter = 0;
export const createCrossId = (prefix: string): string => {
    idCounter += 1;
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}${idCounter.toString(36)}`;
};

/** The key a song is known by across platforms; two entries with the same key are the same song. */
export const crossSongKey = (providerId: string, mediaId: string | number): string => `${providerId}:${mediaId}`;

/** The online identity of a song, or null when it is not an online platform's (a local file, Navidrome, a Stage song). */
export const onlineIdentityOf = (song: SongResult): { providerId: string; mediaId: string } | null => {
    const ref = getPlaybackSourceRef(song);
    if (ref.kind !== 'online') return null;
    return { providerId: String(ref.providerId), mediaId: String(ref.mediaId) };
};

export const canHoldInCrossPlaylist = (song: SongResult | null | undefined): boolean => Boolean(song && onlineIdentityOf(song));

/** What is kept of a song: its own fields with a source reference, without what only describes the moment it was seen. */
export const toStoredSong = (song: SongResult): SongResult => {
    const stored = JSON.parse(JSON.stringify(normalizePlaybackSongSource(song))) as SongResult & Record<string, unknown>;
    for (const field of VOLATILE_SONG_FIELDS) delete stored[field];
    return stored;
};

export const createCrossPlaylist = (name: string, now = Date.now()): CrossPlaylist => ({
    id: createCrossId('xpl'),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    entries: [],
});

export const visiblePlaylists = (playlists: readonly CrossPlaylist[]): CrossPlaylist[] => playlists.filter(playlist => playlist.deletedAt === undefined);

const touch = (playlist: CrossPlaylist, now: number, entries: CrossPlaylistEntry[] = playlist.entries): CrossPlaylist => ({ ...playlist, entries, updatedAt: now });

/** Adds the songs a playlist does not have yet, at the end, in the order given. Songs that cannot go in are skipped. */
export const addSongsToPlaylist = (
    playlist: CrossPlaylist,
    songs: readonly SongResult[],
    now = Date.now(),
): { playlist: CrossPlaylist; added: number; skipped: number } => {
    const known = new Set(playlist.entries.map(entry => crossSongKey(entry.providerId, entry.mediaId)));
    const entries = [...playlist.entries];
    let skipped = 0;
    for (const song of songs) {
        const identity = onlineIdentityOf(song);
        if (!identity) {
            skipped += 1;
            continue;
        }
        const key = crossSongKey(identity.providerId, identity.mediaId);
        if (known.has(key)) {
            skipped += 1;
            continue;
        }
        known.add(key);
        entries.push({ id: createCrossId('xe'), providerId: identity.providerId, mediaId: identity.mediaId, addedAt: now, song: toStoredSong(song) });
    }
    const added = entries.length - playlist.entries.length;
    return { playlist: added > 0 ? touch(playlist, now, entries) : playlist, added, skipped };
};

export const removeEntryFromPlaylist = (playlist: CrossPlaylist, entryId: string, now = Date.now()): CrossPlaylist => {
    const entries = playlist.entries.filter(entry => entry.id !== entryId);
    return entries.length === playlist.entries.length ? playlist : touch(playlist, now, entries);
};

export const moveEntryInPlaylist = (playlist: CrossPlaylist, entryId: string, toIndex: number, now = Date.now()): CrossPlaylist => {
    const from = playlist.entries.findIndex(entry => entry.id === entryId);
    if (from < 0) return playlist;
    const to = Math.max(0, Math.min(playlist.entries.length - 1, toIndex));
    if (from === to) return playlist;
    const entries = [...playlist.entries];
    entries.splice(to, 0, ...entries.splice(from, 1));
    return touch(playlist, now, entries);
};

export const renamePlaylist = (playlist: CrossPlaylist, name: string, now = Date.now()): CrossPlaylist => {
    const next = name.trim();
    return next && next !== playlist.name ? { ...playlist, name: next, updatedAt: now } : playlist;
};

/** The playlist is marked deleted and emptied; the mark is what keeps another copy of it from bringing it back. */
export const markPlaylistDeleted = (playlist: CrossPlaylist, now = Date.now()): CrossPlaylist => ({ ...playlist, entries: [], updatedAt: now, deletedAt: now });

/** What each platform contributes to a playlist, in the order they first appear: `[['one', 12], ['two', 3]]`. */
export const countByProvider = (playlist: CrossPlaylist): Array<[string, number]> => {
    const counts = new Map<string, number>();
    for (const entry of playlist.entries) counts.set(entry.providerId, (counts.get(entry.providerId) ?? 0) + 1);
    return [...counts.entries()];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeEntry = (value: unknown): CrossPlaylistEntry | null => {
    if (!isRecord(value) || !isRecord(value.song)) return null;
    const song = value.song as unknown as SongResult;
    const identity = onlineIdentityOf(song);
    if (!identity) return null;
    return {
        id: typeof value.id === 'string' && value.id ? value.id : createCrossId('xe'),
        providerId: identity.providerId,
        mediaId: identity.mediaId,
        addedAt: typeof value.addedAt === 'number' ? value.addedAt : Date.now(),
        song,
    };
};

/** One playlist from stored or imported data, or null when it is not one. Entries that are not songs of an online platform are dropped, and a song is kept once. */
export const normalizePlaylist = (value: unknown): CrossPlaylist | null => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
    const seen = new Set<string>();
    const entries: CrossPlaylistEntry[] = [];
    for (const raw of Array.isArray(value.entries) ? value.entries : []) {
        const entry = normalizeEntry(raw);
        if (!entry) continue;
        const key = crossSongKey(entry.providerId, entry.mediaId);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
    }
    const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
    const playlist: CrossPlaylist = {
        id: value.id,
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.id,
        createdAt,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt,
        entries,
    };
    if (typeof value.deletedAt === 'number') playlist.deletedAt = value.deletedAt;
    return playlist;
};

export const normalizePlaylists = (value: unknown): CrossPlaylist[] => {
    const seen = new Set<string>();
    const playlists: CrossPlaylist[] = [];
    for (const raw of Array.isArray(value) ? value : []) {
        const playlist = normalizePlaylist(raw);
        if (!playlist || seen.has(playlist.id)) continue;
        seen.add(playlist.id);
        playlists.push(playlist);
    }
    return playlists;
};

/** Merges `incoming` into `current`: a playlist only one side has is kept, and when both have it the one that changed later wins whole. */
export const mergePlaylists = (
    current: readonly CrossPlaylist[],
    incoming: readonly CrossPlaylist[],
): { playlists: CrossPlaylist[]; added: number; updated: number } => {
    const byId = new Map(current.map(playlist => [playlist.id, playlist]));
    let added = 0;
    let updated = 0;
    for (const playlist of incoming) {
        const existing = byId.get(playlist.id);
        if (!existing) {
            byId.set(playlist.id, playlist);
            if (playlist.deletedAt === undefined) added += 1;
        } else if (playlist.updatedAt > existing.updatedAt) {
            byId.set(playlist.id, playlist);
            if (playlist.deletedAt === undefined) updated += 1;
        }
    }
    return { playlists: [...byId.values()], added, updated };
};

export const serializePlaylists = (playlists: readonly CrossPlaylist[]): string => JSON.stringify({
    format: CROSS_PLAYLIST_EXPORT_FORMAT,
    version: CROSS_PLAYLIST_EXPORT_VERSION,
    exportedAt: Date.now(),
    playlists,
}, null, 2);

/** The playlists in an exported file, or null when the text is not one. */
export const parseExportedPlaylists = (text: string): CrossPlaylist[] | null => {
    try {
        const data: unknown = JSON.parse(text);
        if (!isRecord(data) || data.format !== CROSS_PLAYLIST_EXPORT_FORMAT || !Array.isArray(data.playlists)) return null;
        return normalizePlaylists(data.playlists);
    } catch {
        return null;
    }
};
