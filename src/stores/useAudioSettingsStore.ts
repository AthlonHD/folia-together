// src/stores/useAudioSettingsStore.ts
// Audio output and the media cache: stream quality, output device, the equalizer, how queued
// songs are added, and the cache ceiling.
//
// volume / isMuted / loopMode live here too. They are playback state rather than settings, but
// they are audio-output state, and this is their nearest owner until the Phase B transport store
// exists — at which point they may move once more.

import { DEFAULT_HEARTBEAT_INTERVAL, isHeartbeatInterval, type HeartbeatInterval } from '../utils/heartbeatPlan';
import { isStageRemoteMode, remoteSetLoopMode } from '../services/stageRemote';
import { nextLoopDisplayMode, type LoopDisplayMode } from '../utils/loopDisplayMode';
import { create } from 'zustand';
import type { AudioQualityPreference } from '../types/onlineMusic';
import { type QueueAddBehavior } from '../types';
import { getAudioEqualizerCustomSlotIndex, isAudioEqualizerCustomSlotId, readStoredAudioEqualizerSettings, resolveAudioEqualizerSettings, writeStoredAudioEqualizerSettings, type AudioEqualizerModeId, type AudioEqualizerSettings } from '../utils/audioEqualizer';
import { AUDIO_SOUND_PRESETS } from '../utils/audioPresets';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';
import i18n from '../i18n/config';

// 心动模式此刻能不能用由播放上下文决定(utils/heartbeatAvailability 注册),这里只调用,不依赖播放 store。
let resolveHeartbeatAvailable: () => boolean = () => false;
export const registerHeartbeatAvailabilityResolver = (resolver: () => boolean): void => {
    resolveHeartbeatAvailable = resolver;
};

export const CACHE_SIZE_KEY = 'folia_cache_size';

export const ENABLE_MEDIA_CACHE_KEY = 'folia_enable_media_cache';

/** What the toggle used to write to, before it was corrected to the prefixed key above. */
export const LEGACY_ENABLE_MEDIA_CACHE_KEY = 'enable_media_cache';

export const MEDIA_CACHE_LIMIT_GB_KEY = 'folia_media_cache_limit_gb';

/** Lab switch: start the restored last session playing instead of waiting for a press. */
export const AUTO_PLAY_ON_LAUNCH_KEY = 'folia_auto_play_on_launch';

export const ENABLE_TRANSCODE_FALLBACK_KEY = 'folia_enable_transcode_fallback';

/** Whether finished plays of online NetEase tracks are reported to the signed-in account. */
export const NETEASE_SCROBBLE_KEY = 'folia_netease_scrobble';

/** Whether pause fades out and resume fades in (services/playbackFade). On unless switched off. */
export const PLAYBACK_FADE_KEY = 'folia_playback_fade_enabled';

/**
 * Whether a song that cannot be played for an account restriction or an unknown reason counts down to
 * a skip, like a taken-down one (services/onlineMusic/failure/onlineFailureCase). Off unless asked for.
 */
export const AUTO_SKIP_UNPLAYABLE_KEY = 'folia_auto_skip_unplayable';

/** Gigabytes of cached audio to keep. Zero is the listener asking for no ceiling at all. */
export const DEFAULT_MEDIA_CACHE_LIMIT_GB = 5;

export type AudioQuality = AudioQualityPreference;

export const resolveStoredAudioQuality = (saved: string | null): AudioQuality => (
    saved === 'standard' || saved === 'ultra' || saved === 'lossless' || saved === 'hires' ? saved : 'high'
);

/**
 * Reads the media cache toggle, honouring the key its own setter used to write to.
 *
 * The setter wrote a bare 'enable_media_cache' while startup read the folia-prefixed key, so the
 * setting silently reverted to off on every restart. Anyone who switched it on has their real
 * preference sitting under the legacy key, and simply correcting the setter would throw that
 * away once more - so read it as a fallback and promote it to the canonical key.
 */
export const readStoredEnableMediaCache = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const canonical = localStorage.getItem(ENABLE_MEDIA_CACHE_KEY);
    if (canonical !== null) {
        return canonical === 'true';
    }

    const legacy = localStorage.getItem(LEGACY_ENABLE_MEDIA_CACHE_KEY);
    if (legacy === null) {
        return false;
    }

    localStorage.setItem(ENABLE_MEDIA_CACHE_KEY, legacy);
    return legacy === 'true';
};

