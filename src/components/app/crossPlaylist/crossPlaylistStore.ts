import { create } from 'zustand';
import type { SongResult } from '../../../types';
import { getFromCache, saveToCache } from '../../../services/db';
import {
    addSongsToPlaylist,
    applySourceSnapshot,
    createCrossPlaylist,
    linkSource,
    markPlaylistDeleted,
    mergePlaylists,
    moveEntryInPlaylist,
    normalizePlaylists,
    parseExportedPlaylists,
    removeEntryFromPlaylist,
    renamePlaylist,
    sourceIdOf,
    unlinkSource,
    serializePlaylists,
    visiblePlaylists,
    type CrossPlaylist,
} from './crossPlaylistModel';
import { fetchPlaylistSongs } from './crossPlaylistSourceFetch';
import {
    createSyncGroup,
    CrossSyncError,
    readSyncConfig,
    redeemSyncCode,
    requestSyncCode,
    syncPlaylists,
    writeSyncConfig,
    type CrossSyncConfig,
    type CrossSyncErrorKind,
} from './crossPlaylistSyncClient';

// src/components/app/crossPlaylist/crossPlaylistStore.ts
// The playlists that hold songs of any online platform, kept on this device (the browser's IndexedDB, or the desktop app's own store of
// the same name), and the state of the window that shows them.
//
// Everything that changes a playlist goes through `commit`, which writes the whole set back, one write after another: two quick changes
// never write over each other. Asking the browser to keep the storage (not to clear it when the disk is short) happens with the first write.
//
// When the device has joined a sync group (see crossPlaylistSyncClient.ts), a change is sent to the server a moment after it is made, and
// what the server has is merged in when the window opens, now and then while it is open, and when the page comes back into view. A merge
// keeps the later change of each playlist, so the devices end with the same playlists whichever way round they sync.

export const CROSS_PLAYLISTS_CACHE_KEY = 'cross_playlists_v1';

let persistAsked = false;
const askBrowserToKeepStorage = () => {
    if (persistAsked) return;
    persistAsked = true;
    try {
        void navigator.storage?.persist?.();
    } catch {
        // A browser that does not offer it keeps the data as it always did.
    }
};

let writeChain: Promise<void> = Promise.resolve();

const PUSH_DELAY_MS = 1500;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let changedWhileSyncing = false;

const sameSet = (a: readonly CrossPlaylist[], b: readonly CrossPlaylist[]): boolean => (
    a.length === b.length && a.every(item => b.some(other => other.id === item.id && other.updatedAt === item.updatedAt))
);

export interface ImportRequest {
    items: Array<{ providerId: string; collectionId: string; name: string }>;
    /** An existing playlist to merge into, or null for a new playlist (named after the platform playlist) for each. */
    targetPlaylistId: string | null;
    /** Keep following the platform playlists, so a refresh brings in what they get later. */
    follow: boolean;
    onProgress?: (done: number, total: number, name: string) => void;
}

export interface ImportOutcome {
    name: string;
    playlistId: string | null;
    added: number;
    removed: number;
    error?: string;
}

