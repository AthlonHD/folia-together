// src/services/hostSettingsSync.ts
// 遥控模式下"放什么、怎么放"的设置由 Host 说了算:音质、音量、均衡器、过渡/自动混音、
// 队列添加方式、回放增益、个性化电台模式、睡眠定时,以及听歌上报、媒体缓存、启动自动播放。
// 歌词主题、视觉效果这类只影响本页显示的设置不在这里,各页自己决定。
//
// 三个方向用同一张表:
// - Host:readAllHostSettings 放进快照发给遥控端;applyHostSettingsPatch 应用遥控端发来的修改。
// - 遥控端:applyMirroredHostSettings 把 Host 的值镜像进本页 store(不落盘);
//   startHostSettingsUplink 监听本页 store 的变化,把用户的修改发给 Host。

import { isHeartbeatInterval } from '../utils/heartbeatPlan';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { useAutomixSettingsStore } from '../stores/useAutomixSettingsStore';
import { usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useSleepTimerStore } from '../stores/useSleepTimerStore';
import { isTransitionMode } from './automix/transitionStrategy';

type HostSettingEntry = {
    read: () => unknown;
    /** 值合法才应用:遥控端发来的是网络输入,不能原样塞进 store。 */
    validate: (value: unknown) => boolean;
    /** Host 端应用:走各设置自己的 handler,照常落盘。 */
    hostApply: (value: any) => void;
    /** 遥控端镜像:只改内存状态,不落盘、不触发副作用。 */
    mirrorApply: (value: any) => void;
    /** 只由 Host 产生、遥控端不能修改的状态(比如睡眠定时的截止时间)。 */
    mirrorOnly?: boolean;
};

const audio = () => useAudioSettingsStore.getState();
const automix = () => useAutomixSettingsStore.getState();
const sleepTimer = () => useSleepTimerStore.getState();

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const ENTRIES: Record<string, HostSettingEntry> = {
    audioQuality: {
        read: () => audio().audioQuality,
        validate: value => value === 'standard' || value === 'high' || value === 'ultra' || value === 'lossless' || value === 'hires' || value === 'spatial' || value === 'master',
        hostApply: value => audio().setAudioQuality(value),
        mirrorApply: value => useAudioSettingsStore.setState({ audioQuality: value }),
    },
    volume: {
        read: () => audio().volume,
        validate: value => isFiniteNumber(value) && value >= 0 && value <= 1,
        hostApply: value => audio().handleSetVolume(value),
        mirrorApply: value => useAudioSettingsStore.setState({ volume: value }),
    },
    isMuted: {
        read: () => audio().isMuted,
        validate: isBoolean,
        hostApply: value => { if (audio().isMuted !== value) audio().handleToggleMute(); },
        mirrorApply: value => useAudioSettingsStore.setState({ isMuted: value }),
    },
    playbackFadeEnabled: {
        read: () => audio().playbackFadeEnabled,
        validate: isBoolean,
        hostApply: value => audio().handleTogglePlaybackFade(value),
        mirrorApply: value => useAudioSettingsStore.setState({ playbackFadeEnabled: value }),
    },
    audioEqualizerSettings: {
        read: () => audio().audioEqualizerSettings,
        validate: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
        hostApply: value => audio().handleSetAudioEqualizerSettings(value),
        mirrorApply: value => useAudioSettingsStore.setState({ audioEqualizerSettings: value }),
    },
    neteaseScrobbleEnabled: {
        read: () => audio().neteaseScrobbleEnabled,
        validate: isBoolean,
        hostApply: value => audio().handleToggleNeteaseScrobble(value),
        mirrorApply: value => useAudioSettingsStore.setState({ neteaseScrobbleEnabled: value }),
    },
    enableMediaCache: {
        read: () => audio().enableMediaCache,
        validate: isBoolean,
        hostApply: value => audio().handleToggleMediaCache(value),
        mirrorApply: value => useAudioSettingsStore.setState({ enableMediaCache: value }),
    },
    mediaCacheLimitGb: {
        read: () => audio().mediaCacheLimitGb,
        validate: value => isFiniteNumber(value) && value >= 0 && value <= 10000,
        hostApply: value => audio().handleSetMediaCacheLimitGb(value),
        mirrorApply: value => useAudioSettingsStore.setState({ mediaCacheLimitGb: value }),
    },
    autoPlayOnLaunch: {
        read: () => audio().autoPlayOnLaunch,
        validate: isBoolean,
        hostApply: value => audio().handleToggleAutoPlayOnLaunch(value),
        mirrorApply: value => useAudioSettingsStore.setState({ autoPlayOnLaunch: value }),
    },
    queueAddBehavior: {
        read: () => audio().queueAddBehavior,
        validate: value => value === 'append' || value === 'next',
        hostApply: value => audio().handleSetQueueAddBehavior(value),
        mirrorApply: value => useAudioSettingsStore.setState({ queueAddBehavior: value }),
    },
    heartbeatInterval: {
        read: () => audio().heartbeatInterval,
        validate: isHeartbeatInterval,
        hostApply: value => audio().handleSetHeartbeatInterval(value),
        mirrorApply: value => useAudioSettingsStore.setState({ heartbeatInterval: value }),
    },
    replayGainMode: {
        read: () => usePlaybackStore.getState().replayGainMode,
        validate: value => typeof value === 'string' && value.length > 0 && value.length < 32,
        hostApply: value => usePlaybackStore.getState().setReplayGainMode(value),
        mirrorApply: value => usePlaybackStore.getState().setReplayGainMode(value),
    },
    automixEnabled: {
        read: () => automix().automixEnabled,
        validate: isBoolean,
        hostApply: value => automix().handleToggleAutomix(value),
        mirrorApply: value => useAutomixSettingsStore.setState({ automixEnabled: value }),
    },
    transitionMode: {
        read: () => automix().transitionMode,
        validate: isTransitionMode,
        hostApply: value => automix().handleSetTransitionMode(value),
        mirrorApply: value => useAutomixSettingsStore.setState({ transitionMode: value }),
    },
    crossfadeMaxSec: {
        read: () => automix().crossfadeMaxSec,
        validate: isFiniteNumber,
        hostApply: value => automix().handleSetCrossfadeMaxSec(value),
        mirrorApply: value => useAutomixSettingsStore.setState({ crossfadeMaxSec: value }),
    },
    transitionPerformance: {
        read: () => automix().transitionPerformance,
        validate: isBoolean,
        hostApply: value => automix().handleToggleTransitionPerformance(value),
        mirrorApply: value => useAutomixSettingsStore.setState({ transitionPerformance: value }),
    },
    personalFmSelection: {
        read: () => usePersonalFmModeStore.getState().selection,
        validate: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
        hostApply: value => usePersonalFmModeStore.getState().setSelection(value),
        mirrorApply: value => usePersonalFmModeStore.setState({ selection: value }),
    },
    sleepTimerHours: {
        read: () => sleepTimer().sleepTimerHours,
        validate: value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 999,
        hostApply: value => sleepTimer().handleSetSleepTimerHours(value),
        mirrorApply: value => useSleepTimerStore.setState({ sleepTimerHours: value }),
    },
    sleepTimerMinutes: {
        read: () => sleepTimer().sleepTimerMinutes,
        validate: value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 59,
        hostApply: value => sleepTimer().handleSetSleepTimerMinutes(value),
        mirrorApply: value => useSleepTimerStore.setState({ sleepTimerMinutes: value }),
    },
    sleepTimerEnabled: {
        read: () => sleepTimer().sleepTimerEnabled,
        validate: isBoolean,
        hostApply: value => { if (sleepTimer().sleepTimerEnabled !== value) sleepTimer().handleToggleSleepTimer(value); },
        mirrorApply: value => useSleepTimerStore.setState({ sleepTimerEnabled: value }),
    },
    sleepTimerDeadlineMs: {
        read: () => sleepTimer().sleepTimerDeadlineMs,
        validate: value => value === null || isFiniteNumber(value),
        hostApply: () => undefined,
        mirrorApply: value => useSleepTimerStore.setState({ sleepTimerDeadlineMs: value }),
        mirrorOnly: true,
    },
};

