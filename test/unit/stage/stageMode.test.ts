// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearStageToken,
    getStageAuthHeaders,
    getStageToken,
    getStoredPlayTarget,
    isStageHostMode,
    isStageRelayAvailable,
    isStageRemoteMode,
    saveStageToken,
    withStageTokenQuery,
} from '@/services/stageMode';
import { getProviderCacheKey, getProviderSessionKey, readProviderSessionValue } from '@/services/onlineMusic/providerStorage';
import { installRemoteStorageShield } from '@/services/remoteStorageShield';

// 遥控 / 本机 / Host 三种运行方式的判定、遥控所需的访问令牌,以及遥控模式与本机模式的账号存储互相独立。

const setUrl = (search: string) => window.history.replaceState({}, '', `/${search}`);
const chooseRemote = () => localStorage.setItem('folia_play_target', 'remote');

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

    it('plays on this device by default, even when a relay is configured', () => {
        expect(isStageRemoteMode()).toBe(false);
        expect(getStoredPlayTarget()).toBe('local');
    });

    it('is remote only after remote was chosen (which needs the host token)', () => {
        chooseRemote();
        expect(isStageRemoteMode()).toBe(true);
        localStorage.setItem('folia_play_target', 'local');
        expect(isStageRemoteMode()).toBe(false);
    });

    it('lets URL flags override the stored choice without changing it', () => {
        chooseRemote();
        setUrl('?local=1');
        expect(isStageRemoteMode()).toBe(false);
        expect(getStoredPlayTarget()).toBe('remote');
        localStorage.setItem('folia_play_target', 'local');
        setUrl('?stageremote=1');
        expect(isStageRemoteMode()).toBe(true);
        expect(getStoredPlayTarget()).toBe('local');
    });

    it('never treats the host page as a remote', () => {
        chooseRemote();
        setUrl('?host=1&stageremote=1');
        expect(isStageHostMode()).toBe(true);
        expect(isStageRemoteMode()).toBe(false);
    });

    it('is local without a relay, whatever was stored', () => {
        vi.stubEnv('VITE_STAGE_RELAY', '');
        chooseRemote();
        expect(isStageRelayAvailable()).toBe(false);
        expect(isStageRemoteMode()).toBe(false);
    });
});

describe('stage access token', () => {
    beforeEach(() => {
        localStorage.clear();
        setUrl('');
    });

    it('stores, reads and clears the token and builds the request helpers from it', () => {
        expect(getStageToken()).toBe('');
        expect(getStageAuthHeaders()).toEqual({});
        expect(withStageTokenQuery('/stage/local/cover/a')).toBe('/stage/local/cover/a');

        saveStageToken('abc123');
        expect(getStageToken()).toBe('abc123');
        expect(getStageAuthHeaders()).toEqual({ 'X-Stage-Token': 'abc123' });
        expect(withStageTokenQuery('/stage/local/cover/a')).toBe('/stage/local/cover/a?token=abc123');
        expect(withStageTokenQuery('/stage/local/cover/a?size=512')).toBe('/stage/local/cover/a?size=512&token=abc123');

        clearStageToken();
        expect(getStageToken()).toBe('');
    });

    it('turns a tokened address into remote mode, saves the token and strips it from the address bar', async () => {
        vi.resetModules();
        vi.stubEnv('VITE_STAGE_RELAY', '1');
        setUrl('?token=secret42&x=1');
        const mode = await import('@/services/stageMode');

        expect(mode.getStageToken()).toBe('secret42');
        expect(mode.getStoredPlayTarget()).toBe('remote');
        expect(mode.isStageRemoteMode()).toBe(true);
        expect(window.location.search).toBe('?x=1');
        vi.unstubAllEnvs();
    });

    it('keeps the host page out of remote mode but still remembers its token', async () => {
        vi.resetModules();
        vi.stubEnv('VITE_STAGE_RELAY', '1');
        setUrl('?host=1&token=hosttoken');
        const mode = await import('@/services/stageMode');

        expect(mode.getStageToken()).toBe('hosttoken');
        expect(mode.getStoredPlayTarget()).toBe('local');
        expect(mode.isStageRemoteMode()).toBe(false);
        expect(window.location.search).toBe('?host=1');
        vi.unstubAllEnvs();
    });

    it('an address without a token does not enter remote mode', async () => {
        vi.resetModules();
        vi.stubEnv('VITE_STAGE_RELAY', '1');
        setUrl('');
        const mode = await import('@/services/stageMode');
        expect(mode.isStageRemoteMode()).toBe(false);
        vi.unstubAllEnvs();
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
        chooseRemote();
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
        chooseRemote();
        localStorage.setItem('netease_cookie', 'MUSIC_U=mine');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBeNull();
        localStorage.setItem('folia_play_target', 'local');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBe('MUSIC_U=mine');
    });

    it('drops a leftover shared-account placeholder (with or without a token) in local mode', () => {
        localStorage.setItem('folia_play_target', 'local');
        const key = getProviderSessionKey('netease', 'cookie');
        localStorage.setItem(key, 'MUSIC_U=shared-with-stage-host');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBeNull();
        localStorage.setItem(key, 'MUSIC_U=shared-with-stage-host:abc123');
        expect(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
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
