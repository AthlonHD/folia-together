import { describe, expect, it } from 'vitest';
import { measureDjSections } from '@/services/automix/djMixAnalysis';
import { createDjCueLookup, planDjMix } from '@/services/automix/djMixPlanner';
import { DEFAULT_TRANSITION_SETTINGS, planForMode, isTransitionMode, modeNeedsBeatGrid } from '@/services/automix/transitionStrategy';
import { makeProfile } from './trackProfileFixture';
import { djPhaseError, djPhaseShift, djPrerollEntry, overlappingVocals, sungRanges, vocalWindows } from '@/services/automix/djMixTiming';

// Synthetic structural evidence: the DJ planner must select actual interior section boundaries.
const from = {
    duration: 200, lines: null,
    profile: makeProfile({ djSections: [
        { start: 0, end: 40, levelDb: -22 },
        { start: 40, end: 120, levelDb: -12 },
        { start: 120, end: 200, levelDb: -20 },
    ] }),
};
const to = {
    duration: 200, lines: null,
    profile: makeProfile({ djSections: [
        { start: 0, end: 40, levelDb: -21 },
        { start: 40, end: 90, levelDb: -12 },
        { start: 90, end: 200, levelDb: -20 },
    ] }),
};

describe('DJ Mix', () => {
    it('measures section energy in the power domain', () => {
        const sections = measureDjSections([-20, -10, -10, -10], 1, [2], 4);
        expect(sections[0].levelDb).toBeCloseTo(10 * Math.log10(0.055));
        expect(sections[1]).toEqual({ start: 2, end: 4, levelDb: -10 });
    });

    it('rides an eight-bar phrase out of a strong section into the next groove', () => {
        const plan = planDjMix(from, to, 60);
        expect(plan).toMatchObject({ djCue: true, style: 'bassSwap', outStart: 140, inStart: 33, overlap: 16, stretch: 1 });
        expect(planDjMix(from, to, 103)).toEqual(plan);
        expect(planDjMix(from, to, 105)?.outStart).toBeGreaterThan(105);
    });

    it('locks the incoming beat to the outgoing beat when the tempos differ slightly', () => {
        const bent = {
            ...to,
            profile: makeProfile({
                bpm: 126,
                outroBpm: 126,
                beatOffset: 0.1,
                djSections: to.profile?.djSections,
            }),
        };
        const plan = planDjMix({ ...from, profile: makeProfile({ ...from.profile, beatOffset: 0.05 }) }, bent, 60);
        expect(plan).toMatchObject({ djCue: true, style: 'bassSwap' });
        expect(djPhaseError(
            plan!.outStart, plan!.inStart, 0.05, 0.1, 120, 126, plan!.stretch,
        )).toBeLessThan(0.02);
        expect(Math.abs(djPhaseShift(112, 40.25, 0, 0, 120, 120, 1))).toBeCloseTo(0.25);
    });

    it('still mixes with partial analysis, missing profiles, unstable tempos or a missed cue', () => {
        const partial = { ...to, profile: makeProfile({ partial: true }) };
        const djSettings = { ...DEFAULT_TRANSITION_SETTINGS, mode: 'djMix' as const };
        expect(planDjMix(from, partial, 60)).toMatchObject({ djCue: true, inStart: 40, style: 'plainBlend' });
        expect(planForMode(djSettings, from, partial, 120, 180)).toMatchObject({ djCue: true });
        expect(planDjMix(from, to, 121)).toMatchObject({ djCue: true });
        expect(planDjMix(from, { ...to, duration: 30 }, 60)).toMatchObject({ djCue: true, inStart: 6 });
        expect(planDjMix(from, { ...to, duration: 195 }, 60)).toMatchObject({ djCue: true, style: 'bassSwap', overlap: 16 });
        expect(planDjMix({ ...from, profile: { ...from.profile, outroBpm: 100 } }, to, 60)).toMatchObject({ djCue: true, stretch: 1 });
        expect(planDjMix(from, { ...to, profile: { ...to.profile, bpm: 158, outroBpm: 158 } }, 60)).toMatchObject({ djCue: true, style: 'plainBlend', stretch: 1 });
        expect(planDjMix({ ...from, profile: null }, { ...to, profile: null }, 26)).toMatchObject({ djCue: true, outStart: 144, inStart: 40, overlap: 12 });
        const brief = planDjMix({ duration: 20, lines: null }, { duration: 20, lines: null }, 0);
        expect(brief).toMatchObject({ djCue: true, inStart: 4 });
        expect(brief!.outStart).toBeCloseTo(12, 4);
        expect(brief!.overlap).toBeGreaterThan(3);
        expect(planDjMix(from, to, 200)).toBeNull();
        expect(isTransitionMode('djMix')).toBe(true);
        expect(modeNeedsBeatGrid('djMix')).toBe(true);
    });

    it('leaves a released section and keeps a longer handoff when the tempos will not lock', () => {
        const outgoing = {
            ...from,
            profile: makeProfile({
                djSections: [
                    { start: 40, end: 110, levelDb: -10 },
                    { start: 110, end: 160, levelDb: -18 },
                    { start: 160, end: 200, levelDb: -24 },
                ],
            }),
        };
        const incoming = {
            ...to,
            profile: makeProfile({
                bpm: 132,
                outroBpm: 132,
                djSections: to.profile?.djSections,
            }),
        };
        const plan = planDjMix(outgoing, incoming, 60);
        expect(plan).toMatchObject({ djCue: true, style: 'plainBlend', stretch: 1, overlap: 12 });
        expect(plan!.outStart).toBeGreaterThan(110);
        expect(plan!.outStart).toBeLessThan(160);
        expect(plan!.inStart).toBeLessThan(56);
    });

    it('swaps two fast tracks on a loud phrase instead of washing both drum patterns', () => {
        const outgoing = {
            ...from,
            profile: makeProfile({
                bpm: 150,
                outroBpm: 150,
                djSections: [
                    { start: 40, end: 120, levelDb: -8 },
                    { start: 120, end: 170, levelDb: -18 },
                ],
            }),
        };
        const incoming = {
            ...to,
            profile: makeProfile({
                bpm: 162,
                outroBpm: 162,
                djSections: to.profile?.djSections,
            }),
        };
        const plan = planDjMix(outgoing, incoming, 60);
        expect(plan).toMatchObject({ djCue: true, style: 'bassSwap', stretch: 1 });
        expect(plan!.overlap).toBeGreaterThan(5);
        expect(plan!.overlap).toBeLessThan(8);
        expect(plan!.outStart).toBeGreaterThan(140);
        expect(plan!.outStart).toBeLessThan(180);
    });

    it('uses lyric timing to avoid stacking the two vocal phrases', () => {
        const a = { ...from, lines: [{ startTime: 108, endTime: 120, fullText: 'outgoing vocal', words: [] }] };
        const b = { ...to, lines: [{ startTime: 40, endTime: 48, fullText: 'incoming vocal', words: [] }] };
        const plan = planDjMix(a, b, 60)!;
        expect(plan.djCue).toBe(true);
        expect(overlappingVocals(vocalWindows(sungRanges(a.lines), plan.outStart, plan.overlap), vocalWindows(sungRanges(b.lines), plan.inStart, plan.overlap))).toBeLessThan(1);
    });

    it('compensates hidden pre-roll and measures half-beat mismatches', () => {
        expect(djPrerollEntry(40, 112, 111.75, 1)).toBe(39.75);
        expect(djPrerollEntry(40, 112, 112.25, 1)).toBe(40.25);
        expect(djPhaseError(112, 40, 0, 0, 120, 120, 1)).toBeCloseTo(0);
        expect(djPhaseError(112, 40.25, 0, 0, 120, 120, 1)).toBeCloseTo(0.5);
    });

    it('caches a cue until it is passed, or the listener seeks backwards', () => {
        const lookup = createDjCueLookup();
        const plan = lookup(from, to, 50);
        expect(lookup(from, to, 100)).toBe(plan);
        expect(lookup(from, to, 121)?.outStart).toBeGreaterThan(121);
        expect(lookup(from, to, 50)).toEqual(plan);
        expect(lookup(from, { ...to, profile: null }, 60)).toMatchObject({ djCue: true, inStart: 40 });
    });
});
