import { describe, expect, it } from 'vitest';
import {
    AUTOPLAY_WATCHDOG_AFTER_MS,
    createAutoplayWatchdog,
    createPlayerStateReconciler,
    type AudioSample,
} from '@/utils/playerStateReconciler';
import { PlayerState } from '@/types';

// 界面状态和真实 <audio> 脱节时的最后一道校正。

const playing = (currentTime: number): AudioSample => ({ paused: false, ended: false, readyState: 4, currentTime });
const stopped = (currentTime = 0): AudioSample => ({ paused: true, ended: false, readyState: 4, currentTime });

const run = (samples: Array<[AudioSample | null, unknown, PlayerState]>) => {
    const reconciler = createPlayerStateReconciler();
    return samples.map(([audio, source, state]) => reconciler.sample(audio, source, state));
};

describe('player state reconciler', () => {
    it('corrects PAUSED to PLAYING once the element has really been advancing for a few samples', () => {
        const results = run([
            [playing(1.0), 'a', PlayerState.PAUSED],
            [playing(1.5), 'a', PlayerState.PAUSED],
            [playing(2.0), 'a', PlayerState.PAUSED],
            [playing(2.5), 'a', PlayerState.PAUSED],
        ]);
        expect(results).toEqual([false, false, false, true]);
    });

    it('does not trip on a short pause fade-out where the sound is still running', () => {
        const results = run([
            [playing(1.0), 'a', PlayerState.PLAYING],
            [playing(1.5), 'a', PlayerState.PAUSED],
            [stopped(1.7), 'a', PlayerState.PAUSED],
            [stopped(1.7), 'a', PlayerState.PAUSED],
            [stopped(1.7), 'a', PlayerState.PAUSED],
        ]);
        expect(results.every(result => result === false)).toBe(true);
    });

    it('leaves a PLAYING state alone even when nothing is advancing (buffering, blocked)', () => {
        const results = run([
            [stopped(), 'a', PlayerState.PLAYING],
            [stopped(), 'a', PlayerState.PLAYING],
            [stopped(), 'a', PlayerState.PLAYING],
            [stopped(), 'a', PlayerState.PLAYING],
        ]);
        expect(results.every(result => result === false)).toBe(true);
    });

    it('restarts the count when the source changes', () => {
        const results = run([
            [playing(1.0), 'a', PlayerState.PAUSED],
            [playing(1.5), 'a', PlayerState.PAUSED],
            [playing(0.5), 'b', PlayerState.PAUSED],
            [playing(1.0), 'b', PlayerState.PAUSED],
            [playing(1.5), 'b', PlayerState.PAUSED],
            [playing(2.0), 'b', PlayerState.PAUSED],
        ]);
        expect(results).toEqual([false, false, false, false, false, true]);
    });

    it('ignores a missing audio element, an ended element and a stalled clock', () => {
        const results = run([
            [null, 'a', PlayerState.PAUSED],
            [{ ...playing(3), ended: true }, 'a', PlayerState.PAUSED],
            [playing(3), 'a', PlayerState.PAUSED],
            [playing(3), 'a', PlayerState.PAUSED],
            [playing(3), 'a', PlayerState.PAUSED],
            [playing(3), 'a', PlayerState.PAUSED],
        ]);
        expect(results.every(result => result === false)).toBe(true);
    });
});

describe('autoplay watchdog', () => {
    const readyButIdle = { paused: true, ended: false, readyState: 4, currentTime: 0, error: null };
    const input = (now: number, overrides: Record<string, unknown> = {}) => ({
        audio: readyButIdle,
        srcMatches: true,
        intentPending: true,
        source: 'song-b',
        now,
        ...overrides,
    });

    it('starts playback when the autoplay intent stays unspent while the audio is ready', () => {
        const watchdog = createAutoplayWatchdog();
        expect(watchdog.sample(input(0))).toBe(false);
        expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS - 1))).toBe(false);
        expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS))).toBe(true);
        // 触发一次后重新计时,不会每个周期都去 play()
        expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS + 500))).toBe(false);
    });

    it('does nothing without a pending intent (a deliberate pause) or while held back', () => {
        const watchdog = createAutoplayWatchdog();
        for (const now of [0, 2000, 4000, 8000]) {
            expect(watchdog.sample(input(now, { intentPending: false }))).toBe(false);
        }
    });

    it('waits for the audio to be ready, error-free and on the expected source', () => {
        const watchdog = createAutoplayWatchdog();
        const cases = [
            { audio: { ...readyButIdle, readyState: 1 } },
            { audio: { ...readyButIdle, error: new Error('bad') } },
            { audio: { ...readyButIdle, paused: false } },
            { srcMatches: false },
            { audio: null },
        ];
        for (const overrides of cases) {
            expect(watchdog.sample(input(0, overrides))).toBe(false);
            expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS * 2, overrides))).toBe(false);
        }
    });

    it('restarts the timer when the source changes', () => {
        const watchdog = createAutoplayWatchdog();
        watchdog.sample(input(0, { source: 'song-a' }));
        expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS - 500, { source: 'song-b' }))).toBe(false);
        expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS + 100, { source: 'song-b' }))).toBe(false);
        expect(watchdog.sample(input(AUTOPLAY_WATCHDOG_AFTER_MS * 2 - 500, { source: 'song-b' }))).toBe(true);
    });
});
