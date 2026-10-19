// src/stores/usePassthroughSettingsStore.ts
// Settings of pass-through playback (Windows desktop app): on/off, which endpoint the sound goes to, and how the output rate is chosen.
//
// The sound itself is played by the separate WASAPI helper (see src/services/passthrough/), so none of
// the web audio effects apply while this is on.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';
import type { PassthroughOutputMode, PassthroughRateStrategy } from '../services/passthrough/types';

export const PASSTHROUGH_ENABLED_STORAGE_KEY = 'passthrough_enabled';
export const PASSTHROUGH_DEVICE_STORAGE_KEY = 'passthrough_device_id';
export const PASSTHROUGH_RATE_STRATEGY_STORAGE_KEY = 'passthrough_rate_strategy';
export const PASSTHROUGH_FIXED_RATE_STORAGE_KEY = 'passthrough_fixed_rate';
export const PASSTHROUGH_MODE_STORAGE_KEY = 'passthrough_mode';

export const PASSTHROUGH_FIXED_RATES = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000] as const;
export const DEFAULT_PASSTHROUGH_FIXED_RATE = 192000;

const readRateStrategy = (): PassthroughRateStrategy => (
    getStoredString(PASSTHROUGH_RATE_STRATEGY_STORAGE_KEY, 'native') === 'fixed' ? 'fixed' : 'native'
);

const readMode = (): PassthroughOutputMode => (
    getStoredString(PASSTHROUGH_MODE_STORAGE_KEY, 'exclusive') === 'shared' ? 'shared' : 'exclusive'
);

const readFixedRate = (): number => {
    const stored = Number(getStoredString(PASSTHROUGH_FIXED_RATE_STORAGE_KEY, String(DEFAULT_PASSTHROUGH_FIXED_RATE)));
    return (PASSTHROUGH_FIXED_RATES as readonly number[]).includes(stored) ? stored : DEFAULT_PASSTHROUGH_FIXED_RATE;
};

const writeString = (key: string, value: string) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
    }
};

interface PassthroughSettingsState {
    passthroughEnabled: boolean;
    /** WASAPI endpoint id; empty means the system default render device. */
    passthroughDeviceId: string;
    passthroughRateStrategy: PassthroughRateStrategy;
    passthroughFixedRate: number;
    passthroughMode: PassthroughOutputMode;
    handleTogglePassthrough: (enabled: boolean) => void;
    handleSetPassthroughDevice: (deviceId: string) => void;
    handleSetPassthroughRateStrategy: (strategy: PassthroughRateStrategy) => void;
    handleSetPassthroughFixedRate: (rate: number) => void;
    handleSetPassthroughMode: (mode: PassthroughOutputMode) => void;
}

export const usePassthroughSettingsStore = create<PassthroughSettingsState>((set) => ({
    passthroughEnabled: getStoredBoolean(PASSTHROUGH_ENABLED_STORAGE_KEY, false),
    passthroughDeviceId: getStoredString(PASSTHROUGH_DEVICE_STORAGE_KEY, ''),
    passthroughRateStrategy: readRateStrategy(),
    passthroughFixedRate: readFixedRate(),
    passthroughMode: readMode(),
    handleTogglePassthrough: (enabled) => {
        setStoredBoolean(PASSTHROUGH_ENABLED_STORAGE_KEY, enabled);
        set({ passthroughEnabled: enabled });
    },
    handleSetPassthroughDevice: (deviceId) => {
        writeString(PASSTHROUGH_DEVICE_STORAGE_KEY, deviceId);
        set({ passthroughDeviceId: deviceId });
    },
    handleSetPassthroughRateStrategy: (strategy) => {
        writeString(PASSTHROUGH_RATE_STRATEGY_STORAGE_KEY, strategy);
        set({ passthroughRateStrategy: strategy });
    },
    handleSetPassthroughFixedRate: (rate) => {
        writeString(PASSTHROUGH_FIXED_RATE_STORAGE_KEY, String(rate));
        set({ passthroughFixedRate: rate });
    },
    handleSetPassthroughMode: (mode) => {
        writeString(PASSTHROUGH_MODE_STORAGE_KEY, mode);
        set({ passthroughMode: mode });
    },
}));
