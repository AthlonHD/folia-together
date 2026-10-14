// src/utils/loopDisplayMode.ts
// 循环按钮的展示态:关闭 / 列表循环 / 单曲循环 / 随机 / 心动。
//
// 随机和心动在逻辑层都不是 loopMode 的取值:它们是 loopMode === 'all' 加上各自独立的开关
// (shuffleEnabled / heartbeatEnabled),这样所有按 loopMode 推导"下一首/能否跳转"的老逻辑都保持原样,
// 只有真正挑下一首的地方认随机与心动。
// 心动(网易云「心动模式」)只在播放网易云「我喜欢的音乐」时可用,是否可用由调用方传入。

export type LoopDisplayMode = 'off' | 'all' | 'one' | 'shuffle' | 'heartbeat';

export const getLoopDisplayMode = (
    loopMode: 'off' | 'all' | 'one',
    shuffleEnabled: boolean,
    heartbeatEnabled = false,
): LoopDisplayMode => (shuffleEnabled ? 'shuffle' : heartbeatEnabled ? 'heartbeat' : loopMode);

/**
 * 点循环按钮后的下一档:关闭 → 列表循环 → 单曲循环 → 随机 →(心动,仅当可用)→ 关闭。
 * 不可用时跳过心动;当前正处在心动但已不可用(换了歌)时按「心动之后」处理,回到关闭。
 */
export const nextLoopDisplayMode = (current: LoopDisplayMode, heartbeatAvailable: boolean): LoopDisplayMode => {
    switch (current) {
        case 'off': return 'all';
        case 'all': return 'one';
        case 'one': return 'shuffle';
        case 'shuffle': return heartbeatAvailable ? 'heartbeat' : 'off';
        case 'heartbeat':
        default: return 'off';
    }
};
