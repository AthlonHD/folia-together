import { describe, expect, it, vi } from 'vitest';
import { accessMusicLibrary } from '../../../src/components/app/musicMcp/musicMcpLibraries';

const mocks = vi.hoisted(() => ({
    createPlaylist: vi.fn(),
    getPlaylist: vi.fn(),
    getLocalSongs: vi.fn(),
}));
vi.mock('../../../src/services/db', () => ({ getLocalSongs: mocks.getLocalSongs }));
vi.mock('../../../src/services/localPlaylistService', () => ({ getLocalPlaylists: vi.fn() }));
vi.mock('../../../src/components/app/crossPlaylist/crossPlaylistStore', () => ({
    useCrossPlaylistStore: { getState: vi.fn() },
    selectVisibleCrossPlaylists: vi.fn(),
}));
vi.mock('../../../src/services/navidromeService', () => ({
    isNavidromeEnabled: () => true,
    getNavidromeConfig: () => ({ serverUrl: 'https://music.example', username: 'listener', password: 'test-secret' }),
    navidromeApi: mocks,
}));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: {} }));

// Covers the native Navidrome target and the metadata exposed about local files.
const args = {
    provider: 'navidrome', id: 'one', name: 'Evening', kind: 'song', query: '', limit: 50, offset: 0,
    trackIds: ['1', '2'], tracks: [], requestId: 'nav-write',
};

describe('Music MCP libraries', () => {
    it('creates and verifies a native Navidrome playlist once', async () => {
        const playlist = { id: 'native', name: 'Evening', owner: 'listener', songCount: 1 };
        mocks.createPlaylist.mockResolvedValue(playlist);
        mocks.getPlaylist.mockResolvedValue({ ...playlist, entry: [{ id: '1', path: '/server/private.flac' }] });
        const result = await accessMusicLibrary('create_playlist', args);
        expect(result).toMatchObject({
            playlist: { id: 'native', provider: 'navidrome', owned: true },
            verifiedTrackIds: ['1'], remainingTrackIds: ['2'],
        });
        expect(JSON.stringify(result)).not.toMatch(/test-secret|\/server\/private/);
        expect(await accessMusicLibrary('create_playlist', args)).toEqual(result);
        expect(mocks.createPlaylist).toHaveBeenCalledTimes(1);
    });

    it('omits local filesystem paths from track metadata', async () => {
        mocks.getLocalSongs.mockResolvedValue([{
            id: 'one', title: 'Local track', filePath: 'private.flac', duration: 1000,
            importedMetadata: { artistNames: ['Artist'], albumName: 'Album' },
        }]);
        const result = await accessMusicLibrary('get_track', { ...args, provider: 'local' });
        expect(result).toEqual({
            id: 'one', provider: 'local', name: 'Local track', artists: ['Artist'], album: 'Album', durationMs: 1000,
        });
    });
});
