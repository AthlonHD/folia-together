import type { SongResult } from '../../../types';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { omni } from '../../../services/onlineMusic/omni';
import type { OmniCollection } from '../../../types/onlineMusic';

// Maps provider objects to the music metadata that can leave the desktop app.
export function trackView(song: SongResult) {
    const source = getPlaybackSourceRef(song);
    return {
        id: String(source.kind === 'online' ? source.mediaId : song.id),
        provider: source.kind === 'online' ? source.providerId : source.kind,
        name: song.name,
        artists: song.artists.map(artist => artist.name),
        album: song.album.name,
        durationMs: song.durationMs,
        listenCount: 'listenCount' in song ? song.listenCount : undefined,
        available: song.resourceState,
    };
}

export function collectionView(collection: OmniCollection) {
    return {
        id: String(collection.id),
        provider: collection.providerId,
        kind: collection.type,
        name: collection.name,
        description: collection.description,
        trackCount: collection.trackCount,
        owned: collection.isOwned,
        pageUrl: omni.getPlaylistPageUrl(collection),
        liked: collection.isLiked,
    };
}

export class MusicMcpError extends Error {}

type TrackRef = { provider: string; id: string };

export async function getTrack({ provider, id }: TrackRef) {
    const song = await omni.getSongDetail(provider, id);
    if (!song) throw new MusicMcpError('Track unavailable');
    return song;
}

const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export function sameRecording(source: SongResult, candidate: SongResult): boolean {
    const a = trackView(source);
    const b = trackView(candidate);
    const artistKey = (names: string[]) => names.map(normalize).sort().join('\n');
    return normalize(a.name) === normalize(b.name)
        && a.artists.length > 0 && artistKey(a.artists) === artistKey(b.artists)
        && a.durationMs > 0 && b.durationMs > 0 && Math.abs(a.durationMs - b.durationMs) <= 2500
        && normalize(a.album || '') === normalize(b.album || '');
}

/** Finds a unique matching recording and leaves ambiguous editions for the agent to resolve. */
export async function matchPlaylistTracks(provider: string, tracks: TrackRef[]) {
    const items = [];
    for (const ref of tracks) {
        try {
            const song = await getTrack(ref);
            if (ref.provider === provider) {
                items.push({ source: ref, status: 'matched', track: trackView(song) });
                continue;
            }
            const page = await omni.searchProviderSongs(provider, [song.name, ...song.artists.map(artist => artist.name)].join(' '), {
                limit: 15, offset: 0,
            });
            const matches = page.items.filter(candidate => sameRecording(song, candidate));
            items.push({
                source: ref,
                status: matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'unmatched',
                ...(matches.length === 1 ? { track: trackView(matches[0]) } : { candidates: (matches.length ? matches : page.items).slice(0, 5).map(trackView) }),
            });
        } catch {
            items.push({ source: ref, status: 'unavailable' });
        }
    }
    return { items };
}