interface CrossPlaylistState {
    /** Every playlist, deleted ones too (as marks); the window shows `visiblePlaylists` of it. */
    playlists: CrossPlaylist[];
    loaded: boolean;
    isOpen: boolean;
    /** The playlist whose songs the window shows; null for the list of playlists. */
    openPlaylistId: string | null;
    /** Songs somebody asked to put in a playlist (the queue list of the command palette): the window asks which playlist first. */
    pendingAdd: SongResult[] | null;
    /** The group this device syncs with, or null when it does not sync. */
    syncConfig: CrossSyncConfig | null;
    syncState: 'idle' | 'syncing' | 'error';
    syncError: CrossSyncErrorKind | null;
    lastSyncedAt: number | null;
    load: () => Promise<void>;
    syncNow: () => Promise<void>;
    /** Makes a group on the server when the device has none, and a code to join it from another device. */
    startSync: (serverUrl: string) => Promise<{ code: string; expiresInSec: number }>;
    newSyncCode: () => Promise<{ code: string; expiresInSec: number }>;
    joinSync: (serverUrl: string, code: string) => Promise<void>;
    leaveSync: () => void;
    open: (playlistId?: string | null) => void;
    /** Opens the window to ask which playlist these songs go into (or a new one). */
    openToAdd: (songs: readonly SongResult[]) => void;
    close: () => void;
    openPlaylist: (playlistId: string | null) => void;
    create: (name: string, songs?: readonly SongResult[]) => Promise<CrossPlaylist>;
    rename: (playlistId: string, name: string) => Promise<void>;
    remove: (playlistId: string) => Promise<void>;
    addSongs: (playlistId: string, songs: readonly SongResult[]) => Promise<{ added: number; skipped: number }>;
    removeEntry: (playlistId: string, entryId: string) => Promise<void>;
    moveEntry: (playlistId: string, entryId: string, toIndex: number) => Promise<void>;
    /** `playlistId|sourceId` of the followed playlists being read from their platform right now. */
    refreshing: string[];
    /** Merges platform playlists of the signed-in accounts into one (an existing one, or a new one for each); with `follow` they are followed. */
    importAccountPlaylists: (request: ImportRequest) => Promise<ImportOutcome[]>;
    /** Reads one followed platform playlist again and brings the difference in. */
    refreshSource: (playlistId: string, sourceId: string) => Promise<{ added: number; removed: number }>;
    refreshAllSources: (playlistId: string) => Promise<{ added: number; removed: number; failed: number }>;
    unlinkPlaylistSource: (playlistId: string, sourceId: string) => Promise<void>;
    exportText: () => string;
    importText: (text: string) => Promise<{ ok: boolean; added: number; updated: number }>;
}

