import { describe, expect, it } from 'vitest';
import { createPlayerStateReconciler, type AudioSample } from '@/utils/playerStateReconciler';
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
