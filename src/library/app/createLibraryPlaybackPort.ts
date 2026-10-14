import { isStageRemoteMode, remoteSetHeartbeatContext } from '../../services/stageRemote';
import type { LibraryCollectionDescriptor } from '../core/contracts/collection';
import { usePlayQueueContextStore } from '../../stores/usePlayQueueContextStore';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import type { SongResult, UnifiedSong } from '../../types';
import type { LibraryPlaybackPort } from '../core/contracts/ports';
import { resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';

// src/library/app/createLibraryPlaybackPort.ts
// 把首页 surface 上的播放回调装配成 Library Core 的播放端口。核心层只说「播这首、以这些为队列」，
// 队列怎么建、本地与 Navidrome 走哪条入队路径，仍由应用现有的播放控制器决定。

type PlaybackSurface = Pick<
    HomeSurfaceProps,
    | 'onPlaySong'
    | 'onPlayAll'
    | 'onAddAllToQueue'
    | 'onAddSongToQueue'
    | 'onAddLocalSongToQueue'
    | 'onAddNavidromeSongsToQueue'
    | 'onTogglePlayback'
    | 'localSongs'
>;

// 这个集合是不是网易云账号自己的「我喜欢的音乐」:从它放出来的队列才能用心动模式。
// 优先看 provider 标好的 isLiked;缓存里旧的歌单条目可能没有这个标记,再看网易云原始歌单的 specialType(5 = 我喜欢的音乐)。
const isNeteaseLikedPlaylist = (collection: LibraryCollectionDescriptor | null | undefined): boolean => {
    if (!collection || collection.source !== 'online' || collection.providerId !== 'netease') return false;
    if (collection.type !== 'playlist') return false;
    if (collection.isLiked === true) return true;
    const raw = collection.raw as { specialType?: unknown; isLiked?: unknown } | undefined;
    return raw?.isLiked === true || Number(raw?.specialType) === 5;
};

// 从集合里播放前记下播放上下文:放的是「我喜欢的音乐」就记下歌单与这批歌,否则清掉(先于播放,新队列才算在上下文里)。
const noteQueueContext = (collection: LibraryCollectionDescriptor | null | undefined, queue: readonly SongResult[]) => {
    const contextStore = usePlayQueueContextStore.getState();
    const liked = collection && isNeteaseLikedPlaylist(collection) ? collection : null;
    const songKeys = liked ? queue.map(getPlaybackSongKey) : [];
    if (liked) contextStore.setLikedContext(liked.id, songKeys);
    else contextStore.clearLikedContext();
    // 遥控页自己不放歌:歌由 Host 放,上下文也要交给 Host,它才知道当前歌是不是「我喜欢的音乐」里的。
    if (isStageRemoteMode()) {
        void remoteSetHeartbeatContext(liked ? liked.id : null, songKeys).catch(() => undefined);
    }
};

export const createLibraryPlaybackPort = (
    surface: PlaybackSurface,
    collection?: LibraryCollectionDescriptor | null,
): LibraryPlaybackPort => ({
    playTrack: (track, queue) => {
        noteQueueContext(collection, queue);
        surface.onPlaySong(track, queue);
    },
    playAll: tracks => {
        noteQueueContext(collection, tracks);
        surface.onPlayAll?.(tracks);
    },
    // 单曲入队按来源分流：本地歌交给本地队列，Navidrome 歌交出它的播放载体，其余走在线入队。
    enqueueTrack: (track: SongResult) => {
        const unifiedTrack = track as UnifiedSong;
        const localSongId = unifiedTrack.localRef?.songId;
        const localSong = localSongId ? surface.localSongs.find(song => song.id === localSongId) : undefined;
        if (unifiedTrack.isLocal && localSong) {
            surface.onAddLocalSongToQueue?.(localSong);
            return;
        }
        if (unifiedTrack.isNavidrome) {
            const naviSong = resolveNavidromePlaybackCarrier(unifiedTrack);
            if (naviSong) {
                surface.onAddNavidromeSongsToQueue?.([naviSong]);
                return;
            }
        }
        surface.onAddSongToQueue?.(track);
    },
    // 选项与返回的条数原样转交：歌手页的「加入热门歌曲」靠它们静默队列提示、报出队列实际收下的数量。
    enqueueAll: (tracks, options) => surface.onAddAllToQueue?.(tracks, options),
    // fb3：宿主的播放开关原样转交（「留在原处」时网格卡片上正在播放的那首的播放键用它）。
    togglePlayback: surface.onTogglePlayback,
});