/** 遥控端改了某项之后,这段时间内忽略 Host 回报的旧值,免得滑块被拉回去。 */
const MIRROR_HOLD_MS = 3000;
const UPLINK_DEBOUNCE_MS = 200;

const holdUntil: Record<string, number> = {};
let applyingMirror = false;

/** Host:当前所有需要同步的设置,放进快照。 */
export const readAllHostSettings = (): Record<string, unknown> => {
    const settings: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(ENTRIES)) {
        settings[key] = entry.read();
    }
    return settings;
};

/** Host:应用遥控端发来的修改。未知的键、值不合法的、只读的键一律忽略。 */
export const applyHostSettingsPatch = (patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
        const entry = ENTRIES[key];
        if (!entry || entry.mirrorOnly || !entry.validate(value)) continue;
        try {
            entry.hostApply(value);
        } catch (error) {
            console.warn(`[HostSettings] Failed to apply ${key}`, error);
        }
    }
};

/** 遥控端:把 Host 回报的设置镜像进本页 store(不落盘)。 */
export const applyMirroredHostSettings = (settings: Record<string, unknown>) => {
    const now = Date.now();
    for (const [key, value] of Object.entries(settings)) {
        const entry = ENTRIES[key];
        if (!entry || !entry.validate(value) || now < (holdUntil[key] ?? 0)) continue;
        if (JSON.stringify(entry.read()) === JSON.stringify(value)) continue;
        applyingMirror = true;
        try {
            entry.mirrorApply(value);
        } finally {
            applyingMirror = false;
        }
    }
};

/**
 * 遥控端:监听本页 store,用户改了同步项就合并成一份修改发给 Host。
 * 镜像造成的变化不算用户修改。返回取消监听的函数。
 */
export const startHostSettingsUplink = (send: (patch: Record<string, unknown>) => Promise<unknown>): (() => void) => {
    const keys = Object.keys(ENTRIES).filter(key => !ENTRIES[key].mirrorOnly);
    const lastSeen: Record<string, string> = {};
    for (const key of keys) lastSeen[key] = JSON.stringify(ENTRIES[key].read());

    let pending: Record<string, unknown> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
        timer = null;
        const patch = pending;
        pending = {};
        if (Object.keys(patch).length > 0) {
            void send(patch).catch(error => console.warn('[HostSettings] Failed to send settings to host', error));
        }
    };

    const check = () => {
        for (const key of keys) {
            const value = ENTRIES[key].read();
            const serialized = JSON.stringify(value);
            if (serialized === lastSeen[key]) continue;
            lastSeen[key] = serialized;
            if (applyingMirror) continue;
            pending[key] = value;
            holdUntil[key] = Date.now() + MIRROR_HOLD_MS;
            if (!timer) timer = setTimeout(flush, UPLINK_DEBOUNCE_MS);
        }
    };

    const unsubscribers = [
        useAudioSettingsStore.subscribe(check),
        useAutomixSettingsStore.subscribe(check),
        usePlaybackStore.subscribe(check),
        usePersonalFmModeStore.subscribe(check),
        useSleepTimerStore.subscribe(check),
    ];

    return () => {
        unsubscribers.forEach(unsubscribe => unsubscribe());
        if (timer) clearTimeout(timer);
    };
};
