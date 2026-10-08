import { create } from 'zustand';
import type { SongResult } from '../types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// src/stores/usePlayOrderStore.ts
// 随机播放模式的"下一首"与回退历史。不改动播放队列本身:队列顺序始终是用户看到的顺序,
// 关掉随机后一切照旧;这里只记录随机模式下"接下来播哪首"和"走过哪些歌"。
//
// upcomingKey 在歌曲切换后就预先选好,这样自动混音、"即将播放"提示、上一首/下一首可用性
// 这些要提前知道下一首是谁的地方,看到的和真正会播放的是同一首。

const HISTORY_LIMIT = 200;

type PlayOrderState = {
    /** 随机模式下已离开的歌曲,栈顶是刚离开的那首,供"上一首"回退。 */
    history: string[];
    /** "上一首"退回去之后留下的前进路径,栈顶是再点"下一首"会回到的那首;手动换歌时清空。 */
    forward: string[];
    /** 本轮已经播过(或排除在候选外)的歌曲;候选耗尽时开启新一轮。 */
    playedThisRound: string[];
    /** 预先选好的下一首。 */
    upcomingKey: string | null;
    reset: () => void;
    /** 当前歌曲从 previousKey 换成了 songKey:记录历史并维护前进栈。viaPrev 表示这次是"上一首"造成的。 */
    onSongChanged: (previousKey: string | null, songKey: string | null, viaPrev: boolean) => void;
    /** "上一首":弹出历史栈顶,并把当前歌压进前进栈,这样再点"下一首"能走回来。 */
    popHistory: (currentKey: string | null) => string | null;
    ensureUpcoming: (queue: SongResult[], currentKey: string | null) => string | null;
};

const pickRandom = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

export const usePlayOrderStore = create<PlayOrderState>((set, get) => ({
    history: [],
    forward: [],
    playedThisRound: [],
    upcomingKey: null,

    reset: () => set({ history: [], forward: [], playedThisRound: [], upcomingKey: null }),

    onSongChanged: (previousKey, songKey, viaPrev) => {
        if (viaPrev || !previousKey || !songKey || previousKey === songKey) return;
        const { history, forward } = get();
        // 走到了前进栈指的那首:消费它;换到了别的歌(手动点歌等):前进路径作废
        const arrivedViaForward = forward.length > 0 && forward[forward.length - 1] === songKey;
        set({
            history: [...history, previousKey].slice(-HISTORY_LIMIT),
            forward: arrivedViaForward ? forward.slice(0, -1) : [],
        });
    },

    popHistory: (currentKey) => {
        const { history, forward } = get();
        if (history.length === 0) return null;
        const songKey = history[history.length - 1];
        set({
            history: history.slice(0, -1),
            forward: currentKey ? [...forward, currentKey] : forward,
            upcomingKey: null,
        });
        return songKey;
    },

    // 已有的预选仍然有效(在队列里且不是当前歌)就保留,否则重新挑一首:
    // 优先挑本轮没播过的,全播过就开新一轮。队列不足两首时没有可挑的。
    ensureUpcoming: (queue, currentKey) => {
        const queueKeys = queue.map(getPlaybackSongKey);
        const state = get();
        if (queueKeys.length < 2 || !currentKey) {
            if (state.upcomingKey !== null) set({ upcomingKey: null });
            return null;
        }

        // 退回过的话,下一首先沿前进栈走回去
        const forwardKey = state.forward[state.forward.length - 1];
        if (forwardKey && forwardKey !== currentKey && queueKeys.includes(forwardKey)) {
            if (state.upcomingKey !== forwardKey) set({ upcomingKey: forwardKey });
            return forwardKey;
        }

        if (state.upcomingKey && state.upcomingKey !== currentKey && queueKeys.includes(state.upcomingKey)) {
            return state.upcomingKey;
        }

        const played = new Set([...state.playedThisRound, currentKey]);
        let candidates = queueKeys.filter(key => !played.has(key));
        let nextRound = [...played];
        if (candidates.length === 0) {
            candidates = queueKeys.filter(key => key !== currentKey);
            nextRound = [currentKey];
        }

        const upcomingKey = pickRandom(candidates);
        set({ upcomingKey, playedThisRound: [...new Set([...nextRound, upcomingKey])] });
        return upcomingKey;
    },
}));
