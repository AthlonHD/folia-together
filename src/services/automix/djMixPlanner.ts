import { alignEntry, barGrid, snapToGrid, tempoMatch, type TempoRelation } from './musicalTime';
import { AUTOMIX_MAX_OVERLAP_SEC, type TransitionPlan, type TransitionTrack } from './transitionPlanner';
import type { TrackProfile } from './trackProfile';
import { cutsVocal, djPhaseShift, overlappingVocals, sungRanges, vocalWindows } from './djMixTiming';
import { keyRelation } from './transitionChooser';

// Plans an interior DJ mix: a phrase of both tracks, beats locked, the next groove already
// underway when the bass changes hands. Not a fade placed on two loud section edges.
const usableProfile = (track: TransitionTrack): TrackProfile | null => {
    const profile = track.profile;
    // Same slack the playback check uses. A few seconds of metadata drift is not a different edit,
    // and dropping the profile here is what turns that drift into an unbeatmatched fade.
    const drift = profile ? Math.abs(profile.duration - track.duration) : Infinity;
    const limit = Math.max(15, track.duration * 0.08);
    return profile && !profile.partial && drift <= limit ? profile : null;
};

const sectionsOf = (profile: TrackProfile | null) => (profile?.djSections ?? [])
    .filter(section => section.end - section.start >= 4 && Number.isFinite(section.levelDb));

const bodyBpm = (profile: TrackProfile | null): number | null => (
    profile?.bpm && Number.isFinite(profile.bpm) && profile.bpm > 0 ? profile.bpm : null
);

/**
 * Where the blend should finish in the outgoing song. 0.65 left the chorus early; listeners
 * heard each track run short. 0.78 keeps most of the song and still leaves an outro to mix through.
 */
const EXIT_FRACTION = 0.78;
/** Do not leave in the first half just because a loud section ended there. */
const EARLIEST_EXIT_FRACTION = 0.62;

/** Phrase lengths when the beats can lock, otherwise a blend long enough to hear arrive. */
const candidateLengths = (relation: TempoRelation, bpm: number | null, clashing: boolean, driving: boolean): number[] => {
    // A semitone or tritone apart does not get a phrase to ring.
    if (clashing) return [8, 6];
    // Already the same tempo: a full eight-bar ride, with four and two bars as the shorter options.
    if (relation === 'locked' && bpm) return [32, 16, 8].map(beats => beats * 60 / bpm);
    // Close enough to share a grid for a phrase, not so close that sixteen seconds stays locked
    // without bending the song the listener is still hearing. Four bars, then two.
    if (relation === 'near' && bpm) return [16, 8].map(beats => beats * 60 / bpm);
    // Two fast, full tracks: swap on a phrase. A twelve-second wash leaves both drum patterns running.
    if (driving && relation !== 'far' && bpm) return [16, 8].map(beats => beats * 60 / bpm);
    if (driving) return [8, 6];
    // Whatever the tempos, the ear needs a long overlap: the next track fades in, the current one
    // fades out, and the two are audible together. A few seconds is heard as the song being sliced.
    return [12, 9];
};

/** Seconds from `at` to the next bar line, in wall-clock time after the outgoing stretch. */
const barPhaseAt = (at: number, profile: TrackProfile | null, bpm: number | null, rate: number): number | null => {
    const grid = bpm && profile ? barGrid(bpm, profile.downbeatOffset, profile.beatsPerBar) : null;
    if (!grid) return null;
    const fraction = (((at - grid.offset) / grid.period) % 1 + 1) % 1;
    return fraction === 0 ? 0 : (1 - fraction) * grid.period / Math.max(0.01, rate);
};

