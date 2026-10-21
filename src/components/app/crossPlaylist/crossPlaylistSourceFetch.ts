import type { SongResult } from '../../../types';
import type { OmniCollection, OmniPage } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';

// src/components/app/crossPlaylist/crossPlaylistSourceFetch.ts
// Reading the playlists of the platform accounts the user is signed in to, and the songs in one of them, for the cross-platform playlists
// that merge such a playlist in and follow it (crossPlaylistModel.ts: `applySourceSnapshot`). Goes through omni like everything online.

export interface AccountPlaylistOption {
    providerId: string;
    providerLabel: string;
    collectionId: string;
    name: string;
    trackCount?: number;
    /** The platform's own "liked songs" playlist. */
    isLiked: boolean;
}

/** The playlists of every platform that has a signed-in account, in the platforms' order; the cloud drive, albums and the like are left out. */
export const listAccountPlaylists = (): AccountPlaylistOption[] => {
    const options: AccountPlaylistOption[] = [];
    for (const provider of omni.getProviderSummaries()) {
        if (provider.status !== 'authenticated') continue;
        for (const collection of provider.collections) {
            if (collection.type !== 'playlist') continue;
            options.push({
                providerId: provider.providerId,
                providerLabel: provider.displayName,
                collectionId: String(collection.id),
                name: collection.name,
                trackCount: collection.trackCount,
                isLiked: collection.isLiked === true,
            });
        }
    }
    return options;
};

type PageReader = (collection: OmniCollection, page: { limit: number; offset: number }) => Promise<OmniPage<SongResult>>;

const PAGE_SIZE = 100;
/** A runaway list (a provider that never says it is done) is cut here. */
const MAX_SONGS = 20_000;

/** Every song of one platform playlist, read page by page; `onProgress` hears how many so far. */
export const fetchPlaylistSongs = async (
    providerId: string,
    collectionId: string,
    name: string,
    options: { onProgress?: (count: number) => void; readPage?: PageReader } = {},
): Promise<SongResult[]> => {
    // The account's own record of the playlist when there is one (some platforms need what it carries); otherwise the bare identity.
    const known = omni.getProviderSummaries()
        .find(provider => provider.providerId === providerId)
        ?.collections.find(collection => String(collection.id) === collectionId);
    const collection: OmniCollection = known ?? { providerId, id: collectionId, name, type: 'playlist' };
    const readPage: PageReader = options.readPage ?? ((target, page) => omni.getCollectionTracks(target, page) as Promise<OmniPage<SongResult>>);

    const songs: SongResult[] = [];
    let offset = 0;
    for (;;) {
        const page = await readPage(collection, { limit: PAGE_SIZE, offset });
        songs.push(...page.items);
        options.onProgress?.(songs.length);
        const next = page.nextOffset > offset ? page.nextOffset : offset + page.items.length;
        if (!page.hasMore || page.items.length === 0 || next <= offset || songs.length >= MAX_SONGS) break;
        offset = next;
    }
    return songs;
};