export const readStoredMediaCacheLimitGb = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_MEDIA_CACHE_LIMIT_GB;
    }

    const saved = localStorage.getItem(MEDIA_CACHE_LIMIT_GB_KEY);
    const parsed = saved === null ? NaN : Number(saved);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MEDIA_CACHE_LIMIT_GB;
};

const readStoredAudioQuality = (): AudioQuality => {
    if (typeof window === 'undefined') {
        return 'high';
    }

    const saved = localStorage.getItem('default_audio_quality');
    const quality = resolveStoredAudioQuality(saved);
    if (saved === 'exhigh') {
        localStorage.setItem('default_audio_quality', 'high');
    }
    return quality;
};

export const HEARTBEAT_INTERVAL_KEY = 'folia_heartbeat_interval';

const readStoredHeartbeatInterval = (): HeartbeatInterval => {
    if (typeof window === 'undefined') {
        return DEFAULT_HEARTBEAT_INTERVAL;
    }

    const saved = Number(localStorage.getItem(HEARTBEAT_INTERVAL_KEY));
    return localStorage.getItem(HEARTBEAT_INTERVAL_KEY) !== null && isHeartbeatInterval(saved) ? saved : DEFAULT_HEARTBEAT_INTERVAL;
};

const readStoredQueueAddBehavior = (): QueueAddBehavior => {
    if (typeof window === 'undefined') {
        return 'append';
    }

    const saved = localStorage.getItem('queue_add_behavior');
    return saved === 'next' ? 'next' : 'append';
};

const readStoredAudioOutputDeviceId = (): string => {
    if (typeof window === 'undefined') {
        return '';
    }

    return localStorage.getItem('audio_output_device_id') ?? '';
};

const readStoredLoopMode = (): 'off' | 'all' | 'one' => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    const saved = localStorage.getItem('player_loop_mode');
    return saved === 'all' || saved === 'one' ? saved : 'off';
};

// 随机只在列表循环下才成立(见 loopDisplayMode),存的值不一致时按"没开随机"处理
const readStoredShuffleEnabled = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    return localStorage.getItem('player_shuffle') === 'true' && readStoredLoopMode() === 'all';
};

const readStoredVolume = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem('player_volume');
    const parsed = saved !== null ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? parsed : 1;
};

export type AudioSettingsState = {
    audioQuality: AudioQuality;
    enableMediaCache: boolean;
    /** Gigabytes of cached audio to keep before the oldest is dropped. Zero means no ceiling. */
    mediaCacheLimitGb: number;
    queueAddBehavior: QueueAddBehavior;
    /** Whether entering the app starts the restored session by itself. Off unless asked for. */
    autoPlayOnLaunch: boolean;
    /** Electron-only recovery for local and Navidrome formats Chromium cannot decode. */
    enableTranscodeFallback: boolean;
    /** Report finished plays of online NetEase tracks to the signed-in account. Off by default. */
    neteaseScrobbleEnabled: boolean;
    /** Short fade when pausing and resuming instead of cutting the sound. On by default. */
    playbackFadeEnabled: boolean;
    /** Count down to a skip when a song is restricted or fails for an unknown reason. Off by default. */
    autoSkipUnplayable: boolean;
    audioOutputDeviceId: string;
    audioEqualizerSettings: AudioEqualizerSettings;
    isAudioEqualizerOpen: boolean;
    volume: number;
    isMuted: boolean;
    loopMode: 'off' | 'all' | 'one';
    /** 随机播放:loopMode 为 'all' 时下一首随机挑,不改动队列顺序。 */
    shuffleEnabled: boolean;
    /** 心动模式(网易云):loopMode 为 'all' 时每首播完按当前歌与「我喜欢的音乐」向网易云要下一首。只在本次会话有效,不落盘。 */
    heartbeatEnabled: boolean;
    /** 心动模式每播放几首歌单里的歌插一首推荐(0 = 每次都推荐)。 */
    heartbeatInterval: HeartbeatInterval;
    setAudioQuality: (quality: AudioQuality) => void;
    handleToggleMediaCache: (enable: boolean) => void;
    handleSetMediaCacheLimitGb: (gigabytes: number) => void;
    handleSetQueueAddBehavior: (behavior: QueueAddBehavior) => void;
    handleSetHeartbeatInterval: (interval: HeartbeatInterval) => void;
    handleToggleAutoPlayOnLaunch: (enable: boolean) => void;
    handleToggleTranscodeFallback: (enable: boolean) => void;
    handleToggleNeteaseScrobble: (enable: boolean) => void;
    handleTogglePlaybackFade: (enable: boolean) => void;
    handleToggleAutoSkipUnplayable: (enable: boolean) => void;
    handleSetAudioOutputDeviceId: (deviceId: string) => void;
    handleSetAudioEqualizerSettings: (settings: AudioEqualizerSettings) => void;
    handleApplyAudioSoundPreset: (modeId: AudioEqualizerModeId) => void;
    openAudioEqualizer: () => void;
    closeAudioEqualizer: () => void;
    handleSetVolume: (val: number) => void;
    /** Sets the mute switch; the same value is a no-op. */
    handleSetMuted: (muted: boolean) => void;
    handleToggleMute: () => void;
    /** Sets the repeat mode and toasts it like the repeat button; the mode already in effect is a no-op. */
    handleSetLoopMode: (mode: 'off' | 'all' | 'one') => void;
    handleToggleLoopMode: () => void;
    /** 直接设为某个循环展示态(含随机);persist 为 false 时只改内存,遥控页镜像 Host 用。 */
    setLoopDisplayMode: (mode: LoopDisplayMode, options?: { persist?: boolean }) => void;
};