export const useCrossPlaylistStore = create<CrossPlaylistState>((set, get) => {
    /** Applies a change to the playlists and writes the result; resolves when it is on disk. */
    const commit = (change: (playlists: CrossPlaylist[]) => CrossPlaylist[], options: { push?: boolean } = {}): Promise<void> => {
        const next = change(get().playlists);
        set({ playlists: next });
        askBrowserToKeepStorage();
        writeChain = writeChain.then(() => saveToCache(CROSS_PLAYLISTS_CACHE_KEY, next));
        if (options.push !== false && get().syncConfig) {
            changedWhileSyncing = true;
            schedulePush();
        }
        return writeChain;
    };

    /** A change goes to the server a moment after it is made, so a run of them (a drag, a batch of songs) is one trip. */
    const schedulePush = () => {
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            pushTimer = null;
            // A failure is on the store (`syncState`) for the window to show; nobody waits on this call.
            void get().syncNow().catch(() => {});
        }, PUSH_DELAY_MS);
    };

    const failSync = (error: unknown): never => {
        const kind: CrossSyncErrorKind = error instanceof CrossSyncError ? error.kind : 'server';
        set({ syncState: 'error', syncError: kind });
        throw error;
    };

    const updatePlaylist = (playlistId: string, update: (playlist: CrossPlaylist) => CrossPlaylist) => commit(
        playlists => playlists.map(playlist => (playlist.id === playlistId && playlist.deletedAt === undefined ? update(playlist) : playlist)),
    );

    return {
        playlists: [],
        loaded: false,
        syncConfig: readSyncConfig(),
        syncState: 'idle',
        syncError: null,
        lastSyncedAt: null,
        isOpen: false,
        openPlaylistId: null,
        pendingAdd: null,
        load: async () => {
            if (get().loaded) return;
            const stored = normalizePlaylists(await getFromCache<unknown>(CROSS_PLAYLISTS_CACHE_KEY));
            // Changes made while it was loading are kept: the stored set is merged under them.
            set(state => ({ playlists: mergePlaylists(stored, state.playlists).playlists, loaded: true }));
            if (get().syncConfig) void get().syncNow().catch(() => {});
        },
        syncNow: async () => {
            const config = get().syncConfig;
            if (!config) return;
            if (syncing) {
                changedWhileSyncing = true;
                return;
            }
            await get().load();
            syncing = true;
            changedWhileSyncing = false;
            set({ syncState: 'syncing', syncError: null });
            try {
                const remote = await syncPlaylists(config, get().playlists);
                const merged = mergePlaylists(get().playlists, remote);
                // What the server sent changes this device's playlists: written, but not sent back (it came from there).
                if (!sameSet(merged.playlists, get().playlists)) await commit(() => merged.playlists, { push: false });
                set({ syncState: 'idle', syncError: null, lastSyncedAt: Date.now() });
            } catch (error) {
                failSync(error);
            } finally {
                syncing = false;
                // Something changed here while the server was being asked: it has not seen that yet.
                if (changedWhileSyncing && get().syncConfig && get().syncState !== 'error') schedulePush();
            }
        },
        startSync: async (serverUrl) => {
            try {
                let config = get().syncConfig;
                if (!config) {
                    config = await createSyncGroup(serverUrl);
                    writeSyncConfig(config);
                    set({ syncConfig: config, syncState: 'idle', syncError: null });
                }
                const code = await requestSyncCode(config);
                // The server has this device's playlists before the other device asks for them.
                await get().syncNow();
                return code;
            } catch (error) {
                return failSync(error);
            }
        },
        newSyncCode: async () => {
            const config = get().syncConfig;
            if (!config) throw new CrossSyncError('unauthorized');
            try {
                return await requestSyncCode(config);
            } catch (error) {
                return failSync(error);
            }
        },
        joinSync: async (serverUrl, code) => {
            try {
                const config = await redeemSyncCode(serverUrl, code);
                writeSyncConfig(config);
                set({ syncConfig: config, syncState: 'idle', syncError: null });
                // This device's own playlists go to the group, and the group's come here: neither side loses any.
                await get().syncNow();
            } catch (error) {
                failSync(error);
            }
        },
        leaveSync: () => {
            if (pushTimer) clearTimeout(pushTimer);
            pushTimer = null;
            writeSyncConfig(null);
            set({ syncConfig: null, syncState: 'idle', syncError: null, lastSyncedAt: null });
        },
        open: (playlistId = null) => {
            set({ isOpen: true, openPlaylistId: playlistId, pendingAdd: null });
            void get().load();
        },
        openToAdd: (songs) => {
            set({ isOpen: true, openPlaylistId: null, pendingAdd: [...songs] });
            void get().load();
        },
        close: () => set({ isOpen: false, pendingAdd: null }),
        openPlaylist: (playlistId) => set({ openPlaylistId: playlistId }),
        create: async (name, songs = []) => {
            await get().load();
            const base = createCrossPlaylist(name);
            const playlist = songs.length > 0 ? addSongsToPlaylist(base, songs).playlist : base;
            await commit(playlists => [...playlists, playlist]);
            return playlist;
        },
        rename: async (playlistId, name) => {
            await get().load();
            await updatePlaylist(playlistId, playlist => renamePlaylist(playlist, name));
        },
        remove: async (playlistId) => {
            await get().load();
            await commit(playlists => playlists.map(playlist => (playlist.id === playlistId ? markPlaylistDeleted(playlist) : playlist)));
            if (get().openPlaylistId === playlistId) set({ openPlaylistId: null });
        },
        addSongs: async (playlistId, songs) => {
            await get().load();
            let result = { added: 0, skipped: songs.length };
            await updatePlaylist(playlistId, playlist => {
                const outcome = addSongsToPlaylist(playlist, songs);
                result = { added: outcome.added, skipped: outcome.skipped };
                return outcome.playlist;
            });
            return result;
        },
        removeEntry: async (playlistId, entryId) => {
            await updatePlaylist(playlistId, playlist => removeEntryFromPlaylist(playlist, entryId));
        },
        moveEntry: async (playlistId, entryId, toIndex) => {
            await updatePlaylist(playlistId, playlist => moveEntryInPlaylist(playlist, entryId, toIndex));
        },
        refreshing: [],
        importAccountPlaylists: async ({ items, targetPlaylistId, follow, onProgress }) => {
            await get().load();
            const outcomes: ImportOutcome[] = [];
            let targetId = targetPlaylistId;
            for (const [index, item] of items.entries()) {
                onProgress?.(index, items.length, item.name);
                try {
                    const songs = await fetchPlaylistSongs(item.providerId, item.collectionId, item.name);
                    // A new playlist for each one picked; into an existing one, every one goes there.
                    let playlistId = targetId;
                    if (!playlistId) playlistId = (await get().create(item.name)).id;
                    const sourceId = sourceIdOf(item.providerId, item.collectionId);
                    let result = { added: 0, removed: 0 };
                    await updatePlaylist(playlistId, playlist => {
                        if (follow) {
                            const outcome = applySourceSnapshot(linkSource(playlist, item), sourceId, songs);
                            result = { added: outcome.added, removed: outcome.removed };
                            return outcome.playlist;
                        }
                        const outcome = addSongsToPlaylist(playlist, songs);
                        result = { added: outcome.added, removed: 0 };
                        return outcome.playlist;
                    });
                    outcomes.push({ name: item.name, playlistId, ...result });
                } catch (error) {
                    outcomes.push({ name: item.name, playlistId: null, added: 0, removed: 0, error: error instanceof Error ? error.message : String(error) });
                }
            }
            onProgress?.(items.length, items.length, '');
            return outcomes;
        },
        refreshSource: async (playlistId, sourceId) => {
            await get().load();
            const source = get().playlists.find(playlist => playlist.id === playlistId && playlist.deletedAt === undefined)?.sources?.find(item => item.id === sourceId);
            if (!source) return { added: 0, removed: 0 };
            const mark = `${playlistId}|${sourceId}`;
            set(state => ({ refreshing: state.refreshing.includes(mark) ? state.refreshing : [...state.refreshing, mark] }));
            try {
                const songs = await fetchPlaylistSongs(source.providerId, source.collectionId, source.name);
                let result = { added: 0, removed: 0 };
                await updatePlaylist(playlistId, playlist => {
                    const outcome = applySourceSnapshot(playlist, sourceId, songs);
                    result = { added: outcome.added, removed: outcome.removed };
                    return outcome.playlist;
                });
                return result;
            } finally {
                set(state => ({ refreshing: state.refreshing.filter(item => item !== mark) }));
            }
        },
        refreshAllSources: async (playlistId) => {
            const sources = get().playlists.find(playlist => playlist.id === playlistId)?.sources ?? [];
            const total = { added: 0, removed: 0, failed: 0 };
            for (const source of sources) {
                try {
                    const result = await get().refreshSource(playlistId, source.id);
                    total.added += result.added;
                    total.removed += result.removed;
                } catch {
                    total.failed += 1;
                }
            }
            return total;
        },
        unlinkPlaylistSource: async (playlistId, sourceId) => {
            await get().load();
            await updatePlaylist(playlistId, playlist => unlinkSource(playlist, sourceId));
        },
        exportText: () => serializePlaylists(get().playlists),
        importText: async (text) => {
            const incoming = parseExportedPlaylists(text);
            if (!incoming) return { ok: false, added: 0, updated: 0 };
            await get().load();
            const merged = mergePlaylists(get().playlists, incoming);
            await commit(() => merged.playlists);
            return { ok: true, added: merged.added, updated: merged.updated };
        },
    };
});

export const selectVisibleCrossPlaylists = (state: CrossPlaylistState): CrossPlaylist[] => visiblePlaylists(state.playlists);
