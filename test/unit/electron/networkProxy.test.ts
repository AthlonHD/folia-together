import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/networkProxy.test.ts
// The proxy setting of the desktop app for Spotify and YouTube Music: what an address may look like, what each mode asks of Electron,
// the Spotify playback component and the sign-in browser, and the reachability probe.

const require = createRequire(import.meta.url);
const {
    parseProxyAddress, normalizeProxyConfig, toElectronProxyConfig, parseResolvedProxy, playbackProxyFor, browserProxyArgs, createNetworkProxy, probeServices,
} = require('../../../electron/networkProxy/networkProxy.cjs') as typeof import('../../../electron/networkProxy/networkProxy.cjs');

describe('parseProxyAddress', () => {
    it('takes host:port as an HTTP proxy and keeps a scheme that is given', () => {
        expect(parseProxyAddress('127.0.0.1:7890')).toMatchObject({ ok: true, url: 'http://127.0.0.1:7890', scheme: 'http:', port: 7890 });
        expect(parseProxyAddress(' http://proxy.local:8080 ')).toMatchObject({ ok: true, url: 'http://proxy.local:8080' });
        expect(parseProxyAddress('https://p.example:443')).toMatchObject({ ok: true, scheme: 'https:' });
        expect(parseProxyAddress('socks5://127.0.0.1:1080')).toMatchObject({ ok: true, scheme: 'socks5:' });
        expect(parseProxyAddress('socks5h://127.0.0.1:1080')).toMatchObject({ ok: true, url: 'socks5://127.0.0.1:1080' });
    });

    it('gives a scheme its usual port when none is typed', () => {
        expect(parseProxyAddress('socks5://127.0.0.1')).toMatchObject({ ok: true, url: 'socks5://127.0.0.1:1080' });
        expect(parseProxyAddress('http://proxy.local')).toMatchObject({ ok: true, url: 'http://proxy.local:80' });
    });

    it('refuses what is not a proxy address, another scheme, and credentials', () => {
        expect(parseProxyAddress('')).toEqual({ ok: false, error: 'empty' });
        expect(parseProxyAddress('   ')).toEqual({ ok: false, error: 'empty' });
        expect(parseProxyAddress('ftp://proxy:21')).toEqual({ ok: false, error: 'scheme' });
        expect(parseProxyAddress('http://user:pass@proxy:8080')).toEqual({ ok: false, error: 'credentials' });
        expect(parseProxyAddress('http://proxy:99999')).toEqual({ ok: false, error: 'invalid' });
        expect(parseProxyAddress('http://proxy:8080/path')).toEqual({ ok: false, error: 'invalid' });
        expect(parseProxyAddress('not a url at all')).toEqual({ ok: false, error: 'invalid' });
    });

    it('writes an IPv6 host in brackets', () => {
        expect(parseProxyAddress('http://[::1]:7890')).toMatchObject({ ok: true, url: 'http://[::1]:7890' });
    });
});

describe('normalizeProxyConfig', () => {
    it('falls back to following the system for anything odd', () => {
        expect(normalizeProxyConfig(undefined)).toEqual({ mode: 'system', url: '' });
        expect(normalizeProxyConfig({ mode: 'weird' })).toEqual({ mode: 'system', url: '' });
        expect(normalizeProxyConfig({ mode: 'custom', url: 'junk url' })).toEqual({ mode: 'system', url: '' });
    });

    it('keeps a good custom address, written in full, and drops the address of the other modes', () => {
        expect(normalizeProxyConfig({ mode: 'custom', url: '127.0.0.1:7890' })).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7890' });
        expect(normalizeProxyConfig({ mode: 'direct', url: 'http://x:1' })).toEqual({ mode: 'direct', url: '' });
    });
});

