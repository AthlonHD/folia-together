// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredPlayTarget, isStageHostMode, isStageRemoteMode, isStageRelayAvailable } from '@/services/stageMode';
import { getProviderCacheKey, getProviderSessionKey, readProviderSessionValue } from '@/services/onlineMusic/providerStorage';
import { installRemoteStorageShield } from '@/services/remoteStorageShield';

// 遥控 / 本机 / Host 三种运行方式的判定,以及遥控模式与本机模式的账号存储互相独立。

const setUrl = (search: string) => window.history.replaceState({}, '', `/${search}`);

describe('stage play mode resolution', () => {
    beforeEach(() => {
        localStorage.clear();
        setUrl('');
        vi.stubEnv('VITE_STAGE_RELAY', '1');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        setUrl('');
    });

    it('defaults to remote control when a relay is configured', () => {
        expect(isStageRemoteMode()).toBe(true);
        expect(getStoredPlayTarget()).toBe('remote');
    });

    it('plays locally once the device chose local playback', () => {
        localStorage.setItem('folia_play_target', 'local');
        expect(isStageRemoteMode()).toBe(false);
    });

    it('lets URL flags override the stored choice without changing it', () => {
        localStorage.setItem('folia_play_target', 'local');
        setUrl('?stageremote=1');
        expect(isStageRemoteMode()).toBe(true);
        expect(getStoredPlayTarget()).toBe('local');
        localStorage.setItem('folia_play_target', 'remote');
        setUrl('?local=1');
        expect(isStageRemoteMode()).toBe(false);
    });

    it('never treats the host page as a remote', () => {
        setUrl('?host=1&stageremote=1');
        expect(isStageHostMode()).toBe(true);
        expect(isStageRemoteMode()).toBe(false);
    });

    it('is local without a relay, whatever was stored', () => {
        vi.stubEnv('VITE_STAGE_RELAY', '');
        localStorage.setItem('folia_play_target', 'remote');
        expect(isStageRelayAvailable()).toBe(false);
        expect(isStageRemoteMode()).toBe(false);
    });
});

describe('account storage per mode', () => {
    beforeEach(() => {
        localStorage.clear();
        setUrl('');
        vi.stubEnv('VITE_STAGE_RELAY', '1');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        setUrl('');
    });

    it('keeps remote and local session keys and cache keys apart', () => {
        const remoteSession = getProviderSessionKey('netease', 'cookie');
        const remoteCache = getProviderCacheKey('netease', 'user_profile');
        localStorage.setItem('folia_play_target', 'local');
        expect(getProviderSessionKey('netease', 'cookie')).not.toBe(remoteSession);
        expect(getProviderCacheKey('netease', 'user_profile')).not.toBe(remoteCache);
        // 缓存分类靠前缀与 _user_ 片段,遥控模式的键也要满足
        expect(remoteCache.startsWith('online_provider_')).toBe(true);
        expect(remoteCache.includes('_user_')).toBe(true);
    });

    it('does not migrate the device\'s own legacy cookie into remote mode', () => {
        localStorage.setItem('netease_cookie', 'MUSIC_U=mine');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBeNull();
        localStorage.setItem('folia_play_target', 'local');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBe('MUSIC_U=mine');
    });

    it('drops a leftover shared-account placeholder in local mode', () => {
        localStorage.setItem('folia_play_target', 'local');
        localStorage.setItem(getProviderSessionKey('netease', 'cookie'), 'MUSIC_U=shared-with-stage-host');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBeNull();
        expect(localStorage.getItem(getProviderSessionKey('netease', 'cookie'))).toBeNull();
    });
});

describe('remote storage shield', () => {
    it('drops writes to host-owned settings but not to appearance settings', () => {
        const proto = Storage.prototype;
        const originalSet = proto.setItem;
        const originalRemove = proto.removeItem;
        try {
            localStorage.clear();
            localStorage.setItem('player_volume', '0.4');
            installRemoteStorageShield();
            localStorage.setItem('player_volume', '1');
            localStorage.setItem('theme_animation_intensity', 'high');
            localStorage.removeItem('player_volume');
            expect(localStorage.getItem('player_volume')).toBe('0.4');
            expect(localStorage.getItem('theme_animation_intensity')).toBe('high');
            // sessionStorage 即使键名相同也不受影响
            sessionStorage.setItem('player_volume', '1');
            expect(sessionStorage.getItem('player_volume')).toBe('1');
        } finally {
            proto.setItem = originalSet;
            proto.removeItem = originalRemove;
            delete (proto as { __foliaRemoteShield?: boolean }).__foliaRemoteShield;
        }
    });
});