/** Selects interior cues for every pair with usable media timelines, using defaults without analysis. */
export function planDjMix(from: TransitionTrack, to: TransitionTrack, at: number): TransitionPlan | null {
    if (!Number.isFinite(from.duration) || from.duration <= 1 || !Number.isFinite(at) || at >= from.duration - 0.25) return null;
    const a = usableProfile(from);
    const b = usableProfile(to);
    // The mix sits in the body of the track, so the body tempo is the clock. The outro reading
    // belongs to an end-of-track blend and must not turn a locked pair into a two-second fade.
    const aBpm = bodyBpm(a);
    const bBpm = bodyBpm(b);
    const tempo = tempoMatch(aBpm, bBpm);
    // Never time-stretch the song that is still in front. A DJ pitches the record that is arriving;
    // doing it to the one the room is on, at the start of a long interior mix, is a tempo jump.
    const matched = tempo.relation === 'locked' || tempo.relation === 'near';
    // Both sides fast: a long crossfade puts two drum patterns in the room. Swap on a phrase instead.
    const driving = (aBpm ?? 0) >= 126 && (bBpm ?? 0) >= 126;
    const rideLoud = matched || (driving && tempo.relation !== 'far');
    // Interior cues have no endpoint-local key estimate; use the whole-track key as weak evidence.
    const relation = keyRelation(a && { ...a, outroKey: { key: a.key, major: a.major, confidence: a.keyConfidence } },
        b && { ...b, introKey: { key: b.key, major: b.major, confidence: b.keyConfidence } });
    const fromVocals = sungRanges(from.lines);
    const toVocals = sungRanges(to.lines);
    const toDuration = Number.isFinite(to.duration) && to.duration > 0 ? to.duration : 0;
    const maximum = Math.min(
        AUTOMIX_MAX_OVERLAP_SEC,
        Math.max(1.5, from.duration * 0.18),
        toDuration > 0 ? Math.max(1.5, toDuration * 0.22) : Infinity,
    );
    const musicalCue = (seconds: number, profile: TrackProfile | null, bpm: number | null) => {
        if (!bpm || !profile) return seconds;
        const beat = 60 / bpm;
        const bars = barGrid(bpm, profile.downbeatOffset, profile.beatsPerBar);
        const bar = snapToGrid(seconds, bars, beat);
        return bar !== seconds ? bar : snapToGrid(seconds, barGrid(bpm, profile.beatOffset, 1), beat);
    };
    const aSections = sectionsOf(a);
    const bSections = sectionsOf(b);
    const aPeak = Math.max(-100, ...aSections.map(section => section.levelDb));
    const bPeak = Math.max(-100, ...bSections.map(section => section.levelDb));
    const lengths = candidateLengths(tempo.relation, aBpm, relation === 'clashing', driving)
        .map(desired => Math.min(desired, maximum))
        .filter(overlap => overlap >= 0.8);
    const overlaps = lengths.length ? lengths : [Math.min(maximum, 1.5)];
    let best: { outStart: number; inStart: number; overlap: number; score: number; clash: boolean; evidence: string } | null = null;
    // Test several phrase lengths and score the pair, not two unrelated loud sections.
    for (const overlap of overlaps) {
        const rate = 1;
        const wall = overlap / rate;
        // The bass changes hands at the middle of the blend. Start the incoming track this far
        // before its section so that section arrives with the bass, not several seconds earlier
        // while both songs are already equally loud.
        const lead = rideLoud ? overlap * 0.45 : 0;
        // A beatmatched or two-banger ride leaves from the loud section. A slower pair leaves once
        // that section has let go: a chorus still at full level, or a hole the track already fell
        // into, both read as a cut when the blend is only a few seconds.
        const outgoingQuality = (levelDb: number) => {
            const under = aPeak - levelDb;
            if (rideLoud) return 5 + (levelDb - aPeak) * 0.4;
            if (under >= 3 && under <= 12) return 5 + under * 0.4;
            return under > 12 ? 3.5 : 4;
        };
        const outCap = rideLoud ? 0.94 : 0.97;
        const defaultOut = [EXIT_FRACTION, 0.86, 0.92].map(fraction => musicalCue(from.duration * fraction - overlap, a, aBpm))
            .find(cue => cue >= at - 0.25) ?? at;
        const levelAt = (time: number) => aSections.find(section => time >= section.start && time < section.end)?.levelDb;
        const outgoing = [
            ...aSections.map(section => ({ start: musicalCue(section.end - overlap, a, aBpm), quality: outgoingQuality(section.levelDb), source: 'section' })),
            ...fromVocals.map(range => ({ start: musicalCue(range.end - overlap, a, aBpm), quality: matched ? 2 : 1, source: 'lyric' })),
            { start: defaultOut, quality: 0, source: 'default' },
        ].filter(cue => cue.start >= at - 0.25 && (cue.source === 'default' || (cue.start >= from.duration * EARLIEST_EXIT_FRACTION && cue.start + overlap <= from.duration * outCap)) && cue.start + overlap <= from.duration)
            .map(cue => {
                const level = levelAt(cue.start + overlap);
                const hotExit = !rideLoud && cue.source !== 'section' && level !== undefined && aPeak - level < 3 ? 6 : 0;
                return { ...cue, score: cue.quality - 8 * Math.abs((cue.start + overlap) / from.duration - EXIT_FRACTION)
                    - (cutsVocal(fromVocals, cue.start + overlap) ? 12 : 0) - hotExit };
            })
            .sort((x, y) => y.score - x.score).slice(0, 12)
            .map(cue => ({ ...cue, singing: vocalWindows(fromVocals, cue.start, wall, rate) }));
        const incoming = [
            ...bSections.flatMap(section => {
                const atDrop = musicalCue(section.start, b, bBpm);
                const under = musicalCue(Math.max(0, section.start - lead), b, bBpm);
                const loud = 0.4 * (section.levelDb - bPeak);
                return [
                    { start: under, quality: 6 + loud, source: 'phrase' },
                    { start: atDrop, quality: 4 + loud, source: 'section' },
                ];
            }),
            ...toVocals.map(range => ({ start: musicalCue(Math.max(0, range.start - wall), b, bBpm), quality: matched ? 3 : 1, source: 'lyric' })),
            { start: musicalCue(Math.min(toDuration * 0.2, 45), b, bBpm), quality: 0, source: 'default' },
        ].filter(cue => cue.start >= toDuration * 0.05 && (toDuration === 0 || (cue.start <= toDuration * (rideLoud ? 0.45 : 0.28) && cue.start + wall <= toDuration)))
            .map(cue => {
                const depth = toDuration ? cue.start / toDuration : 0;
                // The downbeat a phrase opens on sits inside the first syllable. That is the entry,
                // not a cut through a line that was already going.
                const opensPhrase = cue.source === 'phrase' && toVocals.some(range => cue.start >= range.start - 0.05 && cue.start <= range.start + 0.8);
                return { ...cue, score: cue.quality - 5 * (toDuration ? Math.abs(depth - 0.2) : 0)
                    - (cutsVocal(toVocals, cue.start) && !opensPhrase ? 12 : 0) };
            })
            .sort((x, y) => y.score - x.score).slice(0, 12);
        for (const out of outgoing) for (const entry of incoming) {
            let inStart = entry.start;
            const phase = barPhaseAt(out.start, a, aBpm, rate);
            const incomingBars = b && bBpm ? barGrid(bBpm, b.downbeatOffset, b.beatsPerBar) : null;
            if (phase !== null) {
                const barred = alignEntry(inStart, incomingBars, phase);
                if (barred >= 0 && (toDuration === 0 || barred + wall <= toDuration)) inStart = barred;
            }
            if ((matched || driving) && a && b && aBpm && bBpm) {
                const aligned = inStart + djPhaseShift(out.start, inStart, a.beatOffset, b.beatOffset, aBpm, bBpm, rate);
                if (aligned >= 0 && (toDuration === 0 || aligned + wall <= toDuration)) inStart = aligned;
            }
            const singing = vocalWindows(toVocals, inStart, wall);
            const conflict = overlappingVocals(out.singing, singing);
            const opensPhrase = entry.source === 'phrase' && toVocals.some(range => inStart >= range.start - 0.05 && inStart <= range.start + 0.8);
            // Longer phrases win when they are equally clean. A stacked vocal still loses.
            const score = out.score + entry.score + Math.min(overlap, 18) * 0.35 - conflict * 4
                - (cutsVocal(toVocals, inStart) && !opensPhrase ? 12 : 0);
            if (!best || score > best.score) {
                best = {
                    outStart: out.start, inStart, overlap, score, clash: conflict > 0.5,
                    evidence: `${out.source}/${entry.source}`,
                };
            }
        }
    }
    // A late or short track still gets a safe, immediate interior handover when possible.
    const outStart = best?.outStart ?? at;
    const inStart = best?.inStart ?? Math.min(toDuration * 0.2, 45);
    const overlap = best?.overlap ?? Math.min(maximum, 1.5);
    const actualOverlap = Math.min(overlap, from.duration - Math.max(outStart, at));
    if (actualOverlap < 0.25) return null;
    const swap = rideLoud && !best?.clash && relation !== 'clashing';
    return {
        kind: 'fade', style: swap ? 'bassSwap' : 'plainBlend', relation, tempo: tempo.relation,
        stretch: 1,
        tiltDb: [0, 0], echoThrow: false, outStart, inStart,
        overlap: actualOverlap, minOverlap: Math.min(0.8, actualOverlap / 2), djCue: true,
        reason: `DJ Mix: ${best?.evidence ?? 'late/default'} exit ${outStart.toFixed(2)}s, entry ${inStart.toFixed(2)}s, ${actualOverlap.toFixed(2)}s blend`,
    };
}

/** Memoises pair selection until evidence changes, a seek moves backwards, or its cue is missed. */
export function createDjCueLookup() {
    let previous: { from: TransitionTrack; to: TransitionTrack; at: number; plan: TransitionPlan | null } | null = null;
    return (from: TransitionTrack, to: TransitionTrack, at: number): TransitionPlan | null => {
        if (previous && previous.from.profile === from.profile && previous.to.profile === to.profile
            && previous.from.lines === from.lines && previous.to.lines === to.lines
            && previous.from.duration === from.duration && previous.to.duration === to.duration
            && at >= previous.at - 1 && (!previous.plan || at <= previous.plan.outStart + 0.25)) {
            previous.at = at;
            return previous.plan;
        }
        const plan = planDjMix(from, to, at);
        previous = { from, to, at, plan };
        return plan;
    };
}
