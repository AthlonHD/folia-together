// src/services/passthrough/formatChain.ts
// The one line that says what the playback chain really is, built from what the helper reported. Language-neutral on purpose:
// codec, rates and bit depths read the same everywhere; the labels around it come from i18n.

import type { PassthroughChain } from './types';

const khz = (hz: number): string => {
    const value = hz / 1000;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

/** e.g. `FLAC 96k/24 → CABLE Input 192k/24 · exclusive` */
export const describeChain = (chain: PassthroughChain): string => {
    const source = `${chain.codec.replace(/^pcm_/, 'PCM ').toUpperCase()} ${khz(chain.sourceRate)}k${chain.sourceBits ? `/${chain.sourceBits}` : ''}`;
    const output = `${khz(chain.outputRate)}k/${chain.outputValidBits}`;
    return `${source} → ${chain.deviceName} ${output}${chain.exclusive ? ' · WASAPI exclusive' : ''}`;
};

/** Which of the chain's departures from the source apply, as translation-key suffixes. */
export const chainDepartures = (chain: PassthroughChain): Array<'Resampled' | 'Truncated' | 'Downmixed'> => {
    const found: Array<'Resampled' | 'Truncated' | 'Downmixed'> = [];
    if (chain.resampled) found.push('Resampled');
    if (chain.truncated) found.push('Truncated');
    if (chain.downmixed) found.push('Downmixed');
    return found;
};
