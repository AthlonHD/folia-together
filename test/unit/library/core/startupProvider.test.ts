import { describe, expect, it } from 'vitest';
import {
    orderStartupProviders,
    pickStartupProvider,
    type StartupAccountState,
} from '@/library/core/collection/startupProvider';

// 启动时默认平台:网易云 > QQ 音乐 > 酷狗,取第一个有账号的。

const ready = (status: StartupAccountState['status']): StartupAccountState => ({ status, hydration: 'ready' });
const loading: StartupAccountState = { status: 'unknown', hydration: 'loading' };
const candidates = ['kugou', 'qq', 'netease'];

describe('startup provider order', () => {
    it('puts netease, qq and kugou first, then the rest in their given order', () => {
        expect(orderStartupProviders(['bodian', 'kugou', 'mod', 'qq', 'netease'])).toEqual(['netease', 'qq', 'kugou', 'bodian', 'mod']);
        expect(orderStartupProviders(['qq', 'kugou'])).toEqual(['qq', 'kugou']);
    });
});

describe('pickStartupProvider', () => {
    it('picks netease when it has an account, whatever the others are', () => {
        expect(pickStartupProvider({
            candidates,
            accounts: { netease: ready('authenticated'), qq: ready('authenticated'), kugou: ready('authenticated') },
            timedOut: false,
        })).toEqual({ kind: 'select', providerId: 'netease' });
    });

    it('falls through to qq, then kugou, by who actually has an account', () => {
        expect(pickStartupProvider({
            candidates,
            accounts: { netease: ready('anonymous'), qq: ready('authenticated'), kugou: ready('authenticated') },
            timedOut: false,
        })).toEqual({ kind: 'select', providerId: 'qq' });
        expect(pickStartupProvider({
            candidates,
            accounts: { netease: ready('anonymous'), qq: ready('error'), kugou: ready('authenticated') },
            timedOut: false,
        })).toEqual({ kind: 'select', providerId: 'kugou' });
    });

    it('stays on netease when nobody is signed in', () => {
        expect(pickStartupProvider({
            candidates,
            accounts: { netease: ready('anonymous'), qq: ready('anonymous'), kugou: ready('anonymous') },
            timedOut: false,
        })).toEqual({ kind: 'stay' });
    });

    it('waits for a higher-priority provider instead of skipping past it', () => {
        expect(pickStartupProvider({
            candidates,
            accounts: { netease: loading, qq: ready('authenticated') },
            timedOut: false,
        })).toEqual({ kind: 'wait' });
        // 还没有任何账户记录同样是"没出来"
        expect(pickStartupProvider({ candidates, accounts: {}, timedOut: false })).toEqual({ kind: 'wait' });
    });

    it('treats a provider that never answered as having no account once the wait times out', () => {
        expect(pickStartupProvider({
            candidates,
            accounts: { netease: loading, qq: ready('authenticated') },
            timedOut: true,
        })).toEqual({ kind: 'select', providerId: 'qq' });
        expect(pickStartupProvider({ candidates, accounts: {}, timedOut: true })).toEqual({ kind: 'stay' });
    });

    it('ignores providers that are not candidates (not configured here)', () => {
        expect(pickStartupProvider({
            candidates: ['qq'],
            accounts: { netease: ready('authenticated'), qq: ready('authenticated') },
            timedOut: false,
        })).toEqual({ kind: 'select', providerId: 'qq' });
    });
});
