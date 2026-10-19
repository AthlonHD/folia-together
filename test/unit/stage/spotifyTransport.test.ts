// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stage/spotifyTransport.test.ts
// 网页版的 Spotify 传输层(本 Fork):走 Stage 中继;服务器上那一个账号的登录与登出只在 Host 页里做。

describe('Spotify transport on the web', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_STAGE_RELAY', '1');
        window.history.replaceState({}, '', '/');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    describe('a page that plays on its own device (no token needed)', () => {
        it('has an account of its own: a random profile id is made once and sent instead of the token', async () => {
            const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: null })));
            vi.stubGlobal('fetch', fetchMock);
            const { getSpotifyTransportAvailability, requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            expect(getSpotifyTransportAvailability()).toEqual({ configured: true });
            await requestSpotify('login_status', {});
            const secret = localStorage.getItem('folia_spotify_profile') ?? '';
            expect(secret).toMatch(/^[0-9a-f]{48}$/);
            const calls = fetchMock.mock.calls as unknown as Array<[string, { headers: Record<string, string> }]>;
            expect(calls[0][1].headers['X-Spotify-Profile']).toBe(secret);
            expect(calls[0][1].headers['X-Stage-Token']).toBeUndefined();
            await requestSpotify('login_status', {});
            expect(localStorage.getItem('folia_spotify_profile')).toBe(secret);
        });

        it('may sign in and out itself, and opens the consent page in its own browser', async () => {
            const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
                const { operation } = JSON.parse(init.body) as { operation: string };
                return new Response(JSON.stringify({ ok: true, data: operation === 'login_url' ? { url: 'https://accounts.spotify.com/authorize?x=1' } : true }));
            });
            vi.stubGlobal('fetch', fetchMock);
            const open = vi.fn();
            vi.stubGlobal('open', open);
            const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            await expect(requestSpotify('login_start', {})).resolves.toBe(true);
            await expect(requestSpotify('login_open', {})).resolves.toBe(true);
            expect(open).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?x=1', '_blank', 'noopener');
            await expect(requestSpotify('logout', {})).resolves.toBe(true);
        });

        it('puts the profile on the audio address, and offers the paste-back step', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { url: '/stage/spotify/audio/abc?k=1', format: 'OGG_VORBIS_320' } }))));
            const { requestSpotify, spotifyLoginNeedsPasteBack } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            const audio = await requestSpotify<{ url: string }>('audio', { id: 'a'.repeat(22) });
            expect(audio.url).toBe(`/stage/spotify/audio/abc?k=1&profile=${localStorage.getItem('folia_spotify_profile')}`);
            expect(spotifyLoginNeedsPasteBack()).toBe(true);
        });
    });

    describe('a page that uses the shared account of the Host (Host page, remote page)', () => {
        beforeEach(() => {
            localStorage.setItem('folia_stage_token', 'tok');
            localStorage.setItem('folia_play_target', 'remote');
        });

        it('is available only with the token', async () => {
            const { getSpotifyTransportAvailability } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            expect(getSpotifyTransportAvailability()).toEqual({ configured: true });
            localStorage.removeItem('folia_stage_token');
            expect(getSpotifyTransportAvailability()).toMatchObject({ configured: false });
        });

        it('sends operations to the relay with the token, and puts the token on the audio address', async () => {
            const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { url: '/stage/spotify/audio/abc?k=1', format: 'OGG_VORBIS_320' } })));
            vi.stubGlobal('fetch', fetchMock);
            const { requestSpotify, spotifyLoginNeedsPasteBack } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            const audio = await requestSpotify<{ url: string }>('audio', { id: 'a'.repeat(22) });
            expect(fetchMock).toHaveBeenCalledWith('/stage/spotify/api', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Stage-Token': 'tok' }) }));
            expect(audio.url).toBe('/stage/spotify/audio/abc?k=1&token=tok');
            expect(spotifyLoginNeedsPasteBack()).toBe(false);
        });

        it('leaves signing in and out to the Host page', async () => {
            const fetchMock = vi.fn();
            vi.stubGlobal('fetch', fetchMock);
            const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            for (const operation of ['login_start', 'login_open', 'login_check', 'login_cancel', 'logout'] as const) {
                await expect(requestSpotify(operation, {})).rejects.toMatchObject({ code: 'unsupported' });
            }
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('lets the Host page sign in and out', async () => {
            window.history.replaceState({}, '', '/?host=1');
            const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: true })));
            vi.stubGlobal('fetch', fetchMock);
            const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
            await expect(requestSpotify('logout', {})).resolves.toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
