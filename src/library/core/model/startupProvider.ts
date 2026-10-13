import type { OnlineProviderId } from '../../../types/onlineMusic';

// src/library/core/model/startupProvider.ts
// 启动时默认打开哪个平台:不看上次用的是哪个,按固定优先级(网易云 > QQ 音乐 > 酷狗 > 其他),
// 取第一个有账号(已登录)的;一个都没登录就留在网易云。纯规则,账户状态由调用方读好传进来。

export const STARTUP_PROVIDER_PRIORITY: readonly OnlineProviderId[] = ['netease', 'qq', 'kugou'];

export type StartupAccountState = {
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    hydration: 'loading' | 'ready';
};

export type StartupProviderDecision =
    | { kind: 'wait' }
    | { kind: 'select'; providerId: OnlineProviderId }
    | { kind: 'stay' };

export const orderStartupProviders = (candidates: readonly OnlineProviderId[]): OnlineProviderId[] => [
    ...STARTUP_PROVIDER_PRIORITY.filter(providerId => candidates.includes(providerId)),
    ...candidates.filter(providerId => !STARTUP_PROVIDER_PRIORITY.includes(providerId)),
];

const isSettled = (account: StartupAccountState | undefined): boolean => (
    Boolean(account) && account!.status !== 'unknown' && account!.hydration !== 'loading'
);

/**
 * 按优先级逐个看:前面的平台账户状态还没出来就等(不能越过它直接选后面的);出来了且已登录就选它;
 * 没登录就看下一个。超时后还没出来的按"没有账号"处理,免得一个迟迟不响应的平台卡住整个选择。
 */
export const pickStartupProvider = ({
    candidates,
    accounts,
    timedOut,
}: {
    candidates: readonly OnlineProviderId[];
    accounts: Readonly<Record<string, StartupAccountState | undefined>>;
    timedOut: boolean;
}): StartupProviderDecision => {
    for (const providerId of orderStartupProviders(candidates)) {
        const account = accounts[providerId];
        if (!isSettled(account)) {
            if (timedOut) continue;
            return { kind: 'wait' };
        }
        if (account!.status === 'authenticated') return { kind: 'select', providerId };
    }
    return { kind: 'stay' };
};
