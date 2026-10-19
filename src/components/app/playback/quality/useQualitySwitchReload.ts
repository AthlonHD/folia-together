import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import type { OnlineRecovery, OnlineRecoveryOptions } from '../restore/createOnlineRecoveryController';
import { planQualitySwitch, QUALITY_SWITCH_DEBOUNCE_MS } from './qualitySwitch';

// src/components/app/playback/quality/useQualitySwitchReload.ts
//
// Switching the audio quality takes effect at once: the song that is playing is asked for again at the new level and carries on from
// the same second, playing or paused as it was. Before, the new level only applied from the next song.
//
// The asking itself is the online recovery's (the same path as a stream address that ran out): it keeps the position, honours a pause pressed
// meanwhile, and takes a copy from the media cache only where that was fetched at the level now chosen. Songs that are not online ones
// (local files, Navidrome, a remote controller's) are not asked for anything: it answers "not recovered" for them and nothing changes.

type UseQualitySwitchReloadParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    recoverOnlinePlaybackSource: (options: OnlineRecoveryOptions) => Promise<OnlineRecovery>;
};

export function useQualitySwitchReload({ audioRef, recoverOnlinePlaybackSource }: UseQualitySwitchReloadParams) {
    const { t } = useTranslation();
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    // The newest controller (it closes over the song and the level of this render), not the one of an earlier render.
    const recoverRef = useRef(recoverOnlinePlaybackSource);
    recoverRef.current = recoverOnlinePlaybackSource;
    const previousQualityRef = useRef(audioQuality);

    useEffect(() => {
        const previous = previousQualityRef.current;
        previousQualityRef.current = audioQuality;
        const plan = planQualitySwitch({ previous, next: audioQuality, element: audioRef.current });
        if (!plan) return;

        const timer = window.setTimeout(() => {
            const element = audioRef.current;
            // Asked again at the moment it is sent: the position and the pause are those of now, not of the click.
            const current = planQualitySwitch({ previous, next: audioQuality, element });
            if (!current || !element?.currentSrc) return;
            void recoverRef.current(current).then(result => {
                if (result.recovered) {
                    console.info(`[Quality] switched to ${audioQuality} at ${current.resumeAt.toFixed(1)}s`);
                } else if (!result.stale && result.failure) {
                    setStatusMessage({ type: 'error', text: t('quality.switchFailed') });
                }
            });
        }, QUALITY_SWITCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
        // Only a change of the level asks for anything; the song and the controller are read when the timer fires.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioQuality]);
}
