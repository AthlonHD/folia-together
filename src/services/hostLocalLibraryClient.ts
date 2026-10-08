import type { LocalLibrarySnapshot, LocalPlaylist, LocalSong } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';

// src/services/hostLocalLibraryClient.ts
// 遥控页读取服务器 Host 上的本地曲库(只读)。Host 页把自己的曲库经中继共享出来(见 hostLocalLibraryRpc),
// 遥控页里原来读本地数据库的几个入口在遥控模式下改读这份数据,于是整套本地曲库界面照常工作。

export interface HostLocalLibrary {
    revision: string;
    songs: LocalSong[];
    playlists: LocalPlaylist[];
    entities: LocalLibraryEntity[];
    assignments: LocalLibraryAssignment[];
    snapshots: LocalLibrarySnapshot[];
}

export const HOST_LOCAL_LIBRARY_CHANGED_EVENT = 'folia:host-local-library-changed';

const EMPTY_LIBRARY: HostLocalLibrary = {
    revision: '',
    songs: [],
    playlists: [],
    entities: [],
    assignments: [],
    snapshots: [],
};

let cache: HostLocalLibrary | null = null;
let inflight: Promise<HostLocalLibrary> | null = null;
let lastFetchFailed = false;

/** 读取 Host 的曲库;同一时刻只发一个请求,成功后缓存到曲库变化为止。Host 不在线时返回空曲库(不缓存)。 */
export const readHostLocalLibrary = async (): Promise<HostLocalLibrary> => {
    if (cache) return cache;
    inflight ??= fetch('/stage/local/library')
        .then(async response => {
            if (!response.ok) throw new Error(`Host local library unavailable (${response.status})`);
            const data = await response.json() as HostLocalLibrary;
            cache = { ...EMPTY_LIBRARY, ...data };
            lastFetchFailed = false;
            return cache;
        })
        .catch(error => {
            lastFetchFailed = true;
            console.warn('[HostLocalLibrary] Failed to read the host library', error);
            return EMPTY_LIBRARY;
        })
        .finally(() => { inflight = null; });
    return inflight;
};

/**
 * 快照里的曲库版本号变了(或上次没读到而现在 Host 有曲库了)就丢掉缓存,并通知界面重新读取。
 * 还没读过曲库时什么都不做:首次读取时自然拿到最新的。
 */
export const noteHostLocalLibraryRevision = (revision: string | undefined) => {
    if (!revision) return;
    const known = cache?.revision;
    if (known === revision) return;
    if (!cache && !lastFetchFailed) return;
    cache = null;
    lastFetchFailed = false;
    window.dispatchEvent(new Event(HOST_LOCAL_LIBRARY_CHANGED_EVENT));
};
