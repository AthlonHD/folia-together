import { beforeEach, describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { getLoopDisplayMode, nextLoopDisplayMode } from '@/utils/loopDisplayMode';
import { insertHeartbeatSong, pickHeartbeatSong } from '@/utils/heartbeatAdvance';
import { getHeartbeatAvailable } from '@/utils/heartbeatAvailability';
import { usePlayQueueContextStore } from '@/stores/usePlayQueueContextStore';
import { usePlaybackStore, setCurrentSong, setPlayQueue } from '@/stores/usePlaybackStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { shouldDropLikedContext } from '@/hooks/useHeartbeatContextGuard';
import { registerHeartbeatAvailabilityResolver } from '@/stores/useAudioSettingsStore';

// 心动模式(网易云):只在播放「我喜欢的音乐」时进入循环按钮的切换,图标与排队规则见 utils/heartbeat*。

const song = (id: number): SongResult => ({ id, name: `song-${id}`, artists: [], album: { id: 0, name: '' }, duration: 1000 } as unknown as SongResult);

describe('loop display modes', () => {
    it('cycles off → all → one → shuffle → off when heartbeat is unavailable', () => {
        const order = ['off', 'all', 'one', 'shuffle'] as const;
        let mode: ReturnType<typeof nextLoopDisplayMode> = 'off';
        const seen: string[] = [mode];
        for (let i = 0; i < 4; i += 1) { mode = nextLoopDisplayMode(mode, false); seen.push(mode); }
        expect(seen).toEqual([...order, 'off']);
    });

    it('adds heartbeat after shuffle only when it is available, and leaves it for off', () => {
        expect(nextLoopDisplayMode('shuffle', true)).toBe('heartbeat');
        expect(nextLoopDisplayMode('heartbeat', true)).toBe('off');
        // 脱离「我喜欢的音乐」后还停在心动:再点一次回到关闭,不会卡住
        expect(nextLoopDisplayMode('heartbeat', false)).toBe('off');
    });

    it('derives the display mode from loop mode and the two switches', () => {
        expect(getLoopDisplayMode('all', false, true)).toBe('heartbeat');
        expect(getLoopDisplayMode('all', true, false)).toBe('shuffle');
        expect(getLoopDisplayMode('one', false)).toBe('one');
    });
});

describe('heartbeat song picking', () => {
    it('takes the first recommendation that is not already queued', () => {
        const queue = [song(1), song(2)];
        expect(pickHeartbeatSong([song(2), song(3), song(4)], queue)?.id).toBe(3);
        expect(pickHeartbeatSong([song(1), song(2)], queue)).toBeNull();
        expect(pickHeartbeatSong([], queue)).toBeNull();
    });

    it('inserts right after the current song and records it in the liked context', () => {
        usePlayQueueContextStore.getState().setLikedContext(7, [getPlaybackSongKey(song(1)), getPlaybackSongKey(song(2))]);
        const next = insertHeartbeatSong([song(1), song(2)], getPlaybackSongKey(song(1)), song(9));
        expect(next.map(item => item.id)).toEqual([1, 9, 2]);
        expect(usePlayQueueContextStore.getState().likedContext?.songKeys.has(getPlaybackSongKey(song(9)))).toBe(true);
        // 当前歌不在队列里:放队尾
        expect(insertHeartbeatSong([song(1)], 'missing', song(5)).map(item => item.id)).toEqual([1, 5]);
    });
});

describe('heartbeat availability follows the liked-playlist context', () => {
    beforeEach(() => {
        registerHeartbeatAvailabilityResolver(getHeartbeatAvailable);
        usePlayQueueContextStore.getState().clearLikedContext();
        setPlayQueue([]);
        setCurrentSong(null);
        useAudioSettingsStore.getState().setLoopDisplayMode('off', { persist: false });
    });

    it('is only available for songs from the liked playlist the queue was started from', () => {
        const liked = [song(1), song(2)];
        usePlayQueueContextStore.getState().setLikedContext(7, liked.map(getPlaybackSongKey));
        setPlayQueue(liked);
        setCurrentSong(liked[0]);
        expect(getHeartbeatAvailable()).toBe(true);

        setCurrentSong(song(99));
        expect(getHeartbeatAvailable()).toBe(false);
    });

    it('is not available without a context, and drops the context when other songs join the queue', () => {
        setCurrentSong(song(1));
        expect(getHeartbeatAvailable()).toBe(false);

        const liked = [song(1), song(2)];
        usePlayQueueContextStore.getState().setLikedContext(7, liked.map(getPlaybackSongKey));
        setPlayQueue(liked);
        setCurrentSong(song(1));
        expect(getHeartbeatAvailable()).toBe(true);

        // 队列里混进别处的歌:守卫(useHeartbeatContextGuard)据此丢掉上下文
        const context = usePlayQueueContextStore.getState().likedContext;
        expect(shouldDropLikedContext(context, liked)).toBe(false);
        expect(shouldDropLikedContext(context, [...liked, song(50)])).toBe(true);
        expect(shouldDropLikedContext(null, [song(50)])).toBe(false);
    });

    it('lets the loop button reach heartbeat only while available', () => {
        const liked = [song(1)];
        usePlayQueueContextStore.getState().setLikedContext(7, liked.map(getPlaybackSongKey));
        setPlayQueue(liked);
        setCurrentSong(liked[0]);
        const store = useAudioSettingsStore;
        store.getState().setLoopDisplayMode('shuffle', { persist: false });
        store.getState().handleToggleLoopMode();
        expect(store.getState().heartbeatEnabled).toBe(true);
        expect(store.getState().loopMode).toBe('all');
        store.getState().handleToggleLoopMode();
        expect(store.getState().heartbeatEnabled).toBe(false);
        expect(store.getState().loopMode).toBe('off');

        usePlayQueueContextStore.getState().clearLikedContext();
        store.getState().setLoopDisplayMode('shuffle', { persist: false });
        store.getState().handleToggleLoopMode();
        expect(store.getState().heartbeatEnabled).toBe(false);
        expect(store.getState().loopMode).toBe('off');
        expect(usePlaybackStore.getState().currentSong).not.toBeNull();
    });
});
