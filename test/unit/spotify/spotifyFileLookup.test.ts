import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyFileLookup.test.ts
// Finding a track's file and CDN address with the app's own requests: the ids, the file a bitrate picks, a relinked alternative,
// and the requests made.

const require = createRequire(import.meta.url);
const { base62ToHex, createSpotifyFileLookup, hexToBase62, pickFile } = require('../../../electron/spotify/fileLookup.cjs');

const SPCLIENT = 'https://spclient.test';
const fileOf = (format: string, digit: string) => ({ file_id: digit.repeat(40), format });

describe('Spotify file lookup', () => {
    it('turns a Spotify id into the hex the metadata service uses, and back', () => {
        expect(base62ToHex('0000000000000000000001')).toBe('00000000000000000000000000000001');
        for (const id of ['2eOpn0ix5JGf47vUBUqZnV', '4BlnR7y7sDouqBggjzuZxR']) expect(hexToBase62(base62ToHex(id))).toBe(id);
    });

    it('picks the file of the bitrate as the component does, and only what it can play', () => {
        const files = [fileOf('AAC_24', '1'), fileOf('MP3_160', '2'), fileOf('OGG_VORBIS_160', '3'), fileOf('OGG_VORBIS_320', '4')];
        expect(pickFile(files, 320).format).toBe('OGG_VORBIS_320');
        expect(pickFile(files, 160).format).toBe('OGG_VORBIS_160');
        expect(pickFile([fileOf('AAC_24', '1')], 320)).toBeNull();
    });

    it('asks for the metadata and the address of the chosen file, and follows a relinked alternative', async () => {
        const call = vi.fn(async (url: string) => {
            if (url.includes('/metadata/4/track/')) return { gid: '49905a468bfa4685903b953d14dab34f', file: [], alternative: [{ gid: '9737e4be08034cb2ad432d9cf19a6e07', file: [fileOf('OGG_VORBIS_320', 'b')] }] };
            if (url.includes('/storage-resolve/')) return { result: 'CDN', cdnurl: ['https://audio.test/file'] };
            throw new Error(`unexpected ${url}`);
        });
        const found = await createSpotifyFileLookup({ call, spclientUrl: SPCLIENT }).find('2eOpn0ix5JGf47vUBUqZnV', 320);
        expect(call.mock.calls[0][0]).toBe(`${SPCLIENT}/metadata/4/track/49905a468bfa4685903b953d14dab34f?market=from_token`);
        expect(call.mock.calls[1][0]).toBe(`${SPCLIENT}/storage-resolve/files/audio/interactive/${'b'.repeat(40)}?alt=json`);
        expect(found).toEqual({ playableId: '4BlnR7y7sDouqBggjzuZxR', fileId: 'b'.repeat(40), format: 'OGG_VORBIS_320', cdnUrl: 'https://audio.test/file' });
    });

    it('says a track has no audio where neither it nor an alternative has a file to play', async () => {
        const call = vi.fn(async () => ({ gid: '49905a468bfa4685903b953d14dab34f', file: [fileOf('AAC_24', '1')] }));
        await expect(createSpotifyFileLookup({ call, spclientUrl: SPCLIENT }).find('2eOpn0ix5JGf47vUBUqZnV', 320)).rejects.toMatchObject({ code: 'not-playable' });
    });
});
