import { omni } from '../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import type { SongResult } from '../../types';
import { getOnlineProviderIdForSong } from '../../utils/appPlaybackGuards';

// src/components/shared/songPlatform.ts
// Which platform a song plays from, for the places that list or show what is playing (the player bar, the queue lists). Said only
// while the queue mixes songs of several platforms (a cross-platform playlist); a queue of one platform is shown as before.

const mixedByQueue = new WeakMap<readonly SongResult[], boolean>();

/** Whether the queue holds online songs of more than one platform. Kept per queue array: every row of a list asks. */
export const queueMixesPlatforms = (queue: readonly SongResult[]): boolean => {
    const known = mixedByQueue.get(queue);
    if (known !== undefined) return known;
    const platforms = new Set<string>();
    for (const song of queue) {
        const providerId = getOnlineProviderIdForSong(song);
        if (providerId) platforms.add(providerId);
        if (platforms.size > 1) break;
    }
    const mixed = platforms.size > 1;
    mixedByQueue.set(queue, mixed);
    return mixed;
};

export const useQueueMixesPlatforms = (): boolean => usePlaybackStore(state => queueMixesPlatforms(state.playQueue));

/** The platform's short name for an online song; null for a local or Navidrome one. */
export const songPlatformLabel = (song: SongResult | null | undefined): string | null => {
    const providerId = getOnlineProviderIdForSong(song);
    return providerId ? omni.getProviderLabel(providerId) : null;
};

/** The artist line of a queue row, with the platform after it while the queue mixes platforms. */
export const withPlatform = (artistLine: string, song: SongResult, mixed: boolean): string => {
    const platform = mixed ? songPlatformLabel(song) : null;
    if (!platform) return artistLine;
    return artistLine ? `${artistLine} · ${platform}` : platform;
};
