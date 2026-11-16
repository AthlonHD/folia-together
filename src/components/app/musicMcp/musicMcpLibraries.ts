import type { LocalSong } from '../../../types';
import { getLocalSongImportedArtistNames, getLocalSongImportedAlbumName } from '../../../utils/localSongMetadata';
import type { SubsonicPlaylist, SubsonicSong } from '../../../types/navidrome';
import { getLocalSongs } from '../../../services/db';
import { getLocalPlaylists } from '../../../services/localPlaylistService';
import { getNavidromeConfig, isNavidromeEnabled, navidromeApi } from '../../../services/navidromeService';
import { selectVisibleCrossPlaylists, useCrossPlaylistStore } from '../crossPlaylist/crossPlaylistStore';
import { recentPlayRecordsOf, navidromePlayAccount } from '../home/explore/recentPlays';
import { getTrack, MusicMcpError, trackView } from './musicMcpTracks';

// Adapts the player's non-Omni libraries without exposing file paths or server credentials.
type LibraryArgs = {
    provider: string;
    id: string;
    name: string;
    kind: string;
    query: string;
    limit: number;
    offset: number;
    trackIds: string[];
    tracks: { provider: string; id: string }[];
    requestId: string;
};

const localTrack = (song: LocalSong) => ({
    id: song.id, provider: 'local', name: song.title,
    artists: getLocalSongImportedArtistNames(song),
    album: getLocalSongImportedAlbumName(song),
    durationMs: song.duration,
});

const navTrack = (song: SubsonicSong) => ({
    id: song.id, provider: 'navidrome', name: song.title,
    artists: [song.artist], album: song.album, durationMs: song.duration * 1000,
    playCount: song.playCount, liked: Boolean(song.starred),
});

const pageOf = <T,>(items: T[], { limit, offset }: LibraryArgs) => ({
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
});

export const isLibrarySource = (provider: string) => provider === 'local' || provider === 'navidrome' || provider === 'folia';

export function musicLibrarySources() {
    const navidrome = isNavidromeEnabled() ? getNavidromeConfig() : null;
    return [
        { provider: 'local', name: 'Local music', configured: true, createPlaylist: false },
        { provider: 'folia', name: 'Folia cross-platform playlists', configured: true, createPlaylist: true, createTool: 'create_folia_playlist' },
        { provider: 'navidrome', name: 'Navidrome', configured: Boolean(navidrome), createPlaylist: Boolean(navidrome) },
    ];
}

async function readLocalLibrary(tool: string, args: LibraryArgs) {
    if (tool === 'list_listening_history') {
        return pageOf(recentPlayRecordsOf({ kind: 'local' }).map(record => ({ track: trackView(record.song), playedAt: record.at })), args);
    }
    if (tool === 'get_track' || tool === 'search_music') {
        const tracks = (await getLocalSongs()).map(localTrack);
        if (tool === 'get_track') return tracks.find(song => song.id === args.id) ?? null;
        if (args.kind !== 'song') throw new MusicMcpError('Local search supports songs');
        const query = args.query.toLowerCase();
        return pageOf(tracks.filter(song => [song.name, song.album, ...song.artists].some(text => text?.toLowerCase().includes(query))), args);
    }
    const playlists = await getLocalPlaylists();
    const view = (list: typeof playlists[number]) => ({
        id: list.id, provider: 'local', kind: 'playlist', name: list.name, trackCount: list.songIds.length, liked: list.isFavorite,
    });
    if (tool === 'list_playlists') return playlists.map(view);
    const list = playlists.find(item => item.id === args.id);
    if (!list) throw new MusicMcpError('Local playlist was not found');
    if (tool === 'get_collection') return view(list);
    if (tool === 'list_collection_tracks') {
        const byId = new Map((await getLocalSongs()).map(song => [song.id, song]));
        return pageOf(list.songIds.flatMap(id => {
            const song = byId.get(id);
            return song ? [localTrack(song)] : [];
        }), args);
    }
    throw new MusicMcpError('Operation is unavailable for the local library');
}

const libraryCreates = new Map<string, { signature: string; result: Promise<unknown> }>();