export const useAudioSettingsStore = create<AudioSettingsState>((set, get) => ({
    audioQuality: readStoredAudioQuality(),
    enableMediaCache: readStoredEnableMediaCache(),
    mediaCacheLimitGb: readStoredMediaCacheLimitGb(),
    queueAddBehavior: readStoredQueueAddBehavior(),
    autoPlayOnLaunch: getStoredBoolean(AUTO_PLAY_ON_LAUNCH_KEY, false),
    enableTranscodeFallback: getStoredBoolean(
        ENABLE_TRANSCODE_FALLBACK_KEY,
        typeof window !== 'undefined' && Boolean(window.electron?.requestTranscodeFallback),
    ),
    // Off unless asked for: it writes to the listener's music account, so it is never a default.
    neteaseScrobbleEnabled: getStoredBoolean(NETEASE_SCROBBLE_KEY, false),
    playbackFadeEnabled: getStoredBoolean(PLAYBACK_FADE_KEY, true),
    // Off unless asked for: skipping a song the listener picked is not something to do by default.
    autoSkipUnplayable: getStoredBoolean(AUTO_SKIP_UNPLAYABLE_KEY, false),
    audioOutputDeviceId: readStoredAudioOutputDeviceId(),
    audioEqualizerSettings: readStoredAudioEqualizerSettings(),
    isAudioEqualizerOpen: false,
    volume: readStoredVolume(),
    isMuted: getStoredBoolean('player_is_muted', false),
    loopMode: readStoredLoopMode(),
    shuffleEnabled: readStoredShuffleEnabled(),
    heartbeatEnabled: false,
    heartbeatInterval: readStoredHeartbeatInterval(),
    setAudioQuality: (quality) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('default_audio_quality', quality);
        }
        set({ audioQuality: quality });
    },
    handleToggleMediaCache: (enable) => {
        setStoredBoolean(ENABLE_MEDIA_CACHE_KEY, enable);
        set({ enableMediaCache: enable });
    },
    handleSetMediaCacheLimitGb: (gigabytes) => {
        const next = Number.isFinite(gigabytes) && gigabytes >= 0 ? gigabytes : DEFAULT_MEDIA_CACHE_LIMIT_GB;
        if (typeof window !== 'undefined') {
            localStorage.setItem(MEDIA_CACHE_LIMIT_GB_KEY, String(next));
        }
        set({ mediaCacheLimitGb: next });
    },
    handleSetHeartbeatInterval: (interval) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(HEARTBEAT_INTERVAL_KEY, String(interval));
        }
        set({ heartbeatInterval: interval });
    },
    handleSetQueueAddBehavior: (behavior) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('queue_add_behavior', behavior);
        }
        set({ queueAddBehavior: behavior });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (behavior === 'next' ? 'queueInsertNext' : 'queueAppend')),
        });
    },
    handleToggleAutoPlayOnLaunch: (enable) => {
        setStoredBoolean(AUTO_PLAY_ON_LAUNCH_KEY, enable);
        set({ autoPlayOnLaunch: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'autoPlayOnLaunchOn' : 'autoPlayOnLaunchOff')),
        });
    },
    handleToggleTranscodeFallback: (enable) => {
        setStoredBoolean(ENABLE_TRANSCODE_FALLBACK_KEY, enable);
        set({ enableTranscodeFallback: enable });
    },
    handleToggleNeteaseScrobble: (enable) => {
        setStoredBoolean(NETEASE_SCROBBLE_KEY, enable);
        set({ neteaseScrobbleEnabled: enable });
    },
    handleTogglePlaybackFade: (enable) => {
        setStoredBoolean(PLAYBACK_FADE_KEY, enable);
        set({ playbackFadeEnabled: enable });
    },
    handleToggleAutoSkipUnplayable: (enable) => {
        setStoredBoolean(AUTO_SKIP_UNPLAYABLE_KEY, enable);
        set({ autoSkipUnplayable: enable });
    },
    handleSetAudioOutputDeviceId: (deviceId) => {
        set({ audioOutputDeviceId: deviceId });
        if (typeof window === 'undefined') {
            return;
        }

        if (deviceId) {
            localStorage.setItem('audio_output_device_id', deviceId);
        } else {
            localStorage.removeItem('audio_output_device_id');
        }
    },
    handleSetAudioEqualizerSettings: (settings) => {
        const resolved = resolveAudioEqualizerSettings(settings);
        writeStoredAudioEqualizerSettings(resolved);
        set({ audioEqualizerSettings: resolved });
    },
    // Applies a built-in sound preset or a saved custom slot, and turns processing on.
    handleApplyAudioSoundPreset: (modeId) => {
        const current = get().audioEqualizerSettings;
        const source = isAudioEqualizerCustomSlotId(modeId)
            ? current.customSlots[getAudioEqualizerCustomSlotIndex(modeId)]
            : AUDIO_SOUND_PRESETS[modeId];
        if (!source) {
            return;
        }

        const resolved = resolveAudioEqualizerSettings({
            ...current,
            enabled: true,
            preset: modeId,
            gains: [...source.gains],
            effects: { ...source.effects },
        });
        writeStoredAudioEqualizerSettings(resolved);
        set({ audioEqualizerSettings: resolved });
    },
    openAudioEqualizer: () => set({ isAudioEqualizerOpen: true }),
    closeAudioEqualizer: () => set({ isAudioEqualizerOpen: false }),
    handleSetVolume: (val) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('player_volume', String(val));
        }
        set({ volume: val });
    },
    // The toggles below delegate to these setters, so persistence and the toast live in one place
    // (Folium's playback.setMuted / setLoopMode call the setters directly).
    handleSetMuted: (muted) => {
        if (muted === get().isMuted) {
            return;
        }
        setStoredBoolean('player_is_muted', muted);
        set({ isMuted: muted });
    },
    handleToggleMute: () => {
        get().handleSetMuted(!get().isMuted);
    },
    handleSetLoopMode: (mode) => {
        // 模组等外部调用设的是三态循环:同时关掉随机与心动(它们都叠在列表循环之上)
        const { loopMode, shuffleEnabled, heartbeatEnabled } = get();
        if (mode === loopMode && !shuffleEnabled && !heartbeatEnabled) {
            return;
        }
        if (typeof window !== 'undefined') {
            localStorage.setItem('player_loop_mode', mode);
            localStorage.setItem('player_shuffle', 'false');
        }
        set({ loopMode: mode, shuffleEnabled: false, heartbeatEnabled: false });
        const loopModeKey = mode === 'off' ? 'loopOff' : mode === 'one' ? 'loopOne' : 'loopAll';
        setStatusMessage({
            type: 'success',
            text: i18n.t(`player.${loopModeKey}`),
            nonce: Date.now(),
        });
    },
    setLoopDisplayMode: (mode, options) => {
        const nextLoop = mode === 'shuffle' || mode === 'heartbeat' ? 'all' : mode;
        const nextShuffle = mode === 'shuffle';
        const nextHeartbeat = mode === 'heartbeat';
        if (options?.persist !== false && typeof window !== 'undefined') {
            localStorage.setItem('player_loop_mode', nextLoop);
            localStorage.setItem('player_shuffle', String(nextShuffle));
        }
        set({ loopMode: nextLoop, shuffleEnabled: nextShuffle, heartbeatEnabled: nextHeartbeat });
    },
    // 五态循环:关闭 → 列表循环 → 单曲循环 → 随机 →(心动,仅在播放网易云「我喜欢的音乐」时)→ 关闭。
    // 随机 = 列表循环 + shuffleEnabled;心动 = 列表循环 + heartbeatEnabled(不落盘,重启后回到列表循环)。
    handleToggleLoopMode: () => {
        const { loopMode: prev, shuffleEnabled: wasShuffle, heartbeatEnabled: wasHeartbeat } = get();
        const current: LoopDisplayMode = wasShuffle ? 'shuffle' : wasHeartbeat ? 'heartbeat' : prev;
        const nextMode = nextLoopDisplayMode(current, resolveHeartbeatAvailable());
        // 遥控页没有本地播放:把下一个模式发给 Host,本页先乐观地显示,之后由镜像校正
        if (isStageRemoteMode()) {
            get().setLoopDisplayMode(nextMode, { persist: false });
            void remoteSetLoopMode(nextMode).catch(() => undefined);
            return;
        }
        get().setLoopDisplayMode(nextMode);
        const loopModeKey = nextMode === 'shuffle' ? 'loopShuffle'
            : nextMode === 'heartbeat' ? 'loopHeartbeat'
                : nextMode === 'off' ? 'loopOff' : nextMode === 'one' ? 'loopOne' : 'loopAll';
        setStatusMessage({
            type: 'success',
            text: i18n.t(`player.${loopModeKey}`),
            nonce: Date.now(),
        });
    },
}));

