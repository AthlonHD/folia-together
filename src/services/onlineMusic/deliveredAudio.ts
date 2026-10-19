import { useSyncExternalStore } from 'react';
import type { SongResult } from '../../types';
import type { AudioQualityPreference, ProviderDeliveredAudio } from '../../types/onlineMusic';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// src/services/onlineMusic/deliveredAudio.ts
// 本 Fork:正在播的歌,平台实际给的是什么音质。provider 在 getAudioSource 里答出来(ProviderAudioSource.delivered),
// omni 在这里记一笔(带上用户选的档位,好看出有没有被降级),播放条用 useDeliveredAudio 读。
// 只在本次运行里记;从媒体缓存里放出来的旧副本这里没有记录,界面也就不显示——不猜。

export interface DeliveredAudioEntry extends ProviderDeliveredAudio {
    /** 用户选的音质偏好(不是 provider 映射后的那一档)。 */
    requested: AudioQualityPreference;
}

const LIMIT = 64;
const entries = new Map<string, DeliveredAudioEntry>();
const listeners = new Set<() => void>();

export const noteDeliveredAudio = (song: SongResult, requested: AudioQualityPreference, delivered: ProviderDeliveredAudio): void => {
    const key = getPlaybackSongKey(song);
    entries.delete(key);
    entries.set(key, { ...delivered, requested });
    if (entries.size > LIMIT) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
    }
    listeners.forEach(listener => listener());
};

export const getDeliveredAudio = (song: SongResult | null | undefined): DeliveredAudioEntry | undefined => (
    song ? entries.get(getPlaybackSongKey(song)) : undefined
);

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const useDeliveredAudio = (song: SongResult | null | undefined): DeliveredAudioEntry | undefined => (
    useSyncExternalStore(subscribe, () => getDeliveredAudio(song))
);

const RANK: Record<AudioQualityPreference, number> = { standard: 0, high: 1, ultra: 2, lossless: 3, hires: 4 };

/** 实际给的档位比用户选的低(平台给不出、或这一档是会员档)。档位不明时不下结论。 */
export const isDowngraded = (entry: DeliveredAudioEntry): boolean => (
    entry.level !== undefined && RANK[entry.level] < RANK[entry.requested]
);

/** 如 "Hi-Res · FLAC"、"无损 FLAC"、"MP3 320k"。 */
export const describeDeliveredAudio = (entry: ProviderDeliveredAudio): string => {
    const tier = entry.level === 'hires' ? 'Hi-Res' : entry.level === 'lossless' ? 'Lossless' : '';
    const lossyRate = !tier && entry.bitrateKbps ? `${entry.bitrateKbps}k` : '';
    return [tier, entry.codec, lossyRate].filter(Boolean).join(' · ') || (entry.level ?? '');
};
