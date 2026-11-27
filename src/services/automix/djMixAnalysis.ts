// Summarises the existing full-track structure and weighted level readings for DJ cue selection.
export interface DjSection {
    start: number;
    end: number;
    levelDb: number;
}

export function measureDjSections(levels: readonly number[], hopSec: number, boundaries: readonly number[], duration: number): DjSection[] {
    if (!(hopSec > 0) || !levels.length) return [];
    const edges = [0, ...boundaries.filter(edge => edge > 0 && edge < duration), duration];
    const sections: DjSection[] = [];
    for (let i = 1; i < edges.length; i++) {
        const start = edges[i - 1];
        const end = edges[i];
        const first = Math.ceil(start / hopSec);
        const last = Math.min(levels.length, Math.ceil(end / hopSec));
        let energy = 0;
        for (let frame = first; frame < last; frame++) energy += 10 ** (levels[frame] / 10);
        if (last > first && energy > 0) sections.push({ start, end, levelDb: 10 * Math.log10(energy / (last - first)) });
    }
    return sections;
}
