import { usePlayQueueContextStore } from '../stores/usePlayQueueContextStore';
import { useEffect, useRef } from 'react';
import { PlayerState, type LocalSong, type LyricData, type SongResult } from '../types';
import { buildUnifiedLocalSong, getLocalSongId } from '../services/playbackAdapters';
import { getPreferredLocalSongCoverUrl } from '../services/localCoverAssetUrl';
import { noteHostLocalLibraryRevision, readHostLocalLibrary, type HostLocalLibrary } from '../services/hostLocalLibraryClient';
import { omni } from '../services/onlineMusic/omni';
import { loadOnlineSongLyrics } from '../services/onlinePlayback';
import {
    setActivePlaybackContext,
    setCachedCoverUrl,
    setCurrentLineIndex,
    setCurrentSong,
    setDuration,
    setIsFmMode,
    setPlayQueue,
    setPlayerState,
} from '../stores/usePlaybackStore';
import type { OmniProviderId } from '../types/onlineMusic';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { fetchRemoteQueue, fetchRemoteStatus, remoteClock, remoteSetSettings } from '../services/stageRemote';
import { getStageAuthHeaders } from '../services/stageMode';
import { applyMirroredHostSettings, startHostSettingsUplink } from '../services/hostSettingsSync';

// src/hooks/useStageRemoteMirror.ts

const POLL_INTERVAL_MS = 1000;

type UseStageRemoteMirrorParams = {
    enabled: boolean;
    userId: string | number | null | undefined;
    setLyrics: (lyrics: LyricData | null) => void;
    setIsLyricsLoading: (loading: boolean) => void;
    restoreCachedThemeForSong: (song: SongResult) => Promise<unknown>;
};

