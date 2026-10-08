import type { LocalLibrarySnapshot, LocalSong } from '../types';
import { getDirHandles, getLocalLibrarySnapshot, getLocalSongs } from './db';
import { getLocalPlaylists } from './localPlaylistService';
import { getLocalLibraryAssignments, getLocalLibraryEntities } from './localLibraryEntityRepository';
import { ensureLocalLibraryInitialized } from './localLibraryCatalogService';
import { getLocalCoverAssetUrl } from './localCoverAssetUrl';
import { readLocalCoverBinary } from './localCoverBinaryStore';
import { registerHostRpcHandler } from './hostRpcRegistry';
import { buildLocalLibraryRevision } from '../utils/localLibraryRevision';
import { resolveLocalSongLyrics } from '../utils/lyrics/localSongLyrics';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';

// src/services/hostLocalLibraryRpc.ts
// Host 页把自己的本地曲库只读地共享给中继,遥控页浏览并点播 Host 上的本地音乐。
// 只回元数据:文件句柄带不走,歌词全文很大,所以曲库列表里去掉它们,歌词在播放时单独取。

/** 曲库列表里不带的重字段:歌词全文、已匹配的歌词对象、文件句柄。 */
const stripHeavyFields = (song: LocalSong): LocalSong => {
    const {
        fileHandle: _fileHandle,
        matchedLyrics: _matchedLyrics,
        localLyricsContent: _localLyricsContent,
        localTranslationLyricsContent: _localTranslationLyricsContent,
        embeddedLyricsContent: _embeddedLyricsContent,
        embeddedTranslationLyricsContent: _embeddedTranslationLyricsContent,
        ...light
    } = song;
    return light as LocalSong;
};

/** 文件夹树只需要目录结构,每个目录下的文件清单(带签名)很大且遥控端用不到。 */
const stripSnapshotFiles = (snapshot: LocalLibrarySnapshot): LocalLibrarySnapshot => {
    const strip = (node: LocalLibrarySnapshot['tree']): LocalLibrarySnapshot['tree'] => ({
        ...node,
        files: [],
        children: node.children.map(strip),
    });
    return { ...snapshot, tree: strip(snapshot.tree) };
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
};

export const readHostLocalLibrary = async () => {
    await ensureLocalLibraryInitialized();
    const [songs, playlists, entities, assignments, handles] = await Promise.all([
        getLocalSongs(),
        getLocalPlaylists(),
        getLocalLibraryEntities(),
        getLocalLibraryAssignments(),
        getDirHandles(),
    ]);
    const snapshots = (await Promise.all(Object.keys(handles).map(root => getLocalLibrarySnapshot(root))))
        .filter((snapshot): snapshot is LocalLibrarySnapshot => Boolean(snapshot))
        .map(stripSnapshotFiles);
    return {
        revision: buildLocalLibraryRevision(songs, playlists.length),
        songs: songs.map(stripHeavyFields),
        playlists,
        entities,
        assignments,
        snapshots,
    };
};

export const registerHostLocalLibraryRpc = () => {
    registerHostRpcHandler('local-library', readHostLocalLibrary);

    // 封面优先走 Host 自己页面用的 /__folia_cover/<id>(Service Worker 从 OPFS 读,并懒生成缩略图,
    // 遥控端的封面墙需要小图);Service Worker 没接管页面时退回直接读 OPFS 里的原图
    registerHostRpcHandler('local-cover', async ({ assetId, size }: { assetId: string; size?: number }) => {
        const url = getLocalCoverAssetUrl(assetId, size || undefined);
        if (url) {
            try {
                const response = await fetch(url);
                // Service Worker 没接管页面时,服务器可能对这个路径回一个 200 的网页(单页应用的兜底),必须按内容类型挡掉
                const contentType = response.headers.get('content-type') || '';
                if (response.ok && contentType.startsWith('image/')) {
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    return { mime: contentType, base64: bytesToBase64(bytes) };
                }
            } catch {
                // 退回原图
            }
        }
        const original = await readLocalCoverBinary(assetId);
        if (!original) return null;
        return { mime: original.mimeType, base64: bytesToBase64(new Uint8Array(await original.blob.arrayBuffer())) };
    });

    registerHostRpcHandler('local-lyrics', async ({ songId }: { songId: string }) => {
        const song = (await getLocalSongs()).find(candidate => candidate.id === songId);
        if (!song) return { lyrics: null, source: null };
        return resolveLocalSongLyrics(song, useLyricSettingsStore.getState().localLyricsPriority);
    });
};
