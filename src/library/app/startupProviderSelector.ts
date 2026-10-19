import type { OnlineProviderId } from '../../types/onlineMusic';
import {
    orderStartupProviders,
    pickStartupProvider,
    type StartupAccountState,
} from '../core/collection/startupProvider';

// src/library/app/startupProviderSelector.ts
// 启动时默认打开哪个平台:按 网易云 > QQ 音乐 > 酷狗 的优先级取第一个有账号的(startupProvider)。
// 只在启动后的一小段时间里做,用户自己切过平台就让位;之后切换完全由用户决定。
// 账号状态在启动瞬间会抖动(例如网易云先短暂地是"未登录",用户信息稍后才到),所以:
// - 优先级最高的那个有账号就立刻选它;
// - 要选更靠后的平台,必须等账户状态安静一小段时间再确认,免得被那个瞬间状态带偏;
// - 启动窗口内,更高优先级的平台后来变成已登录,会再升回去。

/** 等各平台账户状态出来的最长时间,过了还没出来的按没有账号处理。 */
export const STARTUP_PROVIDER_WAIT_MS = 10_000;
/** 要选更靠后的平台之前,账户状态需要保持不变多久才算数。 */
export const STARTUP_PROVIDER_SETTLE_MS = 2_500;

export type StartupProviderStore = {
    getState: () => {
        activeProviderId: OnlineProviderId;
        accounts: Readonly<Record<string, StartupAccountState | undefined>>;
        setActiveProviderId: (providerId: OnlineProviderId) => void;
    };
    subscribe: (listener: () => void) => () => void;
};

/** 开始启动时的平台选择,返回停止函数。 */
export const startStartupProviderSelection = ({
    store,
    listCandidates,
    now = Date.now,
}: {
    store: StartupProviderStore;
    /** 当前可选的平台(已配置、遥控模式下还要 Host 能点播)。 */
    listCandidates: () => OnlineProviderId[];
    now?: () => number;
}): (() => void) => {
    let expectedProviderId = store.getState().activeProviderId;
    const startedAt = now();
    let finished = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: () => void = () => undefined;

    const finish = () => {
        if (finished) return;
        finished = true;
        unsubscribe();
        if (settleTimer) clearTimeout(settleTimer);
        if (endTimer) clearTimeout(endTimer);
    };
    const evaluate = () => {
        const candidates = listCandidates();
        const decision = pickStartupProvider({
            candidates,
            accounts: store.getState().accounts,
            timedOut: now() - startedAt >= STARTUP_PROVIDER_WAIT_MS,
        });
        return { decision, topPriority: orderStartupProviders(candidates)[0] };
    };
    const apply = (providerId: OnlineProviderId) => {
        const state = store.getState();
        if (providerId !== state.activeProviderId) {
            expectedProviderId = providerId;
            state.setActiveProviderId(providerId);
        }
    };
    const decide = () => {
        if (finished) return;
        // 当前平台不是我们设的、也不是启动时的那个:用户已经自己切了
        if (store.getState().activeProviderId !== expectedProviderId) {
            finish();
            return;
        }
        const { decision, topPriority } = evaluate();
        if (settleTimer) clearTimeout(settleTimer);
        if (decision.kind !== 'select') return;
        if (decision.providerId === topPriority) {
            apply(decision.providerId);
            finish();
            return;
        }
        settleTimer = setTimeout(() => {
            if (finished) return;
            const settled = evaluate().decision;
            if (settled.kind === 'select' && store.getState().activeProviderId === expectedProviderId) apply(settled.providerId);
        }, STARTUP_PROVIDER_SETTLE_MS);
    };

    unsubscribe = store.subscribe(decide);
    // 等满了:这时还没出来的平台按没有账号算,直接按结果定下来(不再等安静期)然后收工
    endTimer = setTimeout(() => {
        if (!finished && store.getState().activeProviderId === expectedProviderId) {
            const { decision } = evaluate();
            if (decision.kind === 'select') apply(decision.providerId);
        }
        finish();
    }, STARTUP_PROVIDER_WAIT_MS + 100);
    decide();
    return finish;
};
