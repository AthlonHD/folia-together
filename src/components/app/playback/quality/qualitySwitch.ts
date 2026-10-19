// src/components/app/playback/quality/qualitySwitch.ts
// What changing the audio quality while a song plays asks of the player: the same song is asked for again at the new level and
// carries on from where it was, playing or paused as it was.

/** The quality changes in a burst (a row of clicks); only the last one is asked for. */
export const QUALITY_SWITCH_DEBOUNCE_MS = 350;

export type QualitySwitchPlan = { force: true; autoplay: boolean; resumeAt: number };

/** null when nothing is to be done: the level did not change, or there is no audio element to carry on from. */
export const planQualitySwitch = ({
    previous,
    next,
    element,
}: {
    previous: string;
    next: string;
    element: { paused: boolean; currentTime: number } | null;
}): QualitySwitchPlan | null => {
    if (previous === next || !element) return null;
    return {
        // The same file may be asked for again: the new level is a different file.
        force: true,
        autoplay: !element.paused,
        resumeAt: Number.isFinite(element.currentTime) ? Math.max(0, element.currentTime) : 0,
    };
};
