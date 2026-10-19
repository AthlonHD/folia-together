import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/spotifyRelay.test.ts
// 本 Fork:网页版的 Spotify(server/stage-relay/spotify.cjs)。桌面版的 Spotify 桥在中继的 Node 进程里运行:
// 账号存在服务器本机(文件 + 密钥文件封存),经 /stage/spotify/api 与 /stage/spotify/audio/<id> 提供给带令牌的页面。

const require = createRequire(import.meta.url);
const { createSpotifyRelay, createKeyfileSeal, createFileStore, createSecretSeal, profileSecretOf } = require('../../../server/stage-relay/spotify.cjs') as {
    createSpotifyRelay: (options: Record<string, unknown>) => {
        request: (profile: { kind: 'shared' } | { kind: 'local'; secret: string }, operation: string, params?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>;
        handleApi: (req: unknown, res: unknown, sendJson: (res: unknown, status: number, payload: unknown) => void) => Promise<void>;
        handleAudio: (req: unknown, res: unknown, url: URL) => Promise<boolean>;
        localProfilesEnabled: boolean;
    };
    createKeyfileSeal: (file: string) => { encryptString: (text: string) => Buffer; decryptString: (buffer: Buffer) => string; isEncryptionAvailable: () => boolean };
    createFileStore: (file: string) => { get: (key: string) => unknown; set: (key: string, value: unknown) => void; delete: (key: string) => void };
    createSecretSeal: (secret: string) => { encryptString: (text: string) => Buffer; decryptString: (buffer: Buffer) => string };
    profileSecretOf: (req: { headers: Record<string, string> }, url: URL) => string;
};
const SHARED = { kind: 'shared' } as const;
const mine = (secret: string) => ({ kind: 'local', secret } as const);
const secretA = 'a'.repeat(40);
const secretB = 'b'.repeat(40);

const dirs: string[] = [];
const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-spotify-test-'));
    dirs.push(dir);
    return dir;
};
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const quiet = { log: () => undefined, warn: () => undefined };
const relayIn = (stateDir: string) => createSpotifyRelay({ stateDir, ...quiet, deps: { fetch: vi.fn(), openExternal: vi.fn() } });

describe('the account is kept on the server', () => {
    it('seals text with a key file and opens it again; a changed byte is refused', () => {
        const seal = createKeyfileSeal(path.join(tempDir(), 'secret'));
        const sealed = seal.encryptString('{"a":1}');
        expect(sealed.toString('utf8')).not.toContain('"a"');
        expect(seal.decryptString(sealed)).toBe('{"a":1}');
        const tampered = Buffer.from(sealed);
        tampered[tampered.length - 1] ^= 0xff;
        expect(() => seal.decryptString(tampered)).toThrow();
    });

    it('keeps the key between runs, so a sealed session can be read again', () => {
        const dir = tempDir();
        const sealed = createKeyfileSeal(path.join(dir, 'secret')).encryptString('hello');
        expect(createKeyfileSeal(path.join(dir, 'secret')).decryptString(sealed)).toBe('hello');
    });

    it('stores values in a file that a new store reads back', () => {
        const file = path.join(tempDir(), 'store.json');
        const store = createFileStore(file);
        store.set('A', 'x');
        expect(createFileStore(file).get('A')).toBe('x');
        store.delete('A');
        expect(createFileStore(file).get('A')).toBeUndefined();
    });
});

