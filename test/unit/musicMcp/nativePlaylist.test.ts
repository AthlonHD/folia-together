import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '../../../src/types';
import type { OmniCollection } from '../../../src/types/onlineMusic';

const omni = vi.hoisted(() => ({
    getProviderSummaries: vi.fn(),
    getSongDetails: vi.fn(),
    createProviderPlaylist: vi.fn(),
    getCollectionTracks: vi.fn(),
    getPlaylistPageUrl: vi.fn(),
    isCurrentProviderAccount: vi.fn(),
    updateCollectionTracks: vi.fn(),
    refreshProviderPlaylists: vi.fn(),
}));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni, PLAYLIST_ADD_BATCH: 50 }));

import { writePlaylist } from '../../../src/components/app/musicMcp/musicMcpPlaylists';
import { sameRecording } from '../../../src/components/app/musicMcp/musicMcpTracks';

// Verifies native playlist identity survives a write failure and a repeated request.
const track = (providerId: string, mediaId: string, name = 'Song'): UnifiedSong => ({
    id: mediaId, name, album: { id: 'album', name: 'Album' }, artists: [{ id: 'artist', name: 'Artist' }],
    durationMs: 200_000, sourceRef: { kind: 'online', providerId, mediaId },
});

const makeArgs = (requestId: string) => ({
    provider: 'destination', id: '', name: 'Night drive', trackIds: ['1', '2'], requestId,
});

describe('Music MCP native playlist', () => {
    const playlist: OmniCollection = { providerId: 'destination', id: 'new', name: 'Night drive', type: 'playlist' };
    beforeEach(() => {
        vi.resetAllMocks();
        omni.isCurrentProviderAccount.mockResolvedValue(true);
        omni.getProviderSummaries.mockReturnValue([{ providerId: 'destination', user: { id: 'account' } }]);
        omni.getSongDetails.mockResolvedValue([
            { status: 'found', song: track('destination', '1') }, { status: 'found', song: track('destination', '2') },
        ]);
        omni.createProviderPlaylist.mockResolvedValue(playlist);
        omni.refreshProviderPlaylists.mockResolvedValue([]);
        omni.getCollectionTracks.mockResolvedValue({ items: [track('destination', '1')], hasMore: false, nextOffset: 1 });
    });

    it('returns the native playlist and verified partial writes once for the same request', async () => {
        omni.updateCollectionTracks.mockRejectedValueOnce(new Error('Networking failure after first add'));
        const args = makeArgs('partial');
        const first = await writePlaylist('create_playlist', args);
        expect(first).toMatchObject({
            playlist: { id: 'new', provider: 'destination' },
            writeFailed: true, verifiedTrackIds: ['1'], remainingTrackIds: ['2'],
        });
        expect(await writePlaylist('create_playlist', args)).toEqual(first);
        expect(omni.createProviderPlaylist).toHaveBeenCalledExactlyOnceWith('destination', 'Night drive', 'account');
        await expect(writePlaylist('create_playlist', { ...args, name: 'Other name' })).rejects.toThrow('Request ID already used');
    });

    it('validates destination track identities before creating a playlist', async () => {
        omni.getSongDetails.mockResolvedValueOnce([{ status: 'found', song: track('other', '1') }]);
        await expect(writePlaylist('create_playlist', makeArgs('wrong-source'))).rejects.toThrow('Use track IDs from the target platform');
        expect(omni.createProviderPlaylist).not.toHaveBeenCalled();
    });

    it('retries the same request ID after a lookup fails before any write', async () => {
        const args = makeArgs('lookup-retry');
        omni.getSongDetails.mockRejectedValueOnce(new Error('Temporary platform failure'));
        await expect(writePlaylist('create_playlist', args)).rejects.toThrow('Temporary platform failure');
        await expect(writePlaylist('create_playlist', args)).resolves.toMatchObject({ playlist: { id: 'new' } });
        expect(omni.createProviderPlaylist).toHaveBeenCalledTimes(1);
    });

    it('does not append to a created playlist after the signed-in account changes', async () => {
        omni.createProviderPlaylist.mockImplementationOnce(async () => {
            await Promise.resolve();
            omni.getProviderSummaries.mockReturnValue([{ providerId: 'destination', user: { id: 'another-account' } }]);
            return playlist;
        });
        expect(await writePlaylist('create_playlist', makeArgs('account-switch'))).toMatchObject({
            playlist: { id: 'new' }, writeFailed: true, verification: 'unavailable',
        });
        expect(omni.updateCollectionTracks).not.toHaveBeenCalled();
    });

    it('does not treat live and studio recordings as the same title', () => {
        expect(sameRecording(track('source', 'original'), track('destination', '1', 'Song (Live)'))).toBe(false);
        expect(sameRecording(track('source', 'original'), track('destination', '1', '\uFF33\uFF4F\uFF4E\uFF47'))).toBe(true);
    });
});
