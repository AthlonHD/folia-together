import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

// test/unit/crossPlaylist/crossPlaylistSync.test.ts
// Two devices and the real server module: pairing with a code, then changes travelling both ways.

// Each boot loads a fresh copy of the store (and what it imports): slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const { createPlaylistSync } = require('../../../server/stage-relay/playlistSync.cjs') as typeof import('../../../server/stage-relay/playlistSync.cjs');

type Device = { disk: Map<string, unknown>; storage: Map<string, string> };
const devices: Record<string, Device> = {};
let current = '';

const song = (providerId: string, mediaId: string): SongResult => ({
    id: 1,
    name: `${providerId}-${mediaId}`,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId, mediaId },
} as unknown as SongResult);

/** A fresh copy of the store, as one device has it: its own disk, its own localStorage. */
const boot = async (name: string) => {
    devices[name] ??= { disk: new Map(), storage: new Map() };
    current = name;
    const device = devices[name];
    // Each copy of the store gets the disk of its own device, whatever device is booted after it.
    vi.doMock('../../../src/services/db', () => ({
        getFromCache: async (key: string) => (device.disk.has(key) ? JSON.parse(JSON.stringify(device.disk.get(key))) : null),
        saveToCache: async (key: string, data: unknown) => { device.disk.set(key, JSON.parse(JSON.stringify(data))); },
    }));
    const storage = device.storage;
    (globalThis as any).localStorage = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
    };
    vi.resetModules();
    return (await import('../../../src/components/app/crossPlaylist/crossPlaylistStore')).useCrossPlaylistStore;
};

let dir = '';
let server: http.Server;
let serverUrl = '';

beforeEach(async () => {
    for (const key of Object.keys(devices)) delete devices[key];
    dir = mkdtempSync(path.join(tmpdir(), 'folia-sync-e2e-'));
    const sync = createPlaylistSync({ dataDir: dir });
    server = http.createServer(async (req, res) => {
        if (!(await sync.handle(req, res, new URL(req.url || '/', 'http://x')))) {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
    delete (globalThis as any).localStorage;
});

const names = (store: Awaited<ReturnType<typeof boot>>) => store.getState().playlists.filter(playlist => !playlist.deletedAt).map(playlist => playlist.name).sort();

describe('pairing two devices', () => {
    it('hands the first device\'s playlists to the second one that joins with the code', async () => {
        const a = await boot('a');
        await a.getState().create('From A', [song('netease', '1'), song('qq', 'x')]);
        const { code } = await a.getState().startSync(serverUrl);
        expect(code).toHaveLength(8);
        expect(a.getState().syncConfig?.groupId).toMatch(/^[0-9a-f]{32}$/);

        const b = await boot('b');
        await b.getState().create('From B', [song('kugou', 'h')]);
        await b.getState().joinSync(serverUrl, code);
        // neither device loses its own playlists, and B now has A's
        expect(names(b)).toEqual(['From A', 'From B']);
        expect(b.getState().syncConfig?.groupId).toBe(a.getState().syncConfig?.groupId);
        expect(b.getState().lastSyncedAt).toBeTypeOf('number');

        // A picks B's up the next time it syncs
        await a.getState().syncNow();
        expect(names(a)).toEqual(['From A', 'From B']);
    });

    it('does not let a code be used twice, and says so', async () => {
        const a = await boot('a');
        const { code } = await a.getState().startSync(serverUrl);
        const b = await boot('b');
        await b.getState().joinSync(serverUrl, code);
        const c = await boot('c');
        await expect(c.getState().joinSync(serverUrl, code)).rejects.toMatchObject({ kind: 'badCode' });
        expect(c.getState().syncConfig).toBeNull();
        expect(c.getState().syncState).toBe('error');
        expect(c.getState().syncError).toBe('badCode');
    });
});

describe('changes between paired devices', () => {
    const pair = async () => {
        const a = await boot('a');
        const { code } = await a.getState().startSync(serverUrl);
        const b = await boot('b');
        await b.getState().joinSync(serverUrl, code);
        return { a, b };
    };

    it('carries a new playlist, added songs, a rename and a move from one device to the other', async () => {
        const { a, b } = await pair();
        const created = await b.getState().create('Road', [song('netease', '1'), song('qq', 'x'), song('kugou', 'h')]);
        await b.getState().syncNow();
        await a.getState().syncNow();
        const onA = a.getState().playlists.find(playlist => playlist.id === created.id)!;
        expect(onA.entries.map(entry => entry.providerId)).toEqual(['netease', 'qq', 'kugou']);

        await a.getState().moveEntry(created.id, onA.entries[2].id, 0);
        await a.getState().rename(created.id, 'Road trip');
        await a.getState().syncNow();
        await b.getState().syncNow();
        const onB = b.getState().playlists.find(playlist => playlist.id === created.id)!;
        expect(onB.name).toBe('Road trip');
        expect(onB.entries.map(entry => entry.providerId)).toEqual(['kugou', 'netease', 'qq']);
    });

    it('carries a deletion, and an older copy does not bring the playlist back', async () => {
        const { a, b } = await pair();
        const created = await a.getState().create('Gone soon', [song('netease', '1')]);
        await a.getState().syncNow();
        await b.getState().syncNow();
        expect(names(b)).toEqual(['Gone soon']);

        await a.getState().remove(created.id);
        await a.getState().syncNow();
        await b.getState().syncNow();
        expect(names(b)).toEqual([]);
        // B, with its mark, syncs again: A does not get the playlist back
        await b.getState().syncNow();
        await a.getState().syncNow();
        expect(names(a)).toEqual([]);
    });

    it('keeps the later of two changes to the same playlist', async () => {
        const { a, b } = await pair();
        const created = await a.getState().create('Shared', []);
        await a.getState().syncNow();
        await b.getState().syncNow();
        await a.getState().rename(created.id, 'A renamed');
        await new Promise(resolve => setTimeout(resolve, 5));
        await b.getState().rename(created.id, 'B renamed');
        await a.getState().syncNow();
        await b.getState().syncNow();
        await a.getState().syncNow();
        expect(names(a)).toEqual(['B renamed']);
        expect(names(b)).toEqual(['B renamed']);
    });

    it('stops syncing when a device leaves, and its playlists stay on it', async () => {
        const { a, b } = await pair();
        await a.getState().create('Mine', []);
        await a.getState().syncNow();
        await b.getState().syncNow();
        b.getState().leaveSync();
        expect(b.getState().syncConfig).toBeNull();
        expect(names(b)).toEqual(['Mine']);
        await a.getState().create('After', []);
        await a.getState().syncNow();
        await b.getState().syncNow();
        expect(names(b)).toEqual(['Mine']);
    });

    it('reports an unreachable server without losing anything', async () => {
        const { a } = await pair();
        await a.getState().create('Offline change', []);
        await new Promise<void>(resolve => server.close(() => resolve()));
        server = http.createServer();
        await expect(a.getState().syncNow()).rejects.toMatchObject({ kind: 'network' });
        expect(a.getState().syncState).toBe('error');
        expect(names(a)).toEqual(['Offline change']);
    });
});

describe('a device that is not syncing', () => {
    it('does not talk to a server at all', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const solo = await boot('solo');
        await solo.getState().create('Alone', [song('netease', '1')]);
        await solo.getState().syncNow();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        expect(current).toBe('solo');
    });
});
