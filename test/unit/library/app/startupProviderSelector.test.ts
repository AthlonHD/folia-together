import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineProviderId } from '@/types/onlineMusic';
import {
    startStartupProviderSelection,
    STARTUP_PROVIDER_SETTLE_MS,
    STARTUP_PROVIDER_WAIT_MS,
    type StartupProviderStore,
} from '@/library/app/startupProviderSelector';
import type { StartupAccountState } from '@/library/core/model/startupProvider';

// 启动时默认平台的选择时序:账号状态在启动瞬间会抖动,不能被瞬间的"未登录"带偏。

type Accounts = Record<string, StartupAccountState | undefined>;

const ready = (status: StartupAccountState['status']): StartupAccountState => ({ status, hydration: 'ready' });
const loading: StartupAccountState = { status: 'unknown', hydration: 'loading' };

const createStore = (initial: OnlineProviderId = 'netease') => {
    const listeners = new Set<() => void>();
    const state = {
        activeProviderId: initial,
        accounts: {} as Accounts,
        setActiveProviderId: vi.fn((providerId: OnlineProviderId) => {
            state.activeProviderId = providerId;
            listeners.forEach(listener => listener());
        }),
    };
    const store: StartupProviderStore = {
        getState: () => state,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const update = (accounts: Accounts) => {
        state.accounts = { ...state.accounts, ...accounts };
        listeners.forEach(listener => listener());
    };
    return { store, state, update };
};

const start = (store: StartupProviderStore) => startStartupProviderSelection({
    store,
    listCandidates: () => ['netease', 'qq', 'kugou'],
});

describe('startup provider selection timing', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('opens netease straight away when it has an account', () => {
        const { store, state, update } = createStore();
        start(store);
        update({ netease: ready('authenticated'), qq: ready('authenticated') });
        expect(state.activeProviderId).toBe('netease');
        expect(state.setActiveProviderId).not.toHaveBeenCalled();
    });

    it('is not misled by netease briefly looking signed out while qq is already signed in', () => {
        const { store, state, update } = createStore();
        start(store);
        update({ qq: ready('authenticated'), kugou: ready('anonymous') });
        // 启动瞬间:网易云先短暂地是"未登录"
        update({ netease: ready('anonymous') });
        vi.advanceTimersByTime(STARTUP_PROVIDER_SETTLE_MS - 500);
        // 用户信息随后才到
        update({ netease: ready('authenticated') });
        vi.advanceTimersByTime(STARTUP_PROVIDER_SETTLE_MS * 2);
        expect(state.activeProviderId).toBe('netease');
        expect(state.setActiveProviderId).not.toHaveBeenCalledWith('qq');
    });

    it('moves on to qq only after the state has stayed put, and goes back up if netease signs in later', () => {
        const { store, state, update } = createStore();
        start(store);
        update({ netease: ready('anonymous'), qq: ready('authenticated'), kugou: ready('anonymous') });
        expect(state.activeProviderId).toBe('netease');
        vi.advanceTimersByTime(STARTUP_PROVIDER_SETTLE_MS);
        expect(state.activeProviderId).toBe('qq');
        update({ netease: ready('authenticated') });
        expect(state.activeProviderId).toBe('netease');
    });

    it('stays on netease when nobody is signed in', () => {
        const { store, state, update } = createStore();
        start(store);
        update({ netease: ready('anonymous'), qq: ready('anonymous'), kugou: ready('anonymous') });
        vi.advanceTimersByTime(STARTUP_PROVIDER_WAIT_MS * 2);
        expect(state.activeProviderId).toBe('netease');
        expect(state.setActiveProviderId).not.toHaveBeenCalled();
    });

    it('does not fight a platform the user picked by hand', () => {
        const { store, state, update } = createStore();
        start(store);
        update({ netease: loading, qq: ready('authenticated') });
        state.setActiveProviderId('kugou');
        update({ netease: ready('authenticated') });
        vi.advanceTimersByTime(STARTUP_PROVIDER_WAIT_MS * 2);
        expect(state.activeProviderId).toBe('kugou');
    });

    it('treats a platform that never answered as having no account after the wait', () => {
        const { store, state, update } = createStore();
        start(store);
        update({ netease: loading, qq: ready('authenticated') });
        expect(state.activeProviderId).toBe('netease');
        vi.advanceTimersByTime(STARTUP_PROVIDER_WAIT_MS + 200);
        expect(state.activeProviderId).toBe('qq');
    });

    it('stops listening once the returned stop function is called', () => {
        const { store, state, update } = createStore();
        const stop = start(store);
        stop();
        update({ netease: ready('anonymous'), qq: ready('authenticated') });
        vi.advanceTimersByTime(STARTUP_PROVIDER_WAIT_MS * 2);
        expect(state.activeProviderId).toBe('netease');
    });
});
