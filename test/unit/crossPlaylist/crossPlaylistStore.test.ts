import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

// test/unit/crossPlaylist/crossPlaylistStore.test.ts
// The store behind the cross-platform playlists: what it keeps, writes and reads back.

const disk = new Map<string, unknown>();
vi.mock('../../../src/services/db', () => ({
    getFromCache: async (key: string) => (disk.has(key) ? JSON.parse(JSON.stringify(disk.get(key))) : null),
    saveToCache: async (key: string, data: unknown) => { disk.set(key, JSON.parse(JSON.stringify(data))); },
}));

const song = (providerId: string, mediaId: string): SongResult => ({
    id: 1,
    name: `${providerId}-${mediaId}`,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId, mediaId },
} as unknown as SongResult);

const loadStore = async () => {
    vi.resetModules();
    return (await import('../../../src/components/app/crossPlaylist/crossPlaylistStore')).useCrossPlaylistStore;
};

describe('cross-platform playlist store', () => {
    beforeEach(() => disk.clear());

    it('creates a playlist with songs of several platforms and writes it to the device', async () => {
        const store = await loadStore();
        const playlist = await store.getState().create('Mix', [song('netease', '1'), song('qq', 'a')]);
        expect(playlist.entries).toHaveLength(2);
        const written = disk.get('cross_playlists_v1') as Array<{ name: string; entries: unknown[] }>;
        expect(written.map(item => item.name)).toEqual(['Mix']);
        expect(written[0].entries).toHaveLength(2);
    });

    it('reads what was written back after a restart', async () => {
        const first = await loadStore();
        const playlist = await first.getState().create('Mix', [song('netease', '1')]);
        await first.getState().addSongs(playlist.id, [song('kugou', 'h')]);

        const second = await loadStore();
        await second.getState().load();
        const loaded = second.getState().playlists;
        expect(loaded).toHaveLength(1);
        expect(loaded[0].entries.map(entry => entry.providerId)).toEqual(['netease', 'kugou']);
    });

    it('does not lose a playlist made while the stored ones were still being read', async () => {
        disk.set('cross_playlists_v1', [{ id: 'old', name: 'Old', createdAt: 1, updatedAt: 1, entries: [] }]);
        const store = await loadStore();
        const loading = store.getState().load();
        const created = store.getState().create('New');
        await Promise.all([loading, created]);
        expect(store.getState().playlists.map(playlist => playlist.name).sort()).toEqual(['New', 'Old']);
    });

    it('writes quick changes one after another so none is lost', async () => {
        const store = await loadStore();
        const playlist = await store.getState().create('Mix');
        await Promise.all([
            store.getState().addSongs(playlist.id, [song('netease', '1')]),
            store.getState().addSongs(playlist.id, [song('qq', 'a')]),
            store.getState().rename(playlist.id, 'Renamed'),
        ]);
        const written = disk.get('cross_playlists_v1') as Array<{ name: string; entries: unknown[] }>;
        expect(written[0].name).toBe('Renamed');
        expect(written[0].entries).toHaveLength(2);
    });

    it('moves and removes entries, and deleting leaves a mark that is not shown', async () => {
        const store = await loadStore();
        const playlist = await store.getState().create('Mix', [song('netease', '1'), song('qq', 'a'), song('kugou', 'h')]);
        const [first, , third] = playlist.entries;
        await store.getState().moveEntry(playlist.id, third.id, 0);
        await store.getState().removeEntry(playlist.id, first.id);
        const current = store.getState().playlists[0];
        expect(current.entries.map(entry => entry.providerId)).toEqual(['kugou', 'qq']);

        await store.getState().remove(playlist.id);
        const { selectVisibleCrossPlaylists } = await import('../../../src/components/app/crossPlaylist/crossPlaylistStore');
        expect(selectVisibleCrossPlaylists(store.getState())).toEqual([]);
        expect((disk.get('cross_playlists_v1') as Array<{ deletedAt?: number }>)[0].deletedAt).toBeTypeOf('number');
    });

    it('exports and imports, merging with what is there', async () => {
        const store = await loadStore();
        const playlist = await store.getState().create('Mix', [song('netease', '1')]);
        const text = store.getState().exportText();

        disk.clear(); // another device: nothing stored there yet
        const other = await loadStore();
        const result = await other.getState().importText(text);
        expect(result).toEqual({ ok: true, added: 1, updated: 0 });
        expect(other.getState().playlists[0].id).toBe(playlist.id);
        // importing the same file again changes nothing
        expect(await other.getState().importText(text)).toEqual({ ok: true, added: 0, updated: 0 });
        expect(await other.getState().importText('junk')).toEqual({ ok: false, added: 0, updated: 0 });
    });
});
