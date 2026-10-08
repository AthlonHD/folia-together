import type { LocalSong } from '../types';

// src/utils/localLibraryRevision.ts
// Host 本地曲库的"版本号":歌曲数、歌单数、最新入库时间任一变化,遥控端就该重新读取曲库。
// Host 在快照里发出这个号,遥控端和自己读到的曲库里带的号比对;两边必须用同一个算法。

export const buildLocalLibraryRevision = (songs: LocalSong[], playlistCount: number): string => {
    const newestAddedAt = songs.reduce((max, song) => Math.max(max, song.addedAt || 0), 0);
    return `${songs.length}:${playlistCount}:${newestAddedAt}`;
};

let hostLocalLibraryRevision = '';

/** Host 页在曲库加载/变化后更新,供快照带出。 */
export const setHostLocalLibraryRevision = (revision: string) => {
    hostLocalLibraryRevision = revision;
};

export const getHostLocalLibraryRevision = (): string => hostLocalLibraryRevision;
