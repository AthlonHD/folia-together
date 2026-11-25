import { isStageRemoteMode } from './stageRemote';
import { readHostLocalLibrary } from './hostLocalLibraryClient';
import { getFoliaPlaylistEntryKeys, getFoliaPlaylistSummaries } from './foliaPlaylist/foliaPlaylistService';
import { getFoliaEntryLocalSongId } from '../utils/foliaPlaylistEntries';

// src/services/localPlaylistService.ts
// 本地歌单已经并进 Folia 歌单。Host 曲库共享和音乐 MCP 仍按 { id, name, songIds } 读这一份：
// 遥控模式的歌单来自 Host 共享出来的曲库；本机模式从 Folia 歌单里取出本地歌的 id。

type LocalPlaylistView = {
    id: string;
    name: string;
    songIds: string[];
    createdAt: number;
    updatedAt: number;
    isFavorite?: boolean;
};

type RemotePlaylist = {
    id: string;
    name: string;
    songIds?: string[];
    createdAt?: number;
    updatedAt?: number;
    isFavorite?: boolean;
};

const localSongIdsOf = (keys: readonly string[]): string[] => (
    keys.flatMap(key => {
        const songId = getFoliaEntryLocalSongId({ key });
        return songId ? [songId] : [];
    })
);

const viewOfRemote = (playlist: RemotePlaylist): LocalPlaylistView => ({
    id: playlist.id,
    name: playlist.name,
    songIds: Array.isArray(playlist.songIds) ? playlist.songIds : [],
    createdAt: typeof playlist.createdAt === 'number' ? playlist.createdAt : 0,
    updatedAt: typeof playlist.updatedAt === 'number' ? playlist.updatedAt : 0,
    isFavorite: playlist.isFavorite,
});

export const getLocalPlaylists = async (): Promise<LocalPlaylistView[]> => {
    if (isStageRemoteMode()) {
        const library = await readHostLocalLibrary() as { playlists?: readonly RemotePlaylist[] };
        return (library.playlists ?? []).map(viewOfRemote);
    }
    const summaries = await getFoliaPlaylistSummaries();
    return Promise.all(summaries.map(async playlist => ({
        id: playlist.id,
        name: playlist.name,
        songIds: localSongIdsOf(await getFoliaPlaylistEntryKeys(playlist.id)),
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        isFavorite: playlist.isFavorite,
    })));
};
