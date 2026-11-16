import type { JsonValue, OmniCollection } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';
import { usePlaybackStore, selectDisplaySong, selectDisplayPlayerState } from '../../../stores/usePlaybackStore';
import { withoutCredentials } from '../../../services/onlineMusic/rawResponse';
import { recentPlayRecordsOf, replayedSongsOf } from '../home/explore/recentPlays';
import { collectionView, getTrack, matchPlaylistTracks, MusicMcpError, trackView } from './musicMcpTracks';
import { accessMusicLibrary, isLibrarySource, musicLibrarySources } from './musicMcpLibraries';
import { signedInAccount, writePlaylist } from './musicMcpPlaylists';

// Dispatches only the schema-validated music operations sent by the desktop MCP server.
type MusicMcpArgs = {
    provider: string;
    id: string;
    endpoint: string;
    name: string;
    kind: string;
    query: string;
    limit: number;
    offset: number;
    liked: boolean;
    subscribed: boolean;
    tracks: { provider: string; id: string }[];
    trackIds: string[];
    requestId: string;
    params: Record<string, JsonValue>;
    changes: Record<string, string | number>;
    groupId: string;
    tagIds: string[];
};

export type MusicMcpRequest = { id: string; tool: string; args: MusicMcpArgs };

async function recommendations(args: MusicMcpArgs) {
    const { kind, provider, id } = args;
    switch (kind) {
        case 'daily': return (await omni.getDailySongs(undefined, provider)).map(trackView);
        case 'fm': return (await omni.getPersonalFm(undefined, provider)).map(trackView);
        case 'history': return omni.getRecommendationHistory(provider);
        case 'history_tracks': {
            if (!id) throw new MusicMcpError('Recommendation history ID is required');
            const entries = await omni.getRecommendationHistory(provider);
            const entry = entries.find(item => item.id === id);
            return (await omni.getRecommendationHistorySongs(entry ?? id, provider)).map(trackView);
        }
        case 'preferences': return omni.getRecommendationPreferences(provider);
        case 'styles': return omni.getDailyStyleGroups(provider);
        case 'style_tracks': {
            const result = await omni.getDailyStyleSongs(provider);
            return { selection: result.selection, songs: result.songs.map(trackView) };
        }
        case 'fm_catalog': return omni.getPersonalFmCatalog(provider);
        case 'explore': return omni.getExploreFeed(id, undefined, provider);
        case 'explore_items':
            if (!id) throw new MusicMcpError('Explore cursor is required');
            return omni.getExploreSectionItems(id, provider);
        default: throw new MusicMcpError('Unsupported recommendation type');
    }
}

async function getCollection(args: MusicMcpArgs, mustExist = false): Promise<OmniCollection> {
    const { provider, kind, id } = args;
    const source = omni.getProviderSummaries().find(item => item.providerId === provider);
    const known = source?.collections.find(item => String(item.id) === id && item.type === kind);
    if (known) return known;
    const ref = { providerId: provider, id, type: kind, name: '' };
    if (kind === 'cloud' || kind === 'listening_rank') throw new MusicMcpError('Collection is not in the active account library');
    const detail = kind === 'artist' ? await omni.getArtistDetail(ref) : await omni.getCollectionDetail(ref);
    if (mustExist && !detail?.name) throw new MusicMcpError('Collection details are unavailable');
    return detail ?? ref;
}

