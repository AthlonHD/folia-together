import { useEffect } from 'react';
import type { SongResult } from '../types';
import { registerHeartbeatAvailabilityResolver } from '../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { usePlayQueueContextStore } from '../stores/usePlayQueueContextStore';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { getHeartbeatAvailable } from '../utils/heartbeatAvailability';

// src/hooks/useHeartbeatContextGuard.ts
// 心动模式的两处接线,放在 hook 里而不是 store 里(store 之间不互相依赖,见 storeContract):
// 1. 把「此刻能不能用心动」告诉音频设置 store(循环按钮切到心动前要问它);
// 2. 队列里混进了「我喜欢的音乐」之外的歌(别处入队、从别的集合或搜索播放),就不再算在它的播放上下文里,
//    心动随之不可用。心动自己追加的歌会先记入上下文再改队列,所以不会被这里清掉。

/** 队列里有没有不属于「我喜欢的音乐」播放上下文的歌:有就该丢掉上下文。 */
export const shouldDropLikedContext = (
    context: { songKeys: ReadonlySet<string> } | null,
    queue: readonly SongResult[],
): boolean => Boolean(context) && queue.some(song => !context!.songKeys.has(getPlaybackSongKey(song)));

export const useHeartbeatContextGuard = (): void => {
    const playQueue = usePlaybackStore(state => state.playQueue);

    useEffect(() => {
        registerHeartbeatAvailabilityResolver(getHeartbeatAvailable);
    }, []);

    useEffect(() => {
        if (shouldDropLikedContext(usePlayQueueContextStore.getState().likedContext, playQueue)) {
            usePlayQueueContextStore.getState().clearLikedContext();
        }
    }, [playQueue]);
};
