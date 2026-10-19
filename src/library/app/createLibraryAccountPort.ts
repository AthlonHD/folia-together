import type { RefObject } from 'react';
import { PlayerState, type LyricData } from '../../types';
import type { OnlineProviderId } from '../../types/onlineMusic';
import type { LibraryProviderSwitchCleanupPort } from '../core/account/account.contract';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useSearchNavigationStore } from '../../stores/useSearchNavigationStore';
import { useCollectionNavigationStore } from '../../stores/useCollectionNavigationStore';
import { clearPrefetchRuntime } from '../../services/prefetchService';
import { clearTrackProfileRuntime } from '../../services/automix/profileService';
import { dropPlaysInFlight, makeSongCurrent } from '../../components/app/playback/currentSong';
import { forgetPlaybackCache } from '../../components/app/playback/persistPlaybackCache';

// src/library/app/createLibraryAccountPort.ts
// 在线账户 controller 的播放器端口（照 createLibraryHomePort 的做法）：平台换了时清空播放器——切到别的平台
// （用户同意之后、controller 写新的当前平台之前），和退出当前平台（用户答应的那一刻），两处一样地清。
// 播放器的 DOM 与 automix 句柄只有 App 持有，经 getHost 现读；播放状态读写都走 usePlaybackStore 的最新值。

/** App 持有的播放器句柄。切换不再碰播放,保留这个类型是为了不改动调用方。 */
export type LibraryAccountSwitchHost = {
    audioRef: RefObject<HTMLAudioElement | null>;
    automixRef: RefObject<{ abortTransition: () => void } | null>;
    shouldAutoPlay: RefObject<boolean>;
    /** App 的歌词写入（带过滤设置的那一个；清空时只传 null）。 */
    setLyrics: (lyrics: LyricData | null) => void;
    setIsLyricsLoading: (loading: boolean) => void;
};

/** 清空会不会拿走东西：播放器里有正在放的歌，或者队列里有歌。 */
export const playerHoldsSongs = (): boolean => {
    const { currentSong, playQueue } = usePlaybackStore.getState();
    return currentSong !== null || playQueue.length > 0;
};

/**
 * 停掉声音，清掉歌、队列、歌词、封面、FM 模式和缓存，再重置搜索与集合导航；搜索之后跟着 `nextProviderId`。
 */
export const emptyPlayerForProviderChange = (host: LibraryAccountSwitchHost, nextProviderId: OnlineProviderId): void => {
    const playback = usePlaybackStore.getState();
    // Stops any deck still fading out in the background: this path clears the active deck
    // only, and a tail left running would have no control pointing at it any more.
    host.automixRef.current?.abortTransition();
    const audio = host.audioRef.current;
    audio?.pause();
    audio?.removeAttribute('src');
    audio?.load();
    if (playback.audioSrc?.startsWith('blob:')) URL.revokeObjectURL(playback.audioSrc);
    playback.setAudioSrc(null);
    // A play of the old platform that is still fetching its address must not bring its song back.
    dropPlaysInFlight();
    makeSongCurrent(null);
    playback.setPlayQueue([]);
    // The saved session goes too: the next launch would bring the old platform's song back, and a
    // switch after it would ask again about a player this emptying already cleared.
    void forgetPlaybackCache();
    host.setLyrics(null);
    playback.setCachedCoverUrl(null);
    playback.setIsFmMode(false);
    // A load that this cuts short never clears these two itself.
    host.setIsLyricsLoading(false);
    host.shouldAutoPlay.current = false;
    playback.setPlayerState(PlayerState.IDLE);
    clearPrefetchRuntime();
    // The measurements are keyed by playback key, so the outgoing provider's are unreachable
    // from here on. Dropped alongside the prefetch cache they were gathered with, rather than
    // sitting in memory until the tab is closed.
    clearTrackProfileRuntime();
    useSearchNavigationStore.getState().resetRuntime(nextProviderId);
    useCollectionNavigationStore.getState().clear();
    console.info(`[ProviderChange] the player was emptied (search follows ${nextProviderId})`);
};

// 本 Fork:切换"当前浏览的平台"只影响搜索与集合浏览,正在播放的歌曲和播放队列不动。队列里每首歌自带来源
// (网易云、QQ 音乐、酷狗、本地……),各用各的音源播放,所以可以跨平台混排;切换平台时清空它们没有任何好处,
// 只会让人在 QQ 音乐里找歌时丢掉网易云的队列。因此端口声明"不拿走任何东西"(holdsSongs 恒为 false):
// 切换不弹确认框,退出当前平台也不清播放器,只重置上一个平台留下的搜索与集合导航。
// 上游的 emptyPlayerForProviderChange / playerHoldsSongs 保留着(别处与测试在用),这里不调用,所以 host 参数可以省略。
export const createLibraryAccountSwitchCleanupPort = (
    _getHost?: () => LibraryAccountSwitchHost,
): LibraryProviderSwitchCleanupPort => ({
    holdsSongs: () => false,
    resetForProviderSwitch: (nextProviderId: OnlineProviderId) => {
        useSearchNavigationStore.getState().resetRuntime(nextProviderId);
        useCollectionNavigationStore.getState().clear();
    },
});