describe('the Spotify operations over the relay', () => {
    it('says nobody is signed in on a fresh server', async () => {
        const relay = relayIn(tempDir());
        expect(await relay.request(SHARED, 'login_status')).toEqual({ ok: true, data: null });
    });

    it('refuses an operation the desktop bridge does not have', async () => {
        const relay = relayIn(tempDir());
        const result = await relay.request(SHARED, 'delete_everything');
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('unsupported');
    });

    it('asks for a sign-in before it hands out audio', async () => {
        const relay = relayIn(tempDir());
        const result = await relay.request(SHARED, 'audio', { id: 'a'.repeat(22), quality: 'high' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('auth-required');
    });

    it('answers a POSTed operation through the given JSON sender', async () => {
        const relay = relayIn(tempDir());
        const sent: Array<{ status: number; payload: unknown }> = [];
        const req = Readable.from([Buffer.from(JSON.stringify({ operation: 'login_status', params: {} }))]);
        await relay.handleApi(req, {}, (_res, status, payload) => sent.push({ status, payload }));
        expect(sent).toEqual([{ status: 200, payload: { ok: true, data: null } }]);
    });

    it('rejects a body that is not JSON', async () => {
        const relay = relayIn(tempDir());
        const sent: Array<{ status: number; payload: unknown }> = [];
        await relay.handleApi(Readable.from([Buffer.from('not json')]), {}, (_res, status, payload) => sent.push({ status, payload }));
        expect(sent[0].status).toBe(400);
    });

    it('serves audio only under /stage/spotify/audio/<track id>', async () => {
        const relay = relayIn(tempDir());
        expect(await relay.handleAudio({ method: 'GET', headers: {} }, {}, new URL('http://x/stage/spotify/other'))).toBe(false);
    });
});

describe('a browser that plays on its own device has an account of its own', () => {
    it('is sealed with a key made from its secret: another secret cannot open it', () => {
        const sealed = createSecretSeal(secretA).encryptString('{"a":1}');
        expect(createSecretSeal(secretA).decryptString(sealed)).toBe('{"a":1}');
        expect(() => createSecretSeal(secretB).decryptString(sealed)).toThrow();
    });

    it('reads the profile from the header or the query, and only when it looks like a secret', () => {
        const url = new URL('http://x/stage/spotify/api');
        expect(profileSecretOf({ headers: { 'x-spotify-profile': secretA } }, url)).toBe(secretA);
        expect(profileSecretOf({ headers: {} }, new URL(`http://x/a?profile=${secretB}`))).toBe(secretB);
        expect(profileSecretOf({ headers: { 'x-spotify-profile': 'short' } }, url)).toBe('');
        expect(profileSecretOf({ headers: {} }, url)).toBe('');
    });

    it('starts with nobody signed in, apart from the shared account', async () => {
        const relay = relayIn(tempDir());
        expect(await relay.request(mine(secretA), 'login_status')).toEqual({ ok: true, data: null });
        expect(await relay.request(mine(secretB), 'login_status')).toEqual({ ok: true, data: null });
    });

    it('offers the consent address only after a sign-in has begun, and takes only the loopback address back', async () => {
        const relay = relayIn(tempDir());
        expect((await relay.request(mine(secretA), 'login_url')).ok).toBe(false);
        const refused = await relay.request(mine(secretA), 'login_complete', { redirectUrl: 'https://evil.example/login?code=1' });
        expect(refused.ok).toBe(false);
        expect(refused.error?.code).toBe('invalid-response');
    });

    it('does not give the shared account the two extra operations', async () => {
        const relay = relayIn(tempDir());
        const result = await relay.request(SHARED, 'login_url');
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('unsupported');
    });

    it('can be turned off, and then keeps no account for a browser', async () => {
        const relay = createSpotifyRelay({ stateDir: tempDir(), localProfiles: false, ...quiet, deps: { fetch: vi.fn(), openExternal: vi.fn() } });
        expect(relay.localProfilesEnabled).toBe(false);
        const result = await relay.request(mine(secretA), 'login_status');
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('unavailable');
    });

    it('limits how fast new accounts are made, while the ones already made keep working', async () => {
        const relay = relayIn(tempDir());
        const secrets = Array.from({ length: 8 }, (_, index) => String(index).repeat(40));
        const results = [];
        for (const secret of secrets) results.push((await relay.request(mine(secret), 'login_status')).ok);
        expect(results.slice(0, 6)).toEqual(Array(6).fill(true));
        expect(results.slice(6)).toEqual([false, false]);
        expect((await relay.request(mine(secrets[0]), 'login_status')).ok).toBe(true);
    });
});
