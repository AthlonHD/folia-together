import { create } from 'zustand';

// src/stores/usePlayQueueContextStore.ts
// 「这个队列是从哪放出来的」——目前只关心一件事:是不是在播网易云的「我喜欢的音乐」,
// 心动模式(网易云按一首歌和一个歌单推荐相似歌曲)只在这时可用。
//
// 不去拦截所有入队入口,而是记下从「我喜欢的音乐」歌单页放出来的那批歌的键,再加上心动自己追加进队列的歌;
// 当前这首歌在这个集合里,就算还在「我喜欢的音乐」的播放上下文里,换到别处的歌(搜索、别的歌单)自然就脱离了。
// 遥控页不持有这份数据,可用与否由 Host 随状态快照带来(remoteAvailable)。

type LikedPlaylistContext = {
    playlistId: string | number;
    songKeys: ReadonlySet<string>;
};

type PlayQueueContextState = {
    likedContext: LikedPlaylistContext | null;
    /** 遥控页镜像 Host:Host 当前是否可用心动。null 表示还没收到。 */
    remoteAvailable: boolean | null;
    /** 从「我喜欢的音乐」歌单页开始播放:记下歌单 id 与这批歌的键。 */
    setLikedContext: (playlistId: string | number, songKeys: Iterable<string>) => void;
    clearLikedContext: () => void;
    /** 心动追加进队列的歌也算「我喜欢的音乐」播放上下文的一部分,否则下一首就脱离了。 */
    noteContextSong: (songKey: string) => void;
    setRemoteAvailable: (available: boolean | null) => void;
};

export const usePlayQueueContextStore = create<PlayQueueContextState>((set, get) => ({
    likedContext: null,
    remoteAvailable: null,
    setLikedContext: (playlistId, songKeys) => set({ likedContext: { playlistId, songKeys: new Set(songKeys) } }),
    clearLikedContext: () => set({ likedContext: null }),
    noteContextSong: songKey => {
        const context = get().likedContext;
        if (!context || context.songKeys.has(songKey)) return;
        set({ likedContext: { ...context, songKeys: new Set([...context.songKeys, songKey]) } });
    },
    setRemoteAvailable: available => set({ remoteAvailable: available }),
}));

/** 这首歌此刻是否属于「我喜欢的音乐」的播放上下文(Host / 本机用)。 */
export const isSongInLikedContext = (songKey: string | null | undefined): boolean => {
    if (!songKey) return false;
    return usePlayQueueContextStore.getState().likedContext?.songKeys.has(songKey) ?? false;
};
