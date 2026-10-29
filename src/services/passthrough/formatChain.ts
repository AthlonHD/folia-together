// src/services/passthrough/formatChain.ts
// The one line that says what the playback chain really is, built from what the helper reported. Language-neutral on purpose:
// codec, rates and bit depths read the same everywhere; the labels around it come from i18n.

import type { PassthroughChain } from './types';

const khz = (hz: number): string => {
    const value = hz / 1000;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

/** e.g. `FLAC 96k/24 → 192k/24`: the formats alone, without the device or the mode. */
export const describeFormats = (chain: PassthroughChain, withCodec = true): string => {
    const rates = `${khz(chain.sourceRate)}k${chain.sourceBits ? `/${chain.sourceBits}` : ''}`;
    const source = withCodec ? `${chain.codec.replace(/^pcm_/, 'PCM ').toUpperCase()} ${rates}` : rates;
    return `${source} → ${khz(chain.outputRate)}k/${chain.outputValidBits}`;
};

/** e.g. `FLAC 96k/24 → CABLE Input 192k/24 · exclusive` */
export const describeChain = (chain: PassthroughChain): string => {
    const source = `${chain.codec.replace(/^pcm_/, 'PCM ').toUpperCase()} ${khz(chain.sourceRate)}k${chain.sourceBits ? `/${chain.sourceBits}` : ''}`;
    const output = `${khz(chain.outputRate)}k/${chain.outputValidBits}`;
    return `${source} → ${chain.deviceName} ${output}${chain.exclusive ? ' · WASAPI exclusive' : ' · WASAPI shared'}`;
};

/** Which of the chain's departures from the source apply, as translation-key suffixes. */
export const chainDepartures = (chain: PassthroughChain): Array<'Resampled' | 'Truncated' | 'Downmixed' | 'ChannelsChanged' | 'SharedMixer'> => {
    const found: Array<'Resampled' | 'Truncated' | 'Downmixed' | 'ChannelsChanged' | 'SharedMixer'> = [];
    if (chain.resampled) found.push('Resampled');
    if (chain.truncated) found.push('Truncated');
    if (chain.downmixed) found.push('Downmixed');
    else if (chain.sourceChannels !== 2) found.push('ChannelsChanged');
    if (!chain.exclusive) found.push('SharedMixer');
    return found;
};

/** Treat older helpers' claims conservatively; this only describes steady playback before the driver. */
export const isSteadyPcmUnchanged = (chain: PassthroughChain): boolean => (
    chain.bitPerfect && chain.exclusive && chain.sourceChannels === 2
    && chain.sourceBits > 0 && chain.sourceBits <= 32
    && !/f32|f64|float|double/i.test(chain.codec)
    && chain.sourceRate > 0 && chain.sourceRate === chain.outputRate
    && chain.outputValidBits >= chain.sourceBits
    && !chain.resampled && !chain.truncated && !chain.downmixed
);

/** A nonempty explanation is required even when the helper cannot establish the source precision. */
export const chainStatusKeys = (chain: PassthroughChain): string[] => {
    if (isSteadyPcmUnchanged(chain)) return ['BitPerfect'];
    const departures = chainDepartures(chain);
    return departures.length ? departures : ['Unverified'];
};