// 把服务器 Host 页的播放状态镜像进本页的播放 store,歌词与主题仍在本地按歌曲 ID 获取。
export function useStageRemoteMirror({
    enabled,
    userId,
    setLyrics,
    setIsLyricsLoading,
    restoreCachedThemeForSong,
}: UseStageRemoteMirrorParams) {
    // 回调可能随渲染变化,轮询循环只读最新值
    const latest = useRef({ userId, setLyrics, setIsLyricsLoading, restoreCachedThemeForSong });
    latest.current = { userId, setLyrics, setIsLyricsLoading, restoreCachedThemeForSong };

    useEffect(() => {
        if (!enabled) return;

        let disposed = false;
        let currentId = '';
        let queueRevision: string | undefined;
        // Host 本地曲库里的歌:快照里的 id 是字符串 id 的哈希,按同一个算法建索引才能认回去
        let localSongIndex: { library: HostLocalLibrary; byId: Map<string, LocalSong> } | null = null;
        const findHostLocalSong = async (snapshotId: string): Promise<LocalSong | null> => {
            const library = await readHostLocalLibrary();
            if (localSongIndex?.library !== library) {
                localSongIndex = {
                    library,
                    byId: new Map(library.songs.map(song => [String(getLocalSongId(song)), song])),
                };
            }
            return localSongIndex.byId.get(snapshotId) ?? null;
        };
        const buildLocalSongForRemote = (localSong: LocalSong): SongResult => buildUnifiedLocalSong({
            localSong,
            matchedSong: null,
            coverUrl: getPreferredLocalSongCoverUrl(localSong),
            preferOnlineMetadata: false,
        });

        // Host 正在播的是它本地曲库里的歌:歌曲信息来自共享的曲库,歌词由 Host 解析后经中继取
        const loadLocalTrack = async (key: string, snapshotId: string, fallbackCoverUrl: string | null) => {
            const localSong = await findHostLocalSong(snapshotId);
            if (disposed || currentId !== key || !localSong) return;

            latest.current.setLyrics(null);
            setCurrentLineIndex(-1);
            setCurrentSong(buildLocalSongForRemote(localSong));
            setCachedCoverUrl(getPreferredLocalSongCoverUrl(localSong) ?? fallbackCoverUrl);
            latest.current.setIsLyricsLoading(true);
            try {
                const response = await fetch(`/stage/local/lyrics/${encodeURIComponent(localSong.id)}`, { headers: getStageAuthHeaders() });
                const data = response.ok ? await response.json() : null;
                if (!disposed && currentId === key) latest.current.setLyrics((data?.lyrics ?? null) as LyricData | null);
            } catch (error) {
                console.warn('[StageRemote] Local lyric fetch failed', error);
            } finally {
                if (!disposed && currentId === key) latest.current.setIsLyricsLoading(false);
            }
        };

        // 网易云歌曲用数字 id 取详情;QQ 音乐等其他在线音源用 Host 给的 { 音源, mediaId }
        const loadTrack = async (id: string, coverUrl: string | null, source: string, mediaId?: string) => {
            const song = (source === 'netease' || !mediaId
                ? await omni.getSongDetail('netease', Number(id.slice(id.indexOf(':') + 1)))
                : await omni.getSongDetail(source as OmniProviderId, mediaId)) as SongResult | null;
            if (disposed || currentId !== id || !song) return;
            const isCurrent = () => !disposed && currentId === id;

            latest.current.setLyrics(null);
            setCurrentLineIndex(-1);
            setCurrentSong(song);
            setCachedCoverUrl(coverUrl);
            latest.current.setIsLyricsLoading(true);
            try {
                await loadOnlineSongLyrics(song, null, latest.current.userId, {
                    isCurrent,
                    onLyrics: (lyrics) => { if (isCurrent()) latest.current.setLyrics(lyrics); },
                    onPureMusicChange: (isPureMusic) => {
                        setCurrentSong((prev) => (prev && isCurrent() ? { ...prev, isPureMusic } : prev));
                    },
                    onStateChange: (state) => {
                        setCurrentSong((prev) => (prev && isCurrent() ? { ...prev, onlineLyricsState: state ?? undefined } : prev));
                    },
                    onDone: () => { if (isCurrent()) latest.current.setIsLyricsLoading(false); },
                });
            } catch (error) {
                console.warn('[StageRemote] Lyric fetch failed', error);
                latest.current.setIsLyricsLoading(false);
            }
            try {
                await latest.current.restoreCachedThemeForSong(song);
            } catch (error) {
                console.warn('[StageRemote] Theme load failed', error);
            }
        };

        const poll = async () => {
            try {
                const status = await fetchRemoteStatus();
                if (disposed) return;

                // 同一个数字 id 在网易云和本地曲库里可能撞车,用来源加 id 作为曲目的标识
                const nextId = status.current?.id ? `${status.current.source ?? 'netease'}:${status.current.id}` : '';
                if (nextId !== currentId) {
                    currentId = nextId;
                    if (nextId) {
                        if (status.current.source === 'local') {
                            void loadLocalTrack(nextId, String(status.current.id), status.current.coverUrl ?? null);
                        } else {
                            void loadTrack(nextId, status.current.coverUrl ?? null, status.current.source ?? 'netease', status.current.mediaId);
                        }
                    } else {
                        setCurrentSong(null);
                        latest.current.setLyrics(null);
                    }
                }

                if (status.loopMode) {
                    useAudioSettingsStore.getState().setLoopDisplayMode(status.loopMode, { persist: false });
                }
                usePlayQueueContextStore.getState().setRemoteAvailable(status.heartbeatAvailable === true);
                if (status.settings) {
                    applyMirroredHostSettings(status.settings);
                }
                // Host 的本地曲库变了就丢掉缓存并通知界面重新读取
                noteHostLocalLibraryRevision(status.localLibraryRevision);
                setPlayerState(status.playerState as PlayerState);
                setDuration((status.durationMs ?? 0) / 1000);
                setIsFmMode(status.isFmMode === true);
                setActivePlaybackContext('main');
                remoteClock.positionMs = status.positionMs ?? 0;
                remoteClock.receivedAt = Date.now();
                remoteClock.playing = status.playerState === PlayerState.PLAYING;
                remoteClock.durationMs = status.durationMs ?? 0;

                if (status.queue?.revision !== queueRevision) {
                    queueRevision = status.queue?.revision;
                    const queue = await fetchRemoteQueue();
                    if (disposed) return;
                    const items: any[] = queue.queue?.items ?? [];
                    const queueSongs: SongResult[] = [];
                    for (const item of items) {
                        // 本地曲库里的歌用共享曲库里的完整信息(封面、本地引用),点队列项才能正确跳转
                        const localSong = item.source === 'local' ? await findHostLocalSong(String(item.id)) : null;
                        const isOtherOnline = !localSong && item.mediaId && item.source && item.source !== 'netease';
                        queueSongs.push(localSong ? buildLocalSongForRemote(localSong) : ({
                            // 酷狗等音源的 id 可能不是数字(哈希),此时原样保留,身份以下面的来源引用为准
                            id: Number.isFinite(Number(item.id)) ? Number(item.id) : item.id,
                            // 其他在线音源的队列项带上来源引用,队列去重、跳转才不会和网易云的 id 撞车
                            ...(isOtherOnline ? {
                                providerId: item.source,
                                sourceRef: { kind: 'online', providerId: item.source, mediaId: String(item.mediaId) },
                            } : {}),
                            name: item.title,
                            artists: (item.artist ? String(item.artist).split(' / ') : []).map((name: string, index: number) => ({ id: index, name })),
                            album: { id: 0, name: item.album ?? '', picUrl: item.coverUrl ?? undefined },
                            durationMs: item.durationMs ?? 0,
                        }) as unknown as SongResult);
                    }
                    if (disposed) return;
                    setPlayQueue(queueSongs);
                }
            } catch (error) {
                console.warn('[StageRemote] Failed to poll relay', error);
            }
        };

        // 用户在本页改的播放设置(音质、音量、均衡器等)转发给 Host,由 Host 应用并回报
        const stopUplink = startHostSettingsUplink(remoteSetSettings);

        void poll();
        const pollId = window.setInterval(() => { if (!document.hidden) void poll(); }, POLL_INTERVAL_MS);

        return () => {
            disposed = true;
            stopUplink();
            window.clearInterval(pollId);
        };
    }, [enabled]);
}