function createOnce(key: string, signature: string, create: () => Promise<unknown>): Promise<unknown> {
    const previous = libraryCreates.get(key);
    if (previous) {
        if (previous.signature !== signature) throw new MusicMcpError('Request ID already used with different arguments');
        return previous.result;
    }
    if (libraryCreates.size >= 5000) throw new MusicMcpError('This Folia session has reached its playlist-write history limit');
    const result = create();
    libraryCreates.set(key, { signature, result });
    return result;
}

export async function accessMusicLibrary(tool: string, args: LibraryArgs): Promise<unknown> {
    if (args.provider === 'local') return readLocalLibrary(tool, args);

    if (args.provider === 'folia') {
        await useCrossPlaylistStore.getState().load();
        const visible = selectVisibleCrossPlaylists(useCrossPlaylistStore.getState());
        const view = (list: typeof visible[number]) => ({
            id: list.id, provider: 'folia', kind: 'playlist', name: list.name, trackCount: list.entries.length,
        });
        if (tool === 'create_folia_playlist') {
            const tracks = await Promise.all(args.tracks.map(getTrack));
            return createOnce(JSON.stringify(['folia', args.requestId]), JSON.stringify([args.name, args.tracks]), async () => {
                const playlist = await useCrossPlaylistStore.getState().create(args.name, tracks);
                return { playlist: view(playlist), verifiedTrackIds: playlist.entries.map(entry => ({ provider: entry.providerId, id: entry.mediaId })) };
            });
        }
        if (tool === 'list_playlists') return visible.map(view);
        const list = visible.find(item => item.id === args.id);
        if (!list) throw new MusicMcpError('Folia playlist was not found');
        if (tool === 'get_collection') return view(list);
        if (tool === 'list_collection_tracks') return pageOf(list.entries.map(entry => trackView(entry.song)), args);
        throw new MusicMcpError('Operation is unavailable for Folia playlists');
    }

    const config = isNavidromeEnabled() ? getNavidromeConfig() : null;
    if (!config) throw new MusicMcpError('Configure and enable Navidrome in Folia first');
    if (tool === 'list_listening_history') {
        return pageOf(recentPlayRecordsOf({ kind: 'navidrome', accountId: navidromePlayAccount(config) })
            .map(record => ({ track: trackView(record.song), playedAt: record.at })), args);
    }
    if (tool === 'get_track') {
        const song = await navidromeApi.getSong(config, args.id);
        return song ? navTrack(song) : null;
    }
    if (tool === 'search_music') {
        if (args.kind !== 'song') throw new MusicMcpError('This tool searches Navidrome songs');
        const result = await navidromeApi.search(config, args.query, 0, 0, Math.min(args.limit + args.offset, 500));
        return pageOf((result.song ?? []).map(navTrack), args);
    }
    const view = (list: SubsonicPlaylist) => ({
        id: list.id, provider: 'navidrome', kind: 'playlist', name: list.name,
        trackCount: list.songCount, description: list.comment, owned: list.owner === config.username,
    });
    if (tool === 'create_playlist') {
        const key = JSON.stringify(['navidrome', navidromePlayAccount(config), args.requestId]);
        const trackIds = [...new Set(args.trackIds)];
        return createOnce(key, JSON.stringify([args.name, trackIds]), async () => {
            const playlist = await navidromeApi.createPlaylist(config, args.name, trackIds, AbortSignal.timeout(35_000));
            if (!playlist) throw new MusicMcpError('Navidrome did not confirm creation. Check your playlists before retrying.');
            const checked = await navidromeApi.getPlaylist(config, playlist.id, AbortSignal.timeout(20_000));
            if (!checked) return { playlist: view(playlist), verification: 'unavailable', requestedTrackIds: trackIds };
            const found = new Set(checked.entry?.map(song => song.id));
            return {
                playlist: view(checked),
                verifiedTrackIds: trackIds.filter(id => found.has(id)),
                remainingTrackIds: trackIds.filter(id => !found.has(id)),
            };
        });
    }
    if (tool === 'list_playlists') return (await navidromeApi.getPlaylists(config)).map(view);
    if (tool === 'get_collection' || tool === 'list_collection_tracks') {
        const list = await navidromeApi.getPlaylist(config, args.id, AbortSignal.timeout(25_000));
        if (!list) throw new MusicMcpError('Navidrome playlist was not found');
        return tool === 'get_collection' ? view(list) : pageOf((list.entry ?? []).map(navTrack), args);
    }
    throw new MusicMcpError('Operation is unavailable for Navidrome');
}
