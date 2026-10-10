import type { OnlineProviderId } from '../../types/onlineMusic';
import { getFromCache, saveToCache } from '../db';
import { isStageRemoteMode, SHARED_ACCOUNT_MARKER } from '../stageMode';

// src/services/onlineMusic/providerStorage.ts

// 遥控模式与本机模式的账号、账号缓存互相独立:遥控页用的是服务器 Host 的账号(占位登录态 + Host 的资料缓存),
// 本机模式是本设备自己登录的账号,两边不能写进同一个键。前缀保持 online_provider_ 开头,缓存分类规则不受影响。
export const getProviderCacheKey = (providerId: OnlineProviderId, key: string): string => (
    `online_provider_${isStageRemoteMode() ? 'remote_' : ''}${providerId}_${key}`
);

export const getProviderSessionKey = (providerId: OnlineProviderId, key: string): string => (
    `online_provider${isStageRemoteMode() ? '@remote' : ''}:${providerId}:${key}`
);

// Reads an old unscoped cache once, then stores the value in the provider namespace.
export const getProviderCacheWithLegacyMigration = async <T>(
    providerId: OnlineProviderId,
    key: string,
    legacyKeys: string[] = [],
): Promise<T | null> => {
    const namespacedKey = getProviderCacheKey(providerId, key);
    const current = await getFromCache<T>(namespacedKey);
    if (current != null) return current;

    for (const legacyKey of legacyKeys) {
        const legacy = await getFromCache<T>(legacyKey);
        if (legacy == null) continue;
        await saveToCache(namespacedKey, legacy);
        return legacy;
    }
    return null;
};

export const readProviderSessionValue = (
    providerId: OnlineProviderId,
    key: string,
    legacyKeys: string[] = [],
): string | null => {
    if (typeof localStorage === 'undefined') return null;
    const namespacedKey = getProviderSessionKey(providerId, key);
    const current = localStorage.getItem(namespacedKey);
    if (current != null) {
        // 旧版本把遥控页的占位登录态写进过不分模式的存储;本机模式读到它不能当成自己的账号
        if (!isStageRemoteMode() && current.includes(SHARED_ACCOUNT_MARKER)) {
            localStorage.removeItem(namespacedKey);
            return null;
        }
        return current;
    }
    // 旧的不分平台的键属于本机自己的账号,遥控模式不能把它迁进来
    if (isStageRemoteMode()) return null;

    for (const legacyKey of legacyKeys) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy == null) continue;
        localStorage.setItem(namespacedKey, legacy);
        return legacy;
    }
    return null;
};

export const writeProviderSessionValue = (providerId: OnlineProviderId, key: string, value: string): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(getProviderSessionKey(providerId, key), value);
};

export const removeProviderSessionValue = (
    providerId: OnlineProviderId,
    key: string,
    legacyKeys: string[] = [],
): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(getProviderSessionKey(providerId, key));
    if (isStageRemoteMode()) return;
    legacyKeys.forEach(legacyKey => localStorage.removeItem(legacyKey));
};
