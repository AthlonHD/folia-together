import { describe, expect, it } from 'vitest';
import { planQualitySwitch, QUALITY_SWITCH_DEBOUNCE_MS } from '../../../src/components/app/playback/quality/qualitySwitch';

// test/unit/playback/qualitySwitch.test.ts
// Changing the audio quality while a song plays: what the player asks for.

describe('planQualitySwitch', () => {
    it('asks for the same song again, from where it is, playing as it was playing', () => {
        expect(planQualitySwitch({ previous: 'standard', next: 'lossless', element: { paused: false, currentTime: 73.4 } }))
            .toEqual({ force: true, autoplay: true, resumeAt: 73.4 });
    });

    it('keeps a paused song paused', () => {
        expect(planQualitySwitch({ previous: 'high', next: 'standard', element: { paused: true, currentTime: 12 } })?.autoplay).toBe(false);
    });

    it('does nothing when the level did not change or there is no audio element', () => {
        expect(planQualitySwitch({ previous: 'high', next: 'high', element: { paused: false, currentTime: 5 } })).toBeNull();
        expect(planQualitySwitch({ previous: 'high', next: 'lossless', element: null })).toBeNull();
    });

    it('survives a clock that is not a number or below zero', () => {
        expect(planQualitySwitch({ previous: 'a', next: 'b', element: { paused: false, currentTime: Number.NaN } })?.resumeAt).toBe(0);
        expect(planQualitySwitch({ previous: 'a', next: 'b', element: { paused: false, currentTime: -3 } })?.resumeAt).toBe(0);
    });

    it('waits for a burst of changes to settle', () => {
        expect(QUALITY_SWITCH_DEBOUNCE_MS).toBeGreaterThan(0);
    });
});
