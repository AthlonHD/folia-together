import { afterEach, describe, expect, it, vi } from 'vitest';
import { stemMixerBlock } from '../../../src/services/stemMixer/stemMixerAvailability';

// Checks route blocking and recovery independently of a real GPU or audio device.
vi.mock('../../../src/services/analysis/beatThisGpu', () => ({
    gpuStemsUsable: () => true,
    gpuStemsOnScreenUsable: () => true,
}));
vi.mock('../../../src/services/analysis/modelAvailability', () => ({ modelCanRun: () => true }));

afterEach(() => vi.unstubAllGlobals());

describe('stem mixer pass-through availability', () => {
    it('blocks while the native helper prepares or owns output and recovers after fallback', () => {
        vi.stubGlobal('window', { electron: { getHtdemucsGpuWeights: () => undefined } });
        vi.stubGlobal('navigator', { gpu: {} });
        const route = { automix: false, hifi: false, external: false };
        expect(stemMixerBlock({ ...route, passthrough: true })).toBe('passthrough');
        expect(stemMixerBlock({ ...route, passthrough: false })).toBeNull();
    });
});
