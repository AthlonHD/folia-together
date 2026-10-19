import { HeartPulse, Repeat, Repeat1, RepeatOff, Shuffle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LoopDisplayMode } from '../../utils/loopDisplayMode';
// src/components/shared/loopModeDisplay.ts
// How the repeat button shows each repeat mode: its icon and the name of its label. Used by the
// side panel's song actions, the player bar's slot and the remote window.
// 本 Fork 的循环按钮多两档:随机(Shuffle)与网易云心动模式(心形加心跳线,与网易云自家的心动模式图标一致)。

export const loopModeIcon = (loopMode: LoopDisplayMode): LucideIcon => {
    if (loopMode === 'shuffle') return Shuffle;
    if (loopMode === 'heartbeat') return HeartPulse;
    if (loopMode === 'off') return RepeatOff;
    if (loopMode === 'one') return Repeat1;
    return Repeat;
};

/** The last part of the label's i18n key: the main window's labels are `player.<name>`, the remote window's `remote.<name>`. */
export const loopModeLabelName = (loopMode: LoopDisplayMode): 'loopOff' | 'loopOne' | 'loopAll' | 'loopShuffle' | 'loopHeartbeat' => {
    if (loopMode === 'shuffle') return 'loopShuffle';
    if (loopMode === 'heartbeat') return 'loopHeartbeat';
    if (loopMode === 'off') return 'loopOff';
    if (loopMode === 'one') return 'loopOne';
    return 'loopAll';
};
