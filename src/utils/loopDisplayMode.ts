// src/utils/loopDisplayMode.ts
// 循环按钮的四态展示:关闭 / 列表循环 / 单曲循环 / 随机。
//
// 随机在逻辑层不是 loopMode 的第四个取值:它是 loopMode === 'all' 加上独立的 shuffleEnabled,
// 这样所有按 loopMode 推导"下一首/能否跳转"的老逻辑都保持原样,只有真正挑下一首的地方认随机。

export type LoopDisplayMode = 'off' | 'all' | 'one' | 'shuffle';

export const getLoopDisplayMode = (
    loopMode: 'off' | 'all' | 'one',
    shuffleEnabled: boolean,
): LoopDisplayMode => (shuffleEnabled ? 'shuffle' : loopMode);
