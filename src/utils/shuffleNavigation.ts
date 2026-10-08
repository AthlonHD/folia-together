import type { SongResult } from '../types';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlayOrderStore } from '../stores/usePlayOrderStore';
import { getPlaybackSongKey } from './appPlaybackGuards';

// src/utils/shuffleNavigation.ts
// 随机模式下"下一首/上一首"会落在哪首歌:读取随机顺序 store 的预选与历史。
// 放在 utils 而不是 store 里,因为要同时读音频设置(是否开着随机),而 store 之间不互相依赖。

const findSongByKey = (queue: SongResult[], songKey: string | null): SongResult | null => (
    songKey ? queue.find(song => getPlaybackSongKey(song) === songKey) ?? null : null
);

/** 随机模式下预选的下一首;没开随机或还没选出来时为 null。 */
export const getShuffleNextSong = (queue: SongResult[]): SongResult | null => (
    useAudioSettingsStore.getState().shuffleEnabled
        ? findSongByKey(queue, usePlayOrderStore.getState().upcomingKey)
        : null
);

/** 随机模式下"上一首"会回到的歌(历史栈顶);没开随机或没有历史时为 null。 */
export const getShufflePrevSong = (queue: SongResult[]): SongResult | null => {
    if (!useAudioSettingsStore.getState().shuffleEnabled) return null;
    const { history } = usePlayOrderStore.getState();
    return findSongByKey(queue, history.length > 0 ? history[history.length - 1] : null);
};
