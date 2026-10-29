// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePassthroughPlayback } from '../../../src/components/app/passthrough/usePassthroughPlayback';
import { usePassthroughStatusStore } from '../../../src/services/passthrough/passthroughStatusStore';
import type { AudioHelperApi, PassthroughHelperEvent } from '../../../src/services/passthrough/types';
import { usePassthroughSettingsStore } from '../../../src/stores/usePassthroughSettingsStore';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';

// Helper failures must release native output before Web playback resumes; clearing a song must release it too.
vi.mock('react-i18next', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../src/utils/platform', () => ({ runsOnWindows: () => true }));
vi.mock('../../../src/components/app/passthrough/passthroughSource', () => ({
    classifyAudioSrc: () => 'remote',
    buildPassthroughSource: async () => ({ kind: 'url', url: 'https://audio.test/song.flac' }),
    startSecFor: () => 0,
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const mountBridge = async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let dispatch: (event: PassthroughHelperEvent) => void = () => {};
    const api = {
        configure: vi.fn(async () => true),
        stop: vi.fn(async () => true),
        load: vi.fn(async () => ({ ok: true })),
        play: vi.fn(async () => true),
        pause: vi.fn(async () => true),
        seek: vi.fn(async () => true),
        onEvent: (listener: typeof dispatch) => { dispatch = listener; return () => {}; },
    } as unknown as AudioHelperApi;
    vi.stubGlobal('window', Object.assign(window, { electron: { audioHelper: api } }));
    usePassthroughSettingsStore.setState({ passthroughEnabled: true });
    usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: 'https://audio.test/song.flac' });
    usePassthroughStatusStore.setState({ silenceWebOutput: false, engaged: false, chain: null, fallbackReason: null });
    const element = Object.assign(new EventTarget(), { currentTime: 0, paused: true, ended: false, seeking: false });
    const audioRef = { current: element as unknown as HTMLAudioElement };
    const Probe = () => { usePassthroughPlayback({ audioRef, setupAudioAnalyzer: () => {} }); return null; };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(React.createElement(Probe)));
    return { api, dispatch: (event: PassthroughHelperEvent) => dispatch(event) };
};

describe('native playback fallback', () => {
    it.each(['resample-failed', 'unsupported-channels'])('stops native output on %s and restores Web audio', async (code) => {
        const { api, dispatch } = await mountBridge();
        vi.mocked(api.stop).mockClear();
        expect(usePassthroughStatusStore.getState().silenceWebOutput).toBe(true);
        await act(async () => dispatch({ event: 'error', code, message: 'test failure' }));
        expect(api.stop).toHaveBeenCalledTimes(1);
        expect(usePassthroughStatusStore.getState()).toMatchObject({ silenceWebOutput: false, engaged: false, chain: null, fallbackReason: code });
    });

    it('stops the helper and clears stale chain state when the source is removed', async () => {
        const { api } = await mountBridge();
        vi.mocked(api.stop).mockClear();
        await act(async () => usePlaybackStore.setState({ audioSrc: null }));
        expect(api.stop).toHaveBeenCalledTimes(1);
        expect(usePassthroughStatusStore.getState()).toMatchObject({ silenceWebOutput: false, engaged: false, chain: null });
    });
});
