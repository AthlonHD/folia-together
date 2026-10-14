import type { SongResult } from '../types';
import { omni } from '../services/onlineMusic/omni';
import { usePlayQueueContextStore } from '../stores/usePlayQueueContextStore';
import { getPlaybackSongKey } from './appPlaybackGuards';

// src/utils/heartbeatAdvance.ts
// 心动模式挑下一首:拿当前这首和「我喜欢的音乐」歌单去问网易云,取推荐里第一首还不在队列里的。
// 任何失败(没有歌单上下文、接口报错、推荐全都已在队列里)都返回 null,调用方退回普通的顺序播放。

// 多要几首,是为了推荐里有已经在队列里的歌时还能挑到新的;接口一次返回多少由网易云决定。
const REQUEST_COUNT = 3;

export const pickHeartbeatSong = (recommended: readonly SongResult[], queue: readonly SongResult[]): SongResult | null => {
    const queued = new Set(queue.map(getPlaybackSongKey));
    return recommended.find(song => !queued.has(getPlaybackSongKey(song))) ?? null;
};

export const fetchHeartbeatNext = async (
    current: SongResult,
    queue: readonly SongResult[],
): Promise<SongResult | null> => {
    const context = usePlayQueueContextStore.getState().likedContext;
    if (!context) return null;
    try {
        const recommended = await omni.getHeartbeatSongs(current, context.playlistId, REQUEST_COUNT);
        return pickHeartbeatSong(recommended, queue);
    } catch (error) {
        console.warn('[Heartbeat] failed to fetch the next song, falling back to queue order', error);
        return null;
    }
};

/** 把心动挑出来的歌插到当前歌后面(没找到当前歌就放队尾),并记入「我喜欢的音乐」播放上下文。 */
export const insertHeartbeatSong = (
    queue: readonly SongResult[],
    currentSongKey: string,
    song: SongResult,
): SongResult[] => {
    usePlayQueueContextStore.getState().noteRecommendedSong(getPlaybackSongKey(song));
    const index = queue.findIndex(item => getPlaybackSongKey(item) === currentSongKey);
    return index < 0
        ? [...queue, song]
        : [...queue.slice(0, index + 1), song, ...queue.slice(index + 1)];
};
