import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { setPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { PlayerState } from '../types';
import {
    createAutoplayWatchdog,
    createPlayerStateReconciler,
    RECONCILE_INTERVAL_MS,
} from '../utils/playerStateReconciler';

// src/hooks/usePlayerStateReconciler.ts
// 本机出声的页面(本机模式、Host)上,把界面的播放状态和真实的 <audio> 对齐,并兜住"该自动播放却没播"的情况,
// 见 playerStateReconciler。遥控模式没有本地音频,不启用。

type ReconcilerOptions = {
    shouldAutoPlayRef: MutableRefObject<boolean>;
    /** 用户在自动混音换歌途中按了暂停,新歌不该再自己开始播。 */
    suppressAutoplayRef: MutableRefObject<boolean>;
    /** 自动混音正在等待换歌时机,新歌是故意晚一点才开始的。 */
    isAutoplayHeld: boolean;
};

export function usePlayerStateReconciler(
    audioRef: RefObject<HTMLAudioElement | null>,
    enabled: boolean,
    { shouldAutoPlayRef, suppressAutoplayRef, isAutoplayHeld }: ReconcilerOptions,
) {
    const heldRef = useRef(isAutoplayHeld);
    heldRef.current = isAutoplayHeld;

    useEffect(() => {
        if (!enabled) return;
        const reconciler = createPlayerStateReconciler();
        const watchdog = createAutoplayWatchdog();
        const timer = window.setInterval(() => {
            const { audioSrc, playerState } = usePlaybackStore.getState();
            const audio = audioRef.current;

            if (reconciler.sample(audio, audioSrc, playerState)) {
                setPlayerState(PlayerState.PLAYING);
            }

            const shouldStart = watchdog.sample({
                audio,
                srcMatches: Boolean(audio && audioSrc && audio.getAttribute('src') === audioSrc),
                intentPending: shouldAutoPlayRef.current && !suppressAutoplayRef.current && !heldRef.current,
                source: audioSrc,
                now: Date.now(),
            });
            if (shouldStart && audio) {
                shouldAutoPlayRef.current = false;
                audio.play()
                    .then(() => setPlayerState(PlayerState.PLAYING))
                    .catch((error: DOMException) => {
                        // 播放被后续的换源打断时,把意图放回去,等新的源再试
                        if (error?.name === 'AbortError') shouldAutoPlayRef.current = true;
                    });
            }
        }, RECONCILE_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [audioRef, enabled, shouldAutoPlayRef, suppressAutoplayRef]);
}
