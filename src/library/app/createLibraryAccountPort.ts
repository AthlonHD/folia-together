import type { RefObject } from 'react';
import type { LyricData } from '../../types';
import type { OnlineProviderId } from '../../types/onlineMusic';
import type { LibraryProviderSwitchCleanupPort } from '../core/contracts/account';
import { useSearchNavigationStore } from '../../stores/useSearchNavigationStore';
import { useCollectionNavigationStore } from '../../stores/useCollectionNavigationStore';

// src/library/app/createLibraryAccountPort.ts
// 在线账户 controller 的切换清理端口(照 createLibraryHomePort 的做法)。
//
// 切换"当前浏览的平台"只影响搜索与集合浏览:正在播放的歌曲和播放队列不动。队列里每首歌自带来源
// (网易云、QQ 音乐、本地……),各用各的音源播放,所以可以跨平台混排;切换平台时清空它们没有任何好处,
// 只会让人在 QQ 音乐里找歌时丢掉网易云的队列。
// 因此这里只重置上一个平台留下的浏览运行态,切换也不再需要确认(requiresConfirmation: false)。

/** App 持有的播放器句柄。切换不再碰播放,保留这个类型是为了不改动调用方。 */
export type LibraryAccountSwitchHost = {
    audioRef: RefObject<HTMLAudioElement | null>;
    automixRef: RefObject<{ abortTransition: () => void } | null>;
    setLyrics: (lyrics: LyricData | null) => void;
};

export const createLibraryAccountSwitchCleanupPort = (
    _getHost?: () => LibraryAccountSwitchHost,
): LibraryProviderSwitchCleanupPort => ({
    // 切换只换浏览的平台,不会丢任何东西,没必要问用户
    requiresConfirmation: false,
    resetForProviderSwitch: (nextProviderId: OnlineProviderId) => {
        useSearchNavigationStore.getState().resetRuntime(nextProviderId);
        useCollectionNavigationStore.getState().clear();
    },
});
