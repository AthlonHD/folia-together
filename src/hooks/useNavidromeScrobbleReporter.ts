import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../types';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';
import { NavidromeScrobbleSessionTracker } from '../utils/navidromeScrobble';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { errorFields } from '../utils/errorText';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { getObservedMedia, type ObservedMedia } from '../services/hifi/hifiMediaShim';

// src/hooks/useNavidromeScrobbleReporter.ts
// Bridges audio playback events to Navidrome scrobble/now-playing reports.

type UseNavidromeScrobbleReporterParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    /** Changes when automix hands playback to the other deck, so the listeners follow it. */
    activeDeck: string;
};

export const useNavidromeScrobbleReporter = ({
    audioRef,
    currentSong,
    activeDeck,
}: UseNavidromeScrobbleReporterParams): void => {
    const currentSongRef = useRef<SongResult | null>(currentSong);
    const trackerRef = useRef<NavidromeScrobbleSessionTracker | null>(null);
    // The element the last effect bound. Still the outgoing deck when the queue moves at arm time.
    const listeningRef = useRef<ObservedMedia | null>(null);
    const parkedListenRef = useRef<{ songId: string; element: ObservedMedia; detach: () => void } | null>(null);
    // A Navidrome song on the HiFi route plays through mpv: the listeners go on the HiFi media shim then.
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);

    currentSongRef.current = currentSong;

    if (!trackerRef.current) {
        trackerRef.current = new NavidromeScrobbleSessionTracker(({ kind, songId }) => {
            const config = getNavidromeConfig();
            if (!config) {
                return;
            }

            void navidromeApi.scrobble(config, songId, {
                submission: kind === 'submission',
                time: Date.now(),
            }).then((success) => {
                if (!success) {
                    console.warn('[Navidrome] scrobble report was rejected', { kind, songId });
                }
            }).catch((error) => {
                console.warn('[Navidrome] scrobble report failed', { kind, songId, ...errorFields(error) });
            });
        });
    }

    useEffect(() => {
        const tracker = trackerRef.current;
        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const songId = navidromeSong?.navidromeData?.id;

        if (!tracker) return;

        const incomingId = songId ?? null;
        const leaving = listeningRef.current;
        const arriving = getObservedMedia(audioRef.current);
        const outgoingId = tracker.getCurrentSongId();
        // Arm moves the queue while the outgoing deck keeps playing. Follow that deck until it
        // actually crosses the line; guessing the lead would scrobble a mix the listener cancelled.
        if (
            outgoingId
            && outgoingId !== incomingId
            && leaving
            && arriving
            && leaving !== arriving
            && !leaving.paused
            && !leaving.ended
            && parkedListenRef.current?.songId !== outgoingId
        ) {
            const previous = parkedListenRef.current;
            if (previous) {
                tracker.progressParked(previous.element.currentTime || 0);
                previous.detach();
                tracker.dropParked();
            }
            const element = leaving;
            tracker.parkCurrent();
            let detach = () => {};
            const onOutgoing = () => {
                tracker.progressParked(element.currentTime || 0);
                if (!tracker.hasParked() || element.paused || element.ended) {
                    if (element.paused || element.ended) tracker.dropParked();
                    detach();
                    if (parkedListenRef.current?.songId === outgoingId) parkedListenRef.current = null;
                }
            };
            detach = () => {
                element.removeEventListener('timeupdate', onOutgoing);
                element.removeEventListener('pause', onOutgoing);
                element.removeEventListener('ended', onOutgoing);
            };
            element.addEventListener('timeupdate', onOutgoing);
            element.addEventListener('pause', onOutgoing);
            element.addEventListener('ended', onOutgoing);
            parkedListenRef.current = { songId: outgoingId, element, detach };
        }

        if (!incomingId) {
            tracker.clearSession();
            return;
        }

        const durationMs = getProviderSongMetadata(navidromeSong).durationMs || getProviderSongMetadata(currentSong).durationMs;
        if (tracker.getCurrentSongId() !== incomingId) {
            tracker.startSession(incomingId, durationMs);
        }
    }, [audioRef, currentSong]);

    useEffect(() => () => {
        parkedListenRef.current?.detach();
        parkedListenRef.current = null;
        trackerRef.current?.dropParked();
    }, []);

    useEffect(() => {
        const audioElement = getObservedMedia(audioRef.current);
        const tracker = trackerRef.current;
        listeningRef.current = audioElement;
        if (!audioElement || !tracker) {
            return;
        }

        const ensureSessionFromCurrentSong = () => {
            const navidromeSong = resolveNavidromePlaybackCarrier(currentSongRef.current);
            const songId = navidromeSong?.navidromeData?.id;
            if (!songId) {
                tracker.clearSession();
                return false;
            }

            if (tracker.getCurrentSongId() !== songId) {
                const durationMs = getProviderSongMetadata(navidromeSong).durationMs
                    || getProviderSongMetadata(currentSongRef.current).durationMs;
                tracker.startSession(songId, durationMs);
            }
            return true;
        };

        const handlePlaybackStart = () => {
            if (!ensureSessionFromCurrentSong()) {
                return;
            }
            tracker.handlePlaybackStart(audioElement.currentTime || 0);
        };

        const handleProgress = () => {
            if (audioElement.paused || audioElement.ended || !ensureSessionFromCurrentSong()) {
                return;
            }
            tracker.handleProgress(audioElement.currentTime || 0);
        };

        const handleEnded = () => {
            if (!ensureSessionFromCurrentSong()) {
                return;
            }
            const endTime = Number.isFinite(audioElement.duration) ? audioElement.duration : audioElement.currentTime;
            tracker.handleProgress(endTime || 0);
            tracker.clearSession();
        };

        audioElement.addEventListener('play', handlePlaybackStart);
        audioElement.addEventListener('playing', handlePlaybackStart);
        audioElement.addEventListener('timeupdate', handleProgress);
        audioElement.addEventListener('ended', handleEnded);

        return () => {
            audioElement.removeEventListener('play', handlePlaybackStart);
            audioElement.removeEventListener('playing', handlePlaybackStart);
            audioElement.removeEventListener('timeupdate', handleProgress);
            audioElement.removeEventListener('ended', handleEnded);
        };
        // audioRef names a different element after an automix deck swap, and these listeners are
        // bound to the element itself rather than read through the ref, so they have to rebind.
        //
        // The swap happens at arm time, while the outgoing deck keeps playing. The song effect
        // follows that deck until it pauses, so a mix that crosses the scrobble line after the
        // queue has already moved still submits, and a cancelled one does not.
        //
        // `playbackRoute` rebinds them between a deck and the HiFi media shim, which no deck swap signals.
    }, [audioRef, activeDeck, playbackRoute]);
};
