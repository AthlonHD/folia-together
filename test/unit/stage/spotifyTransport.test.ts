// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stage/spotifyTransport.test.ts
// 网页版的 Spotify 传输层(本 Fork):走 Stage 中继;服务器上那一个账号的登录与登出只在 Host 页里做。

describe('Spotify transport on the web', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_STAGE_RELAY', '1');
        localStorage.setItem('folia_stage_token', 'tok');
        window.history.replaceState({}, '', '/');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('is available only with a configured relay and a token', async () => {
        const { getSpotifyTransportAvailability } = await import('@/services/onlineMusic/spotify/spotifyTransport');
        expect(getSpotifyTransportAvailability()).toEqual({ configured: true });
        localStorage.removeItem('folia_stage_token');
        expect(getSpotifyTransportAvailability()).toMatchObject({ configured: false });
    });

    it('sends operations to the relay with the token, and puts the token on the audio address', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { url: '/stage/spotify/audio/abc?k=1', format: 'OGG_VORBIS_320' } })));
        vi.stubGlobal('fetch', fetchMock);
        const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
        const audio = await requestSpotify<{ url: string }>('audio', { id: 'a'.repeat(22) });
        expect(fetchMock).toHaveBeenCalledWith('/stage/spotify/api', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Stage-Token': 'tok' }) }));
        expect(audio.url).toBe('/stage/spotify/audio/abc?k=1&token=tok');
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
