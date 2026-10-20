// src/stores/useSearchSettingsStore.ts
// Settings of the search page: the order of its source tabs, and whether the platform in use always comes first.

import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { normalizeSearchSourceOrder } from '../utils/searchSourceOrder';

export const SEARCH_SOURCE_ORDER_STORAGE_KEY = 'search_source_order';
export const SEARCH_CURRENT_FIRST_STORAGE_KEY = 'search_current_first';

const readOrder = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        return normalizeSearchSourceOrder(JSON.parse(localStorage.getItem(SEARCH_SOURCE_ORDER_STORAGE_KEY) || 'null'));
    } catch {
        return [];
    }
};

interface SearchSettingsState {
    /** Source ids in the order the user wants; empty means the page's own order. */
    searchSourceOrder: string[];
    /** The platform in use is the first tab whatever the order says (how the page always was). */
    searchCurrentSourceFirst: boolean;
    handleSetSearchSourceOrder: (order: string[]) => void;
    handleToggleSearchCurrentSourceFirst: (value: boolean) => void;
}

export const useSearchSettingsStore = create<SearchSettingsState>((set) => ({
    searchSourceOrder: readOrder(),
    searchCurrentSourceFirst: getStoredBoolean(SEARCH_CURRENT_FIRST_STORAGE_KEY, true),
    handleSetSearchSourceOrder: (order) => {
        const next = normalizeSearchSourceOrder(order);
        if (typeof window !== 'undefined') {
            localStorage.setItem(SEARCH_SOURCE_ORDER_STORAGE_KEY, JSON.stringify(next));
        }
        set({ searchSourceOrder: next });
    },
    handleToggleSearchCurrentSourceFirst: (value) => {
        setStoredBoolean(SEARCH_CURRENT_FIRST_STORAGE_KEY, value);
        set({ searchCurrentSourceFirst: value });
    },
}));
