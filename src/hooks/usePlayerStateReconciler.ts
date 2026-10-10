import { useEffect } from 'react';
import type { RefObject } from 'react';
import { setPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { PlayerState } from '../types';
import { createPlayerStateReconciler, RECONCILE_INTERVAL_MS } from '../utils/playerStateReconciler';

// src/hooks/usePlayerStateReconciler.ts
// 本机出声的页面(本机模式、Host)上,把界面的播放状态和真实的 <audio> 对齐,见 playerStateReconciler。
// 遥控模式没有本地音频,不启用。

export function usePlayerStateReconciler(audioRef: RefObject<HTMLAudioElement | null>, enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        const reconciler = createPlayerStateReconciler();
        const timer = window.setInterval(() => {
            const { audioSrc, playerState } = usePlaybackStore.getState();
            if (reconciler.sample(audioRef.current, audioSrc, playerState)) {
                setPlayerState(PlayerState.PLAYING);
            }
        }, RECONCILE_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [audioRef, enabled]);
}
