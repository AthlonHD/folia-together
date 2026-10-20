import { describe, expect, it } from 'vitest';
import {
    classifyAudioSrc,
    extensionForMime,
    startSecFor,
} from '../../../src/components/app/passthrough/passthroughSource';
import { chainDepartures, describeChain, describeFormats } from '../../../src/services/passthrough/formatChain';
import { toFallbackReason } from '../../../src/services/passthrough/passthroughStatusStore';
import type { PassthroughChain } from '../../../src/services/passthrough/types';

// test/unit/passthrough/passthroughSource.test.ts
// What the page hands to the pass-through helper, and how the chain it reports is worded.

const chain = (overrides: Partial<PassthroughChain> = {}): PassthroughChain => ({
    sourceRate: 96000,
    sourceBits: 24,
    sourceChannels: 2,
    codec: 'flac',
    deviceName: 'WDM2VST',
    outputRate: 96000,
    outputBits: 32,
    outputValidBits: 24,
    exclusive: true,
    resampled: false,
    truncated: false,
    downmixed: false,
    bitPerfect: true,
    ...overrides,
});

describe('classifyAudioSrc', () => {
    it('accepts what the main process can turn into a file', () => {
        expect(classifyAudioSrc('blob:app://x/123')).toBe('blob');
        expect(classifyAudioSrc('https://cdn.example.com/a.flac')).toBe('remote');
        expect(classifyAudioSrc('http://127.0.0.1:3000/a.mp3')).toBe('remote');
        expect(classifyAudioSrc('file:///C:/Music/a.flac')).toBe('remote');
        expect(classifyAudioSrc('folia-media://audio/1?k=2')).toBe('remote');
    });

    it('leaves foreign schemes and nothing to the web player', () => {
        expect(classifyAudioSrc('spotify-audio://track/1')).toBe('unsupported');
        expect(classifyAudioSrc('')).toBe('unsupported');
        expect(classifyAudioSrc(null)).toBe('unsupported');
    });
});

describe('extensionForMime', () => {
    it('maps the audio types a blob can carry and ignores parameters', () => {
        expect(extensionForMime('audio/flac')).toBe('flac');
        expect(extensionForMime('audio/mpeg; codecs=mp3')).toBe('mp3');
        expect(extensionForMime('application/octet-stream')).toBeUndefined();
    });
});

describe('startSecFor', () => {
    it('starts a track that has just begun from its first sample', () => {
        expect(startSecFor(0)).toBe(0);
        expect(startSecFor(2.5)).toBe(0);
    });

    it('starts a resumed track where the page is', () => {
        expect(startSecFor(80)).toBe(80);
    });

    it('survives a clock that is not a number', () => {
        expect(startSecFor(Number.NaN)).toBe(0);
    });
});

describe('describeChain', () => {
    it('names source, device and the exclusive path', () => {
        expect(describeChain(chain())).toBe('FLAC 96k/24 → WDM2VST 96k/24 · WASAPI exclusive');
    });

    it('says shared when the Windows mixer is in the path', () => {
        expect(describeChain(chain({ exclusive: false }))).toBe('FLAC 96k/24 → WDM2VST 96k/24 · WASAPI shared');
    });

    it('shows the resampled rate and a lossy source without a bit depth', () => {
        const text = describeChain(chain({ codec: 'mp3', sourceRate: 44100, sourceBits: 0, outputRate: 192000, resampled: true, bitPerfect: false }));
        expect(text).toBe('MP3 44.1k → WDM2VST 192k/24 · WASAPI exclusive');
    });
});

describe('describeFormats', () => {
    it('reads as the formats alone, source then output', () => {
        expect(describeFormats(chain())).toBe('FLAC 96k/24 → 96k/24');
        expect(describeFormats(chain({ codec: 'mp3', sourceRate: 44100, sourceBits: 0, outputRate: 192000, resampled: true, bitPerfect: false, resampler: 'soxr' }))).toBe('MP3 44.1k → 192k/24');
    });
});

describe('chainDepartures', () => {
    it('lists every way the output differs from the source', () => {
        expect(chainDepartures(chain())).toEqual([]);
        expect(chainDepartures(chain({ resampled: true, truncated: true, downmixed: true }))).toEqual(['Resampled', 'Truncated', 'Downmixed']);
    });
});

describe('toFallbackReason', () => {
    it('keeps known codes and files the rest under open-failed', () => {
        expect(toFallbackReason('device-in-use')).toBe('device-in-use');
        expect(toFallbackReason('something-new')).toBe('open-failed');
    });
});
