import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toFallbackReason, usePassthroughStatusStore } from '../../../services/passthrough/passthroughStatusStore';
import type { PassthroughHelperEvent } from '../../../services/passthrough/types';
import { usePassthroughSettingsStore } from '../../../stores/usePassthroughSettingsStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { runsOnWindows } from '../../../utils/platform';
import { buildPassthroughSource, classifyAudioSrc, startSecFor } from './passthroughSource';

// src/components/app/passthrough/usePassthroughPlayback.ts
//
// Pass-through playback for the Windows desktop app: the sound of each track is played by the WASAPI helper (exclusive mode, no
// mixer, no web audio effects) while the page's <audio> element keeps running silently as the transport the rest of the app is
// built on - queue, lyrics, visualizers, the play state all keep reading it.
//
// The helper's clock is the master: it reports its position about ten times a second and the element is pulled back to it
// whenever the two drift apart. The element's play, pause and seek events are forwarded the other way.

/** How far the element may stray from the helper before it is moved; below this the lyrics would not notice. */
const DRIFT_TOLERANCE_SEC = 0.3;

type UsePassthroughPlaybackParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    /** Builds the audio graph; the element has to be routed through it before the web output can be silenced. */
    setupAudioAnalyzer: () => void;
};

export function usePassthroughPlayback({ audioRef, setupAudioAnalyzer }: UsePassthroughPlaybackParams) {
    const { t } = useTranslation();
    const api = typeof window !== 'undefined' ? window.electron?.audioHelper : undefined;
    const enabled = usePassthroughSettingsStore(state => state.passthroughEnabled) && Boolean(api) && runsOnWindows();
    const deviceId = usePassthroughSettingsStore(state => state.passthroughDeviceId);
    const rateStrategy = usePassthroughSettingsStore(state => state.passthroughRateStrategy);
    const fixedRate = usePassthroughSettingsStore(state => state.passthroughFixedRate);
    const mode = usePassthroughSettingsStore(state => state.passthroughMode);
    const audioSrc = usePlaybackStore(state => state.audioSrc);

    const tokenRef = useRef(0);
    // Set around our own element.currentTime writes so the 'seeking' they cause is not sent back to the helper.
    const ownSeekRef = useRef(false);
    const reportedReasonRef = useRef<string | null>(null);
    // When the page last told the helper to move: its position reports from just before it took effect are old news and must not pull the page back.
    const lastMoveAtRef = useRef(0);

    const { setSilenceWebOutput, setEngaged, setChain, setFallbackReason, setLevelDb } = usePassthroughStatusStore.getState();
    // The level is shown about twice a second, not at the helper's ten reports a second.
    const levelTickRef = useRef(0);

    const stand = (reason: ReturnType<typeof toFallbackReason> | null) => {
        setEngaged(false);
        setChain(null);
        setLevelDb(null);
        setSilenceWebOutput(false);
        setFallbackReason(reason);
        if (reason && reportedReasonRef.current !== reason) {
            reportedReasonRef.current = reason;
            setStatusMessage({ type: 'info', text: t(`passthrough.fallback.${reason}`) });
        }
    };

    // The helper's settings follow the page's; they take effect from the next track.
    useEffect(() => {
        if (!enabled || !api) return;
        void api.configure({ deviceId, rateStrategy, fixedRate, mode });
    }, [api, enabled, deviceId, rateStrategy, fixedRate, mode]);

    // Leaving pass-through (switched off, or the window closing) hands the sound back to the web player.
    useEffect(() => {
        if (enabled) return;
        stand(null);
        void api?.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    // What the helper says.
    useEffect(() => {
        if (!enabled || !api) return;
        return api.onEvent((event: PassthroughHelperEvent) => {
            const element = audioRef.current;
            switch (event.event) {
                case 'chain': {
                    if (event.token !== tokenRef.current) return;
                    setChain(event.chain);
                    setEngaged(true);
                    setFallbackReason(null);
                    reportedReasonRef.current = null;
                    console.info('[PassthroughPlayback] chain', event.chain);
                    // A song reloaded at another level comes back at the second the page restored it to; the helper starts from the beginning.
                    if (element && element.currentTime > 1) {
                        lastMoveAtRef.current = Date.now();
                        void api.seek(element.currentTime);
                    }
                    // The page may have pressed play while the helper was still opening the device.
                    if (element && !element.paused) void api.play();
                    break;
                }
                case 'position': {
                    if (event.token === tokenRef.current && ++levelTickRef.current % 5 === 0) setLevelDb(event.peakDb);
                    if (event.token !== tokenRef.current || !element || element.seeking) return;
                    if (Date.now() - lastMoveAtRef.current < 700) return;
                    if (Math.abs(element.currentTime - event.sec) > DRIFT_TOLERANCE_SEC) {
                        ownSeekRef.current = true;
                        element.currentTime = event.sec;
                    }
                    break;
                }
                case 'error': {
                    if (event.code === 'seek-failed' || event.code === 'bad-command' || event.code === 'resample-failed') {
                        console.warn('[PassthroughPlayback]', event.code, event.message);
                        return;
                    }
                    console.warn('[PassthroughPlayback] helper error', event.code, event.message);
                    stand(toFallbackReason(event.code));
                    break;
                }
                case 'exit':
                    stand('helper-unavailable');
                    break;
                default:
                    break;
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, enabled, audioRef]);

    // A new track: hand it to the helper.
    useEffect(() => {
        if (!enabled || !api) return;
        const element = audioRef.current;
        if (!audioSrc || !element) return;

        if (classifyAudioSrc(audioSrc) === 'unsupported') {
            void api.stop();
            stand('unsupported-source');
            return;
        }

        const token = ++tokenRef.current;
        let cancelled = false;
        // Route the element through the audio graph first, then silence it: the other order lets the first moments out of the speakers.
        setupAudioAnalyzer();
        setSilenceWebOutput(true);
        setEngaged(false);

        void (async () => {
            try {
                const source = await buildPassthroughSource(audioSrc);
                if (cancelled || !source) return;
                const result = await api.load({ source, startSec: startSecFor(element.currentTime), autoplay: false, token });
                if (cancelled || token !== tokenRef.current) return;
                if (!result.ok && result.error !== 'superseded') {
                    console.warn('[PassthroughPlayback] load failed', result.error);
                    stand(result.error === 'helper-unavailable' ? 'helper-unavailable' : 'stage-failed');
                }
            } catch (error) {
                if (cancelled) return;
                console.warn('[PassthroughPlayback] could not hand the track over', error);
                stand('stage-failed');
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, enabled, audioSrc, audioRef]);

    // The element's transport, forwarded to the helper.
    useEffect(() => {
        if (!enabled || !api) return;
        const element = audioRef.current;
        if (!element) return;

        const onPlay = () => void api.play();
        // 'ended' also pauses the element; the helper must keep playing out its last buffers.
        const onPause = () => { if (!element.ended) void api.pause(); };
        const onSeeking = () => {
            if (ownSeekRef.current) {
                ownSeekRef.current = false;
                return;
            }
            lastMoveAtRef.current = Date.now();
            void api.seek(element.currentTime);
        };
        element.addEventListener('play', onPlay);
        element.addEventListener('pause', onPause);
        element.addEventListener('seeking', onSeeking);
        return () => {
            element.removeEventListener('play', onPlay);
            element.removeEventListener('pause', onPause);
            element.removeEventListener('seeking', onSeeking);
        };
    }, [api, enabled, audioRef, audioSrc]);

    // Closing the player releases the endpoint.
    useEffect(() => () => {
        void api?.stop();
    }, [api]);
}
