import type { Line } from '../../types';
import { isInterludeLine } from '../../utils/lyrics/parserCore';

// Timing evidence used by interior mixes, independent of audio playback and React.
export interface SungRange { start: number; end: number }

export const sungRanges = (lines: readonly Line[] | null | undefined): SungRange[] => (lines ?? [])
    .filter(line => line.fullText.trim() && !isInterludeLine(line) && Number.isFinite(line.startTime) && Number.isFinite(line.endTime) && line.endTime > line.startTime)
    .map(line => ({ start: line.startTime, end: line.endTime }));

export const cutsVocal = (ranges: readonly SungRange[], point: number): boolean => ranges.some(range => point > range.start + 0.12 && point < range.end - 0.12);

/** Clip singing to the blend's wall clock, merging overlapping lyrics. */
export function vocalWindows(ranges: readonly SungRange[], start: number, length: number, rate = 1): SungRange[] {
    const merged: SungRange[] = [];
    for (const range of ranges.map(range => ({ start: Math.max(0, (range.start - start) / rate), end: Math.min(length, (range.end - start) / rate) }))
        .filter(range => range.end > range.start).sort((a, b) => a.start - b.start)) {
        const last = merged.at(-1);
        if (last && last.end >= range.start) last.end = Math.max(last.end, range.end);
        else merged.push(range);
    }
    return merged;
}

export function overlappingVocals(a: readonly SungRange[], b: readonly SungRange[]): number {
    let seconds = 0;
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        seconds += Math.max(0, Math.min(a[i].end, b[j].end) - Math.max(a[i].start, b[j].start));
        if (a[i].end <= b[j].end) i++;
        else j++;
    }
    return seconds;
}

/**
 * Signed beat error of the incoming playhead against the outgoing one, on the faster common pulse.
 *
 * The fraction is in -0.5..0.5: negative means the incoming beat is late and its playhead has to
 * move earlier. Null when either tempo cannot form a grid.
 */
const beatPhase = (
    outAt: number, inAt: number, outOffset: number, inOffset: number, outBpm: number, inBpm: number, stretch: number,
): { period: number; fraction: number } | null => {
    const period = Math.min(60 / outBpm / stretch, 60 / inBpm);
    if (!(period > 0) || !Number.isFinite(period)) return null;
    const difference = ((outAt - outOffset) / stretch - (inAt - inOffset)) / period;
    return Number.isFinite(difference) ? { period, fraction: difference - Math.round(difference) } : null;
};

/** Absolute beat error between the two projected grids. Infinity when there is no grid. */
export function djPhaseError(outAt: number, inAt: number, outOffset: number, inOffset: number, outBpm: number, inBpm: number, stretch: number): number {
    const phase = beatPhase(outAt, inAt, outOffset, inOffset, outBpm, inBpm, stretch);
    return phase ? Math.abs(phase.fraction) : Infinity;
}

/** Seconds to add to the incoming playhead so its beat lands on the outgoing beat. */
export function djPhaseShift(outAt: number, inAt: number, outOffset: number, inOffset: number, outBpm: number, inBpm: number, stretch: number): number {
    const phase = beatPhase(outAt, inAt, outOffset, inOffset, outBpm, inBpm, stretch);
    return phase ? phase.fraction * phase.period : 0;
}

/**
 * How far the hidden deck may be placed from its cue to meet the outgoing playhead.
 *
 * A one-second clamp left a late buffer several beats behind the phrase: the phase nudge can only
 * move half a beat, so the two songs then played on top of each other out of time. The arm itself
 * is six seconds; this covers that, plus a slow start, and no further.
 */
export const DJ_PREROLL_LIMIT_SEC = 8;

/** Pre-roll the hidden deck so its intended cue lands at the audible handover. */
export const djPrerollEntry = (cue: number, outStart: number, tailAt: number, rate: number): number =>
    Math.max(0, cue + Math.max(-DJ_PREROLL_LIMIT_SEC, Math.min(DJ_PREROLL_LIMIT_SEC, (tailAt - outStart) / Math.max(0.01, rate))));
