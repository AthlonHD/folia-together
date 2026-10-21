import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spotifyImageUrl } from '../../../src/services/onlineMusic/spotify/spotifyImageUrl';

// test/unit/spotify/spotifyImages.test.ts
// Spotify's pictures through the main process: which hosts are served, what is passed on, and the address the page uses for one.

const require = createRequire(import.meta.url);
const { createSpotifyImages, imageRouteAddress, isImageRequest } = require('../../../electron/spotify/images.cjs');

const picture = (type = 'image/jpeg') => new Response('bytes', { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'max-age=60' } });
const ask = (images: { handle: (request: Request) => Promise<Response> }, address: string, init?: RequestInit) => images.handle(new Request(address, init));

describe('the picture route (main process)', () => {
    it('fetches a picture of a Spotify image host through the given network and passes its type and caching on', async () => {
        const fetch = vi.fn(async () => picture());
        const answer = await ask(createSpotifyImages({ fetch }), 'folia-spotify://image/dailymix-images.scdn.co/v2/img/abc/1/en/default?x=1');
        expect(fetch).toHaveBeenCalledWith('https://dailymix-images.scdn.co/v2/img/abc/1/en/default?x=1', expect.anything());
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-type')).toBe('image/jpeg');
        expect(answer.headers.get('cache-control')).toBe('max-age=60');
        expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('serves Spotify\'s image hosts only, GET only, and nothing that is not a picture', async () => {
        const fetch = vi.fn(async () => picture());
        const images = createSpotifyImages({ fetch });
        expect((await ask(images, 'folia-spotify://image/evil.example.com/a.jpg')).status).toBe(403);
        expect((await ask(images, 'folia-spotify://image/scdn.co.evil.com/a.jpg')).status).toBe(403);
        expect((await ask(images, 'folia-spotify://image/i.scdn.co/a.jpg', { method: 'POST', body: 'x' })).status).toBe(405);
        expect(fetch).not.toHaveBeenCalled();
        const html = createSpotifyImages({ fetch: async () => picture('text/html') });
        expect((await ask(html, 'folia-spotify://image/i.scdn.co/a.jpg')).status).toBe(502);
    });

    it('answers a failure of the network as a bad gateway, and a refusal of the host with its own status', async () => {
        const down = createSpotifyImages({ fetch: async () => { throw new Error('net::ERR_CONNECTION_TIMED_OUT'); }, warn: () => {} });
        expect((await ask(down, 'folia-spotify://image/i.scdn.co/a.jpg')).status).toBe(502);
        const missing = createSpotifyImages({ fetch: async () => new Response(null, { status: 404 }) });
        expect((await ask(missing, 'folia-spotify://image/i.scdn.co/a.jpg')).status).toBe(404);
    });

    it('tells a picture request from an audio request', () => {
        expect(isImageRequest({ url: 'folia-spotify://image/i.scdn.co/a.jpg' })).toBe(true);
        expect(isImageRequest({ url: 'folia-spotify://audio/abc?k=1' })).toBe(false);
        expect(imageRouteAddress('https://i.scdn.co/image/abc', 'folia-spotify')).toBe('folia-spotify://image/i.scdn.co/image/abc');
        expect(imageRouteAddress('http://i.scdn.co/image/abc', 'folia-spotify')).toBeNull();
    });
});

describe('the address a page uses for a Spotify picture', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('is the picture\'s own address in a browser', () => {
        expect(spotifyImageUrl('https://i.scdn.co/image/abc')).toBe('https://i.scdn.co/image/abc');
    });

    it('goes through the main process in the desktop app, for Spotify\'s image hosts only', () => {
        vi.stubGlobal('window', { electron: { spotifyRequest: () => {} } });
        expect(spotifyImageUrl('https://i.scdn.co/image/abc?s=1')).toBe('folia-spotify://image/i.scdn.co/image/abc?s=1');
        expect(spotifyImageUrl('https://seed-mix-image.spotifycdn.com/v6/img/a')).toBe('folia-spotify://image/seed-mix-image.spotifycdn.com/v6/img/a');
        expect(spotifyImageUrl('https://p1.music.126.net/a.jpg')).toBe('https://p1.music.126.net/a.jpg');
        expect(spotifyImageUrl('')).toBe('');
    });
});