/**
 * The AudioSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectAudioSettingsSnapshot = (state: AudioSettingsState) => ({
    audioQuality: state.audioQuality,
    enableMediaCache: state.enableMediaCache,
    mediaCacheLimitGb: state.mediaCacheLimitGb,
    queueAddBehavior: state.queueAddBehavior,
    autoPlayOnLaunch: state.autoPlayOnLaunch,
    enableTranscodeFallback: state.enableTranscodeFallback,
    neteaseScrobbleEnabled: state.neteaseScrobbleEnabled,
    playbackFadeEnabled: state.playbackFadeEnabled,
    autoSkipUnplayable: state.autoSkipUnplayable,
    audioOutputDeviceId: state.audioOutputDeviceId,
    audioEqualizerSettings: state.audioEqualizerSettings,
    isAudioEqualizerOpen: state.isAudioEqualizerOpen,
    volume: state.volume,
    isMuted: state.isMuted,
    loopMode: state.loopMode,
    setAudioQuality: state.setAudioQuality,
    handleToggleMediaCache: state.handleToggleMediaCache,
    handleSetMediaCacheLimitGb: state.handleSetMediaCacheLimitGb,
    handleSetQueueAddBehavior: state.handleSetQueueAddBehavior,
    handleSetHeartbeatInterval: state.handleSetHeartbeatInterval,
    handleToggleAutoPlayOnLaunch: state.handleToggleAutoPlayOnLaunch,
    handleToggleTranscodeFallback: state.handleToggleTranscodeFallback,
    handleToggleNeteaseScrobble: state.handleToggleNeteaseScrobble,
    handleTogglePlaybackFade: state.handleTogglePlaybackFade,
    handleToggleAutoSkipUnplayable: state.handleToggleAutoSkipUnplayable,
    handleSetAudioOutputDeviceId: state.handleSetAudioOutputDeviceId,
    handleSetAudioEqualizerSettings: state.handleSetAudioEqualizerSettings,
    handleApplyAudioSoundPreset: state.handleApplyAudioSoundPreset,
    openAudioEqualizer: state.openAudioEqualizer,
    closeAudioEqualizer: state.closeAudioEqualizer,
    handleSetVolume: state.handleSetVolume,
    handleToggleMute: state.handleToggleMute,
    handleToggleLoopMode: state.handleToggleLoopMode,
});

// Module-level handles for the assembly layer; actions need no subscription, so importing them
// where they are used keeps App.tsx out of the chain (see setStatusMessage).
export const handleSetVolume = (val: number) => useAudioSettingsStore.getState().handleSetVolume(val);
export const handleToggleMute = () => useAudioSettingsStore.getState().handleToggleMute();
export const setAudioQuality = (quality: AudioQuality) => useAudioSettingsStore.getState().setAudioQuality(quality);