async function dispatch({ tool, args }: MusicMcpRequest): Promise<unknown> {
    const { provider, kind, query, limit, offset, endpoint } = args;
    const page = { limit, offset };
    const summaries = omni.getProviderSummaries();
    if (tool === 'get_playback') {
        const playback = usePlaybackStore.getState();
        const song = selectDisplaySong(playback);
        return {
            state: selectDisplayPlayerState(playback),
            current: song ? trackView(song) : null,
            items: playback.playQueue.slice(offset, offset + limit).map(trackView),
            nextOffset: offset + limit < playback.playQueue.length ? offset + limit : null,
        };
    }
    if (tool === 'list_sources') {
        return [...summaries.map(source => ({
            provider: source.providerId, name: source.displayName,
            status: source.status, configured: source.availability.configured,
            account: source.user ? { id: String(source.user.id), name: source.user.nickname } : null,
            capabilities: omni.getProviderCapabilities(source.providerId),
            createPlaylist: omni.canCreateProviderPlaylist(source.providerId),
            platformApi: omni.getRawRequestInfo(source.providerId)?.backend ?? null,
        })), ...musicLibrarySources()];
    }
    if (tool === 'create_folia_playlist') return accessMusicLibrary(tool, { ...args, provider: 'folia' });
    if (isLibrarySource(provider)) return accessMusicLibrary(tool, args);
    if (!summaries.some(source => source.providerId === provider)) throw new MusicMcpError('Unknown music platform');

    switch (tool) {
        case 'list_account_collections': {
            signedInAccount(provider);
            const items = summaries.find(source => source.providerId === provider)?.collections ?? [];
            return {
                items: items.slice(offset, offset + limit).map(collectionView),
                nextOffset: offset + limit < items.length ? offset + limit : null,
            };
        }
        case 'list_playlists': {
            const account = signedInAccount(provider);
            const playlists = await omni.refreshProviderPlaylists(provider);
            if (signedInAccount(provider).id !== account.id) throw new MusicMcpError('Platform account changed during request');
            return playlists.map(collectionView);
        }
        case 'list_liked_tracks': {
            const account = signedInAccount(provider);
            const { ids, whole } = await omni.getProviderLikedSongIds(provider, account.id);
            if (signedInAccount(provider).id !== account.id) throw new MusicMcpError('Platform account changed during request');
            return { ids: ids.slice(offset, offset + limit).map(String), whole, nextOffset: offset + limit < ids.length ? offset + limit : null };
        }
        case 'list_listening_history': {
            const accountId = String(signedInAccount(provider).id);
            const records = recentPlayRecordsOf({ kind: 'online', providerId: provider, accountId });
            return {
                days: 7,
                items: records.slice(offset, offset + limit).map(record => ({ track: trackView(record.song), playedAt: record.at })),
                nextOffset: offset + limit < records.length ? offset + limit : null,
                frequentlyPlayed: replayedSongsOf(provider, accountId).map(trackView),
            };
        }
        case 'search_music': {
            if (kind === 'album' || kind === 'playlist') {
                const result = await omni.searchProviderCollections(provider, kind, query, page);
                return { ...result, items: result.items.map(collectionView) };
            }
            const result = await omni.searchProviderSongs(provider, query, page);
            return { ...result, items: result.items.map(trackView) };
        }
        case 'get_track': {
            const song = await getTrack(args);
            return { ...trackView(song), availability: omni.getSongAvailability(song), pageUrl: omni.getSongPageUrl(song) };
        }
        case 'get_lyrics': return omni.getLyrics(await getTrack(args));
        case 'get_collection': return collectionView(await getCollection(args, true));
        case 'list_collection_tracks': {
            const collection = await getCollection(args);
            const result = kind === 'artist' ? await omni.getArtistSongs(collection, page) : await omni.getCollectionTracks(collection, page);
            return { ...result, items: result.items.map(trackView) };
        }
        case 'list_artist_albums': {
            const result = await omni.getArtistAlbums(await getCollection({ ...args, kind: 'artist' }), page);
            return { ...result, items: result.items.map(collectionView) };
        }
        case 'get_platform_library': {
            const user = signedInAccount(provider);
            if (kind === 'cloud') {
                const collection = await omni.getCloudCollection(user, provider);
                return collection ? collectionView(collection) : null;
            }
            const result = await omni.getUserAlbums(user.id, page, provider);
            return { ...result, items: result.items.map(collectionView) };
        }
        case 'get_recommendations': return recommendations(args);
        case 'set_recommendation_preferences':
            signedInAccount(provider);
            return omni.saveRecommendationPreferences(args.changes, provider);
        case 'set_daily_style':
            signedInAccount(provider);
            await omni.setDailyStyle({ groupId: args.groupId, tagIds: args.tagIds }, provider);
            return { updated: true };
        case 'dislike_track': {
            const account = signedInAccount(provider);
            const song = await getTrack(args);
            if (signedInAccount(provider).id !== account.id) throw new MusicMcpError('Platform account changed during request');
            const result = await omni.dislikeSong(song);
            return { ...result, replacement: result.replacement ? trackView(result.replacement) : null };
        }
        case 'describe_platform_api':
            return { api: omni.getRawRequestInfo(provider)?.backend ?? null, endpoint: omni.describeRawEndpoint(provider, endpoint) };
        case 'list_platform_api':
            return { api: omni.getRawRequestInfo(provider)?.backend ?? null, endpoints: omni.listRawEndpoints(provider) };
        case 'read_platform_api':
        case 'write_platform_api': {
            const access = tool === 'read_platform_api' ? 'read' : 'write';
            if (omni.describeRawEndpoint(provider, endpoint)?.access !== access) throw new MusicMcpError('Endpoint is unavailable for this access mode');
            const accountId = summaries.find(source => source.providerId === provider)?.user?.id;
            const expectedAccountId = access === 'write' ? signedInAccount(provider).id : undefined;
            const data = await omni.requestProviderRaw(provider, endpoint, args.params, AbortSignal.timeout(45_000), expectedAccountId);
            if (omni.getProviderSummaries().find(source => source.providerId === provider)?.user?.id !== accountId) {
                throw new MusicMcpError('Platform account changed during request');
            }
            return data;
        }
        case 'match_playlist_tracks': return matchPlaylistTracks(provider, args.tracks);
        case 'create_playlist':
        case 'add_playlist_tracks':
        case 'remove_playlist_tracks': return writePlaylist(tool, args);
        case 'set_track_like': {
            const account = signedInAccount(provider);
            const song = await getTrack(args);
            if (signedInAccount(provider).id !== account.id) throw new MusicMcpError('Platform account changed during request');
            await omni.likeSong(song, args.liked);
            return { liked: args.liked };
        }
        case 'set_subscription': {
            const account = signedInAccount(provider);
            const collection = await getCollection(args);
            if (signedInAccount(provider).id !== account.id) throw new MusicMcpError('Platform account changed during request');
            await omni.subscribe(collection, args.subscribed);
            return { subscribed: args.subscribed };
        }
        default: throw new MusicMcpError('Unknown music tool');
    }
}

export function installMusicMcpBridge(): void {
    window.electron?.onMusicMcpRequest(request => {
        void (async () => {
            let result: unknown;
            try {
                result = { data: withoutCredentials(await dispatch(request)) };
            } catch (cause) {
                // Provider errors can contain request URLs. Expose their classification only.
                const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
                    ? withoutCredentials({ code: cause.code }) : null;
                result = { error: cause instanceof MusicMcpError ? cause.message : 'Folia could not complete the music operation', details: code };
            }
            await window.electron?.completeMusicMcpRequest({ id: request.id, result });
        })().catch(() => console.warn('[MusicMcp] Could not return the tool response'));
    });
}
