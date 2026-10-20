import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// test/unit/electron/playlistSync.test.ts
// The server half of the cross-platform playlists' sync: groups, the codes that pair a second device, and the merge.

const require = createRequire(import.meta.url);
const { createPlaylistSync, mergeLists, CODE_LENGTH } = require('../../../server/stage-relay/playlistSync.cjs') as typeof import('../../../server/stage-relay/playlistSync.cjs');

const GROUP = 'a'.repeat(32);
const SECRET = 'b'.repeat(64);
const playlist = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, name: id, createdAt: 1, updatedAt, entries: [], ...extra });

let dir = '';
let clock = 1_000_000;
let server: http.Server;
let base = '';

const call = async (method: string, route: string, body?: unknown, secret?: string) => {
    const response = await fetch(`${base}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
};

beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'folia-sync-'));
    clock = 1_000_000;
    const sync = createPlaylistSync({ dataDir: dir, now: () => clock });
    server = http.createServer(async (req, res) => {
        const handled = await sync.handle(req, res, new URL(req.url || '/', 'http://x'));
        if (!handled) {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
});

describe('groups', () => {
    it('makes a group, keeps only a hash of the secret, and refuses a group that exists', async () => {
        expect((await call('POST', '/stage/sync/groups', { groupId: GROUP, secret: SECRET })).status).toBe(201);
        expect((await call('POST', '/stage/sync/groups', { groupId: GROUP, secret: SECRET })).status).toBe(409);
        expect((await call('POST', '/stage/sync/groups', { groupId: 'short', secret: SECRET })).status).toBe(400);
        const stored = require('node:fs').readFileSync(path.join(dir, `${GROUP}.json`), 'utf8') as string;
        expect(stored).not.toContain(SECRET);
    });

    it('answers a wrong secret and an unknown group the same way', async () => {
        await call('POST', '/stage/sync/groups', { groupId: GROUP, secret: SECRET });
        const wrong = await call('GET', `/stage/sync/groups/${GROUP}`, undefined, 'c'.repeat(64));
        const unknown = await call('GET', `/stage/sync/groups/${'d'.repeat(32)}`, undefined, SECRET);
        const none = await call('GET', `/stage/sync/groups/${GROUP}`);
        expect([wrong.status, unknown.status, none.status]).toEqual([401, 401, 401]);
        expect(wrong.body).toEqual(unknown.body);
    });

    it('answers the preflight of a page on another origin', async () => {
        const response = await fetch(`${base}/stage/sync/groups/${GROUP}`, { method: 'OPTIONS' });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    });

    it('is not its business what is not under /stage/sync/', async () => {
        expect((await fetch(`${base}/stage/health`)).status).toBe(404);
    });
});

describe('syncing', () => {
    beforeEach(async () => {
        await call('POST', '/stage/sync/groups', { groupId: GROUP, secret: SECRET });
    });

    it('merges what a device sends with what is there and answers with the merged set', async () => {
        const first = await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('a', 10), playlist('b', 10)] }, SECRET);
        expect(first.status).toBe(200);
        expect(first.body.playlists).toHaveLength(2);
        expect(first.body.revision).toBe(1);

        const second = await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('b', 20, { name: 'B2' }), playlist('c', 5)] }, SECRET);
        expect(second.body.playlists.map((item: { id: string }) => item.id).sort()).toEqual(['a', 'b', 'c']);
        expect(second.body.playlists.find((item: { id: string }) => item.id === 'b').name).toBe('B2');
        expect(second.body.revision).toBe(2);

        const read = await call('GET', `/stage/sync/groups/${GROUP}`, undefined, SECRET);
        expect(read.body.playlists).toHaveLength(3);
    });

    it('does not take an older copy over a newer one, and does not count a change that changed nothing', async () => {
        await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('a', 20, { name: 'new' })] }, SECRET);
        const older = await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('a', 10, { name: 'old' })] }, SECRET);
        expect(older.body.playlists[0].name).toBe('new');
        expect(older.body.revision).toBe(1);
    });

    it('keeps a deleted playlist as a mark so an older copy cannot bring it back', async () => {
        await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('a', 10)] }, SECRET);
        await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('a', 30, { deletedAt: 30 })] }, SECRET);
        const back = await call('POST', `/stage/sync/groups/${GROUP}`, { playlists: [playlist('a', 10)] }, SECRET);
        expect(back.body.playlists[0].deletedAt).toBe(30);
    });

    it('refuses what is not a list of playlists', async () => {
        for (const playlists of ['x', [{ nope: true }], [playlist('a', 1), playlist('a', 2)], [{ id: 'a', updatedAt: 'late', entries: [] }]]) {
            expect((await call('POST', `/stage/sync/groups/${GROUP}`, { playlists }, SECRET)).status).toBe(400);
        }
    });

    it('can delete the group', async () => {
        expect((await call('DELETE', `/stage/sync/groups/${GROUP}`, undefined, SECRET)).status).toBe(200);
        expect(readdirSync(dir).filter(name => name.endsWith('.json'))).toEqual([]);
        expect((await call('GET', `/stage/sync/groups/${GROUP}`, undefined, SECRET)).status).toBe(401);
    });
});

describe('pairing a second device with a code', () => {
    beforeEach(async () => {
        await call('POST', '/stage/sync/groups', { groupId: GROUP, secret: SECRET });
    });

    it('hands the group over once, and a code works only once', async () => {
        const made = await call('POST', '/stage/sync/pair', { groupId: GROUP }, SECRET);
        expect(made.status).toBe(200);
        expect(made.body.code).toHaveLength(CODE_LENGTH);
        expect(made.body.code).toMatch(/^[2-9A-HJKMNP-Z]+$/);

        const redeemed = await call('POST', '/stage/sync/redeem', { code: made.body.code });
        expect(redeemed.body).toEqual({ groupId: GROUP, secret: SECRET });
        expect((await call('POST', '/stage/sync/redeem', { code: made.body.code })).status).toBe(404);
    });

    it('takes a code as it is typed: lower case, with spaces or a dash', async () => {
        const { body } = await call('POST', '/stage/sync/pair', { groupId: GROUP }, SECRET);
        const typed = `${body.code.slice(0, 4)}-${body.code.slice(4)}`.toLowerCase();
        expect((await call('POST', '/stage/sync/redeem', { code: ` ${typed} ` })).status).toBe(200);
    });

    it('lets a code run out', async () => {
        const { body } = await call('POST', '/stage/sync/pair', { groupId: GROUP }, SECRET);
        clock += 6 * 60 * 1000;
        expect((await call('POST', '/stage/sync/redeem', { code: body.code })).status).toBe(404);
    });

    it('wants the secret to make a code', async () => {
        expect((await call('POST', '/stage/sync/pair', { groupId: GROUP })).status).toBe(401);
        expect((await call('POST', '/stage/sync/pair', { groupId: GROUP }, 'c'.repeat(64))).status).toBe(401);
    });

    it('slows down guessing', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 20; i += 1) statuses.push((await call('POST', '/stage/sync/redeem', { code: `GUESS${i}XX` })).status);
        expect(statuses.slice(0, 15).every(status => status === 404)).toBe(true);
        expect(statuses.slice(15).every(status => status === 429)).toBe(true);
        clock += 61_000;
        expect((await call('POST', '/stage/sync/redeem', { code: 'ANOTHER1' })).status).toBe(404);
    });
});

describe('mergeLists', () => {
    it('keeps the later change of a playlist and the playlists only one side has', () => {
        const merged = mergeLists([playlist('a', 1), playlist('b', 5)] as any, [playlist('a', 2, { name: 'A2' }), playlist('c', 1)] as any);
        expect(merged.map((item: any) => `${item.id}:${item.name}`).sort()).toEqual(['a:A2', 'b:b', 'c:c']);
    });
});
