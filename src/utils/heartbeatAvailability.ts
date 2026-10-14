import { isStageRemoteMode } from '../services/stageMode';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { isSongInLikedContext, usePlayQueueContextStore } from '../stores/usePlayQueueContextStore';
import { getPlaybackSongKey } from './appPlaybackGuards';

// src/utils/heartbeatAvailability.ts
// 心动模式此刻能不能用:正在播放网易云「我喜欢的音乐」里的歌(见 usePlayQueueContextStore)。
// 遥控页不持有播放队列与上下文,用 Host 随状态快照带来的结果。

export const getHeartbeatAvailable = (): boolean => {
    if (isStageRemoteMode()) return usePlayQueueContextStore.getState().remoteAvailable === true;
    const song = usePlaybackStore.getState().currentSong;
    return song ? isSongInLikedContext(getPlaybackSongKey(song)) : false;
};