describe('what each mode asks for', () => {
    const custom = { mode: 'custom', url: 'http://127.0.0.1:7890' };
    const socks = { mode: 'custom', url: 'socks5://127.0.0.1:1080' };

    it('Electron: the system, nothing, or the one proxy for everything', () => {
        expect(toElectronProxyConfig({ mode: 'system', url: '' })).toEqual({ mode: 'system' });
        expect(toElectronProxyConfig({ mode: 'direct', url: '' })).toEqual({ mode: 'direct' });
        expect(toElectronProxyConfig(custom)).toEqual({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890' });
        expect(toElectronProxyConfig(socks)).toEqual({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1080' });
        expect(toElectronProxyConfig({ mode: 'custom', url: 'ftp://nope:1' })).toEqual({ mode: 'system' });
    });

    it('the sign-in browser: only the explicit settings are passed on', () => {
        expect(browserProxyArgs({ mode: 'system', url: '' })).toEqual([]);
        expect(browserProxyArgs({ mode: 'direct', url: '' })).toEqual(['--no-proxy-server']);
        expect(browserProxyArgs(custom)).toEqual(['--proxy-server=http://127.0.0.1:7890']);
        expect(browserProxyArgs(socks)).toEqual(['--proxy-server=socks5://127.0.0.1:1080']);
    });

    it('Spotify playback: an HTTP proxy, never a SOCKS one, and the system one where the setting follows it', () => {
        expect(playbackProxyFor(custom, 'DIRECT')).toEqual({ url: 'http://127.0.0.1:7890', reason: 'http' });
        expect(playbackProxyFor(socks, 'DIRECT')).toEqual({ url: null, reason: 'socks-unsupported' });
        expect(playbackProxyFor({ mode: 'direct', url: '' }, 'PROXY 1.2.3.4:80')).toEqual({ url: null, reason: 'direct' });
        expect(playbackProxyFor({ mode: 'system', url: '' }, 'PROXY 127.0.0.1:7890; DIRECT')).toEqual({ url: 'http://127.0.0.1:7890', reason: 'http' });
        expect(playbackProxyFor({ mode: 'system', url: '' }, 'DIRECT')).toEqual({ url: null, reason: 'none' });
        expect(playbackProxyFor({ mode: 'system', url: '' }, 'SOCKS5 127.0.0.1:1080')).toEqual({ url: null, reason: 'socks-unsupported' });
        expect(playbackProxyFor({ mode: 'system', url: '' }, '')).toEqual({ url: null, reason: 'none' });
    });
});

describe('parseResolvedProxy', () => {
    it('reads the first usable entry', () => {
        expect(parseResolvedProxy('PROXY 10.0.0.1:3128')).toEqual({ kind: 'http', url: 'http://10.0.0.1:3128' });
        expect(parseResolvedProxy('HTTPS secure.proxy:443; DIRECT')).toEqual({ kind: 'http', url: 'https://secure.proxy:443' });
        expect(parseResolvedProxy('SOCKS5 127.0.0.1:1080; DIRECT')).toEqual({ kind: 'socks', url: 'socks5://127.0.0.1:1080' });
        expect(parseResolvedProxy('DIRECT')).toEqual({ kind: 'direct' });
        expect(parseResolvedProxy('PROXY http://: ; PROXY 10.0.0.2:8080')).toEqual({ kind: 'http', url: 'http://10.0.0.2:8080' });
        expect(parseResolvedProxy('')).toBeNull();
    });
});

describe('createNetworkProxy', () => {
    const memory = (initial?: unknown) => {
        const data = new Map<string, unknown>(initial === undefined ? [] : [['networkProxy', initial]]);
        return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => { data.set(key, value); } };
    };

    it('starts from what was saved, and follows the system when nothing was', () => {
        expect(createNetworkProxy({ store: memory() }).get()).toEqual({ mode: 'system', url: '' });
        expect(createNetworkProxy({ store: memory({ mode: 'custom', url: 'http://127.0.0.1:7890' }) }).get()).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7890' });
    });

    it('saves a good setting and says why it refused a bad one without changing anything', () => {
        const store = memory();
        const proxy = createNetworkProxy({ store });
        expect(proxy.save({ mode: 'custom', url: '127.0.0.1:7890' })).toEqual({ ok: true, config: { mode: 'custom', url: 'http://127.0.0.1:7890' } });
        expect(store.get('networkProxy')).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7890' });
        expect(proxy.save({ mode: 'custom', url: 'ftp://nope:1' })).toEqual({ ok: false, error: 'scheme' });
        expect(proxy.get()).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7890' });
        expect(proxy.save({ mode: 'direct' })).toEqual({ ok: true, config: { mode: 'direct', url: '' } });
    });
});

describe('probeServices', () => {
    it('reports each service on its own: reached with what it answered, or not reached with why', async () => {
        const results = await probeServices({
            fetchThrough: async (url: string) => {
                if (url.includes('spotify')) return { status: 200 };
                throw new Error('net::ERR_CONNECTION_TIMED_OUT');
            },
        });
        expect(results.find(result => result.id === 'spotify')).toMatchObject({ ok: true, status: 200 });
        expect(results.find(result => result.id === 'youtubeMusic')).toMatchObject({ ok: false, error: 'net::ERR_CONNECTION_TIMED_OUT' });
    });

    it('counts any answer, even an error status, as reaching the service', async () => {
        const results = await probeServices({ fetchThrough: async () => ({ status: 403 }) });
        expect(results.every(result => result.ok && result.status === 403)).toBe(true);
    });
});
