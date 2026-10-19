import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/stageRemote.test.ts
// The desktop app as a remote controller: what address it accepts, and that the token stays sealed in the main process.

const require = createRequire(import.meta.url);
const { createStageRemote, normalizeServerUrl, buildControllerUrl } = require('../../../electron/stageRemote/stageRemote.cjs') as typeof import('../../../electron/stageRemote/stageRemote.cjs');

const fakeStore = () => {
    const data = new Map<string, unknown>();
    return {
        get: (key: string) => data.get(key),
        set: (key: string, value: unknown) => { data.set(key, value); },
        delete: (key: string) => { data.delete(key); },
        raw: data,
    };
};

const fakeSafeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (data: Buffer) => data.toString().replace(/^sealed:/, ''),
});

const make = (available = true) => {
    const store = fakeStore();
    const remote = createStageRemote({ store, safeStorage: fakeSafeStorage(available), BrowserWindow: class {} as never, title: 'x', warn: () => {} });
    return { store, remote };
};

describe('normalizeServerUrl', () => {
    it('keeps only the origin and adds http when there is no scheme', () => {
        expect(normalizeServerUrl('192.168.1.10:3000')).toBe('http://192.168.1.10:3000');
        expect(normalizeServerUrl('  https://music.example.com/some/path?x=1 ')).toBe('https://music.example.com');
    });

    it('refuses what is not a plain http(s) address', () => {
        expect(() => normalizeServerUrl('')).toThrow('empty-url');
        expect(() => normalizeServerUrl('ftp://host')).toThrow('invalid-url');
        expect(() => normalizeServerUrl('http://user:pass@host')).toThrow('invalid-url');
        expect(() => normalizeServerUrl('javascript:alert(1)')).toThrow('invalid-url');
    });
});

describe('buildControllerUrl', () => {
    it('puts the token in the query so the page enters controller mode', () => {
        expect(buildControllerUrl('http://h:3000', 'a b')).toBe('http://h:3000/?token=a%20b');
        expect(buildControllerUrl('http://h:3000', '')).toBe('http://h:3000/?stageremote=1');
    });
});

describe('createStageRemote', () => {
    it('saves the address and reports a token without handing it back', () => {
        const { remote } = make();
        expect(remote.saveConfig({ url: '192.168.1.10:3000', token: 'secret-token' })).toMatchObject({ ok: true, url: 'http://192.168.1.10:3000', hasToken: true });
        expect(remote.getConfig()).toEqual({ url: 'http://192.168.1.10:3000', hasToken: true });
    });

    it('stores the token sealed, never as plain text', () => {
        const { remote, store } = make();
        remote.saveConfig({ url: 'h:1', token: 'secret-token' });
        const stored = JSON.stringify([...store.raw.entries()]);
        expect(stored).not.toContain('secret-token');
    });

    it('falls back to plain storage only where the system has no credential store', () => {
        const { remote, store } = make(false);
        remote.saveConfig({ url: 'h:1', token: 'secret-token' });
        expect(remote.getConfig().hasToken).toBe(true);
        expect(JSON.stringify([...store.raw.entries()])).toContain('secret-token');
    });

    it('keeps the saved token when none is given, replaces it with a new one, clears it with an empty one', () => {
        const { remote } = make();
        remote.saveConfig({ url: 'h:1', token: 'one' });
        remote.saveConfig({ url: 'h:2' });
        expect(remote.getConfig()).toEqual({ url: 'http://h:2', hasToken: true });
        remote.saveConfig({ url: 'h:2', token: 'two' });
        expect(remote.getConfig().hasToken).toBe(true);
        remote.saveConfig({ url: 'h:2', token: '' });
        expect(remote.getConfig().hasToken).toBe(false);
    });

    it('does not save a bad address and says why', () => {
        const { remote } = make();
        expect(remote.saveConfig({ url: 'ftp://x', token: 't' })).toEqual({ ok: false, error: 'invalid-url' });
        expect(remote.getConfig()).toEqual({ url: '', hasToken: false });
    });

    it('will not open a window before an address is set', () => {
        const { remote } = make();
        expect(remote.open()).toEqual({ ok: false, error: 'not-configured' });
    });
});
