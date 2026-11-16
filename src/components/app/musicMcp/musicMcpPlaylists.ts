import { omni, PLAYLIST_ADD_BATCH } from '../../../services/onlineMusic/omni';
import type { OmniCollection } from '../../../types/onlineMusic';
import { collectionView, MusicMcpError, trackView } from './musicMcpTracks';

// Performs playlist writes within the selected platform account and reports verified tracks.
export function signedInAccount(provider: string) {
    const user = omni.getProviderSummaries().find(source => source.providerId === provider)?.user;
    if (!user) throw new MusicMcpError('Sign into this platform in Folia first');
    return user;
}

type WriteArgs = { provider: string; id: string; name: string; trackIds: string[]; requestId: string };
type PlaylistAction = 'create_playlist' | 'add_playlist_tracks' | 'remove_playlist_tracks';

async function readTracks(playlist: OmniCollection, wanted: Set<string>) {
    const found = new Set<string>();
    let offset = 0;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = await omni.getCollectionTracks(playlist, { limit: 100, offset });
        for (const song of page.items) {
            const id = trackView(song).id;
            if (wanted.has(id)) found.add(id);
        }
        if (!page.hasMore || found.size === wanted.size) return found;
        if (page.nextOffset <= offset) break;
        offset = page.nextOffset;
    }
    throw new MusicMcpError('Playlist could not be fully checked');
}

// Limits how long a write waits on read-only preparation and verification.
async function waitForRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let remove = () => {};
    const expired = new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new MusicMcpError('Timed out waiting for the platform'));
        signal.addEventListener('abort', abort, { once: true });
        remove = () => signal.removeEventListener('abort', abort);
    });
    try {
        return await Promise.race([read(), expired]);
    } finally {
        remove();
    }
}

const writes = new Map<string, { signature: string; result: Promise<unknown> }>();

export async function writePlaylist(action: PlaylistAction, args: WriteArgs) {
    const { provider } = args;
    const deadline = AbortSignal.timeout(75_000);
    const accountId = String(signedInAccount(provider).id);
    const checkAccount = () => {
        if (String(signedInAccount(provider).id) !== accountId) throw new MusicMcpError('Platform account changed during the request');
    };
    const confirmAccount = async () => {
        if (!await waitForRead(() => omni.isCurrentProviderAccount(provider, accountId), deadline)) throw new MusicMcpError('The platform session no longer matches the selected account');
        checkAccount();
    };
    const trackIds = [...new Set(args.trackIds)];
    const key = JSON.stringify([provider, accountId, args.requestId]);
    const signature = JSON.stringify([action, args.id, args.name, trackIds]);
    let creationStarted = false;
    const execute = async () => {
        const view = omni.getProviderSummaries().find(source => source.providerId === provider);
        const details = await waitForRead(() => omni.getSongDetails(provider, trackIds), deadline);
        const tracks = details.map((detail, index) => {
            if (detail.status !== 'found') throw new MusicMcpError('Target platform could not resolve track ' + trackIds[index]);
            return detail.song;
        });
        checkAccount();
        if (tracks.some((song, index) => {
            const track = trackView(song);
            return track.provider !== provider || track.id !== trackIds[index];
        })) throw new MusicMcpError('Use track IDs from the target platform');

        let playlist: OmniCollection;
        if (action === 'create_playlist') {
            await confirmAccount();
            creationStarted = true;
            playlist = await omni.createProviderPlaylist(provider, args.name, accountId);
        } else {
            const owned = (item: OmniCollection) => String(item.id) === args.id && item.type === 'playlist' && item.isOwned;
            const found = view?.collections.find(owned) ?? (await waitForRead(() => omni.refreshProviderPlaylists(provider), deadline)).find(owned);
            if (!found) throw new MusicMcpError('Target playlist was not found among owned playlists');
            playlist = found;
            if (playlist.isLiked || !omni.canEditCollectionTracks(playlist)) throw new MusicMcpError('The platform does not allow editing this playlist');
        }

        const wanted = new Set(trackIds);
        const removing = action === 'remove_playlist_tracks';
        let writeFailed = false;
        try {
            const existing = action === 'create_playlist' ? new Set<string>() : await waitForRead(() => readTracks(playlist, wanted), deadline);
            const changed = tracks.filter(song => existing.has(trackView(song).id) === removing);
            checkAccount();
            for (let start = 0; start < changed.length; start += PLAYLIST_ADD_BATCH) {
                await confirmAccount();
                const batch = changed.slice(start, start + PLAYLIST_ADD_BATCH);
                await omni.updateCollectionTracks(playlist, removing ? 'del' : 'add', batch, accountId);
            }
        } catch {
            writeFailed = true;
        }
        void omni.refreshProviderPlaylists(provider).catch(() => undefined);
        const result = { playlist: collectionView(playlist), writeFailed };
        try {
            checkAccount();
            const found = await waitForRead(() => readTracks(playlist, wanted), deadline);
            checkAccount();
            const verifiedTrackIds = trackIds.filter(id => found.has(id) !== removing);
            return { ...result, verifiedTrackIds, remainingTrackIds: trackIds.filter(id => found.has(id) === removing) };
        } catch {
            return { ...result, verification: 'unavailable', requestedTrackIds: trackIds };
        }
    };
    if (action === 'remove_playlist_tracks') return execute();
    const prior = writes.get(key);
    if (prior) {
        if (prior.signature !== signature) throw new MusicMcpError('Request ID already used with different arguments');
        return prior.result;
    }
    if (writes.size >= 5000) throw new MusicMcpError('This Folia session has reached its playlist-write history limit');
    const result = execute().catch((cause: unknown) => {
        if (!creationStarted) writes.delete(key);
        throw cause;
    });
    writes.set(key, { signature, result });
    return result;
}
