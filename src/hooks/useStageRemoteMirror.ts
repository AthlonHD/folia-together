import { useEffect, useRef } from 'react';
import { PlayerState, type LyricData, type SongResult } from '../types';
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
import { fetchRemoteQueue, fetchRemoteStatus, remoteClock } from '../services/stageRemote';

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

        const loadTrack = async (id: string, coverUrl: string | null) => {
            const song = await omni.getSongDetail('netease', Number(id)) as SongResult | null;
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

                const nextId = status.current?.id ? String(status.current.id) : '';
                if (nextId !== currentId) {
                    currentId = nextId;
                    if (nextId) {
                        void loadTrack(nextId, status.current.coverUrl ?? null);
                    } else {
                        setCurrentSong(null);
                        latest.current.setLyrics(null);
                    }
                }

                setPlayerState(status.playerState as PlayerState);
                setDuration((status.durationMs ?? 0) / 1000);
                setIsFmMode(false);
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
                    setPlayQueue(items.map((item) => ({
                        id: Number(item.id),
                        name: item.title,
                        artists: (item.artist ? String(item.artist).split(' / ') : []).map((name: string, index: number) => ({ id: index, name })),
                        album: { id: 0, name: item.album ?? '', picUrl: item.coverUrl ?? undefined },
                        durationMs: item.durationMs ?? 0,
                    }) as unknown as SongResult));
                }
            } catch (error) {
                console.warn('[StageRemote] Failed to poll relay', error);
            }
        };

        void poll();
        const pollId = window.setInterval(() => { if (!document.hidden) void poll(); }, POLL_INTERVAL_MS);

        return () => {
            disposed = true;
            window.clearInterval(pollId);
        };
    }, [enabled]);
}
