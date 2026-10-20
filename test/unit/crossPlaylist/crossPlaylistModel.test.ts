import { describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import {
    addSongsToPlaylist,
    canHoldInCrossPlaylist,
    countByProvider,
    createCrossPlaylist,
    markPlaylistDeleted,
    mergePlaylists,
    moveEntryInPlaylist,
    normalizePlaylists,
    parseExportedPlaylists,
    removeEntryFromPlaylist,
    renamePlaylist,
    serializePlaylists,
    toStoredSong,
    visiblePlaylists,
} from '../../../src/components/app/crossPlaylist/crossPlaylistModel';

// test/unit/crossPlaylist/crossPlaylistModel.test.ts
// The playlist that holds songs of any online platform: what goes in, how it changes, and how two copies of it merge.

const online = (providerId: string, mediaId: string, name = `${providerId}-${mediaId}`): SongResult => ({
    id: Number(mediaId) || 0,
    name,
    artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' },
    durationMs: 180000,
    sourceRef: { kind: 'online', providerId, mediaId },
} as unknown as SongResult);

const local = { id: 5, name: 'Local', artists: [], album: { id: 0, name: '' }, durationMs: 1, sourceRef: { kind: 'local', mediaId: 'abc' } } as unknown as SongResult;

describe('what can go in', () => {
    it('takes songs of the online platforms and refuses the ones that mean nothing on another device', () => {
        expect(canHoldInCrossPlaylist(online('netease', '1'))).toBe(true);
        expect(canHoldInCrossPlaylist(online('qq', 'x'))).toBe(true);
        expect(canHoldInCrossPlaylist(local)).toBe(false);
        expect(canHoldInCrossPlaylist(null)).toBe(false);
    });

    it('keeps a song without what only describes the moment it was seen', () => {
        const song = { ...online('netease', '1'), playbackSourceRevision: 'rev-1', replayGain: { trackGain: 1 } } as unknown as SongResult;
        const stored = toStoredSong(song) as unknown as Record<string, unknown>;
        expect(stored.playbackSourceRevision).toBeUndefined();
        expect(stored.replayGain).toBeUndefined();
        expect(stored.name).toBe('netease-1');
    });
});

describe('adding songs', () => {
    it('adds songs of different platforms in order, once each, and counts what it skipped', () => {
        const base = createCrossPlaylist('Mix', 100);
        const result = addSongsToPlaylist(base, [online('netease', '1'), online('qq', 'a'), online('netease', '1'), local, online('kugou', 'h')], 200);
        expect(result.added).toBe(3);
        expect(result.skipped).toBe(2);
        expect(result.playlist.entries.map(entry => `${entry.providerId}:${entry.mediaId}`)).toEqual(['netease:1', 'qq:a', 'kugou:h']);
        expect(result.playlist.updatedAt).toBe(200);
    });

    it('treats the same media id on two platforms as two songs', () => {
        const result = addSongsToPlaylist(createCrossPlaylist('Mix'), [online('netease', '7'), online('qq', '7')]);
        expect(result.added).toBe(2);
    });

    it('leaves the playlist, and its time, alone when nothing was added', () => {
        const filled = addSongsToPlaylist(createCrossPlaylist('Mix', 1), [online('netease', '1')], 2).playlist;
        const again = addSongsToPlaylist(filled, [online('netease', '1')], 99);
        expect(again.added).toBe(0);
        expect(again.playlist).toBe(filled);
    });
});

describe('changing a playlist', () => {
    const filled = addSongsToPlaylist(createCrossPlaylist('Mix', 1), [online('netease', '1'), online('qq', 'a'), online('kugou', 'h')], 2).playlist;
    const ids = filled.entries.map(entry => entry.id);

    it('moves an entry and keeps its identity', () => {
        const moved = moveEntryInPlaylist(filled, ids[0], 2, 5);
        expect(moved.entries.map(entry => entry.id)).toEqual([ids[1], ids[2], ids[0]]);
        expect(moved.updatedAt).toBe(5);
        expect(moveEntryInPlaylist(filled, ids[0], 99).entries.at(-1)?.id).toBe(ids[0]);
        expect(moveEntryInPlaylist(filled, ids[1], 1)).toBe(filled);
        expect(moveEntryInPlaylist(filled, 'missing', 0)).toBe(filled);
    });

    it('removes an entry', () => {
        const removed = removeEntryFromPlaylist(filled, ids[1], 7);
        expect(removed.entries.map(entry => entry.mediaId)).toEqual(['1', 'h']);
        expect(removeEntryFromPlaylist(filled, 'missing')).toBe(filled);
    });

    it('renames only when the name really changes', () => {
        expect(renamePlaylist(filled, '  New  ', 9).name).toBe('New');
        expect(renamePlaylist(filled, 'Mix')).toBe(filled);
        expect(renamePlaylist(filled, '   ')).toBe(filled);
    });

    it('says what each platform contributes', () => {
        expect(countByProvider(filled)).toEqual([['netease', 1], ['qq', 1], ['kugou', 1]]);
    });
});

describe('deleting and merging', () => {
    it('keeps a deleted playlist as a mark that is not shown', () => {
        const alive = createCrossPlaylist('A', 1);
        const gone = markPlaylistDeleted(addSongsToPlaylist(createCrossPlaylist('B', 1), [online('netease', '1')]).playlist, 50);
        expect(gone.entries).toEqual([]);
        expect(gone.deletedAt).toBe(50);
        expect(visiblePlaylists([alive, gone]).map(playlist => playlist.name)).toEqual(['A']);
    });

    it('keeps what only one side has, and the later change when both have the playlist', () => {
        const a = { ...createCrossPlaylist('A', 1), id: 'a', updatedAt: 10 };
        const bOld = { ...createCrossPlaylist('B-old', 1), id: 'b', updatedAt: 10 };
        const bNew = { ...createCrossPlaylist('B-new', 1), id: 'b', updatedAt: 20 };
        const c = { ...createCrossPlaylist('C', 1), id: 'c', updatedAt: 5 };
        const merged = mergePlaylists([a, bOld], [bNew, c]);
        expect(merged.playlists.map(playlist => playlist.name).sort()).toEqual(['A', 'B-new', 'C']);
        expect(merged.added).toBe(1);
        expect(merged.updated).toBe(1);
        // the older copy does not win
        expect(mergePlaylists([bNew], [bOld]).playlists[0].name).toBe('B-new');
    });

    it('does not bring a deleted playlist back from an older copy', () => {
        const alive = { ...createCrossPlaylist('A', 1), id: 'a', updatedAt: 10 };
        const deleted = markPlaylistDeleted(alive, 30);
        expect(visiblePlaylists(mergePlaylists([deleted], [alive]).playlists)).toEqual([]);
        expect(visiblePlaylists(mergePlaylists([alive], [deleted]).playlists)).toEqual([]);
    });
});

describe('the exported file', () => {
    it('round-trips playlists and tells a file that is not one', () => {
        const playlist = addSongsToPlaylist(createCrossPlaylist('Mix', 1), [online('netease', '1'), online('qq', 'a')], 2).playlist;
        const parsed = parseExportedPlaylists(serializePlaylists([playlist]));
        expect(parsed).toHaveLength(1);
        expect(parsed?.[0].entries.map(entry => entry.mediaId)).toEqual(['1', 'a']);
        expect(parseExportedPlaylists('not json')).toBeNull();
        expect(parseExportedPlaylists(JSON.stringify({ format: 'something-else', playlists: [] }))).toBeNull();
    });

    it('drops what is not a playlist or a song of an online platform when reading stored data', () => {
        const playlists = normalizePlaylists([
            { id: 'ok', name: 'Fine', entries: [{ song: online('netease', '1') }, { song: local }, { nope: true }, { song: online('netease', '1') }] },
            { name: 'no id' },
            'junk',
            { id: 'ok', name: 'duplicate id' },
        ]);
        expect(playlists).toHaveLength(1);
        expect(playlists[0].entries).toHaveLength(1);
    });
});
