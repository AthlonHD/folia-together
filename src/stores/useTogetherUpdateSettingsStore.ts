// src/stores/useTogetherUpdateSettingsStore.ts
// Whether the desktop app asks the fork's release page for a newer build when it starts (the check itself is electron/togetherUpdate).

import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

export const TOGETHER_UPDATE_AUTO_CHECK_STORAGE_KEY = 'together_update_auto_check';

interface TogetherUpdateSettingsState {
    togetherUpdateAutoCheck: boolean;
    handleToggleTogetherUpdateAutoCheck: (enabled: boolean) => void;
}

export const useTogetherUpdateSettingsStore = create<TogetherUpdateSettingsState>((set) => ({
    togetherUpdateAutoCheck: getStoredBoolean(TOGETHER_UPDATE_AUTO_CHECK_STORAGE_KEY, true),
    handleToggleTogetherUpdateAutoCheck: (enabled) => {
        setStoredBoolean(TOGETHER_UPDATE_AUTO_CHECK_STORAGE_KEY, enabled);
        set({ togetherUpdateAutoCheck: enabled });
    },
}));
