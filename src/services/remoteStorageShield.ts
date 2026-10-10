// src/services/remoteStorageShield.ts
// 遥控模式下,"放什么、怎么放"的设置(音质、音量、均衡器、过渡、睡眠定时、循环/随机……)是 Host 的:
// 本页的值来自 Host 的镜像,用户在本页改动经 hostSettingsSync 发给 Host。
// 这些设置的 store 动作改完内存状态还会顺手写进本机 localStorage,那会把遥控时的值带进"本机播放"模式。
// 所以遥控模式下丢弃这些键的写入:本机模式保存的值不受影响,外观类设置(主题、动画等)不在名单里,两种模式照常共用。

// 与 hostSettingsSync.ts 里同步的设置一一对应;新增同步项时这里也要加上它的存储键
const HOST_OWNED_STORAGE_KEYS: ReadonlySet<string> = new Set([
    // 播放与音频
    'default_audio_quality',
    'player_volume',
    'player_is_muted',
    'folia_playback_fade_enabled',
    'audio_equalizer_settings',
    'folia_netease_scrobble',
    'folia_enable_media_cache',
    'enable_media_cache',
    'folia_media_cache_limit_gb',
    'folia_auto_play_on_launch',
    'folia_enable_transcode_fallback',
    'queue_add_behavior',
    'local_replaygain_mode',
    // 循环、随机与电台
    'player_loop_mode',
    'player_shuffle',
    'folia.personalFm.selection',
    // 自动混音与过渡
    'folia_automix_enabled',
    'folia_transition_mode',
    'folia_crossfade_max_sec',
    'folia_transition_performance',
    // 睡眠定时
    'sleep_timer_hours',
    'sleep_timer_minutes',
]);

export const installRemoteStorageShield = (): void => {
    if (typeof Storage === 'undefined' || typeof localStorage === 'undefined') return;
    const proto = Storage.prototype as Storage & { __foliaRemoteShield?: boolean };
    if (proto.__foliaRemoteShield) return;
    proto.__foliaRemoteShield = true;

    const originalSetItem = proto.setItem;
    const originalRemoveItem = proto.removeItem;
    const isShielded = (storage: Storage, key: string) => storage === localStorage && HOST_OWNED_STORAGE_KEYS.has(String(key));

    proto.setItem = function setItem(this: Storage, key: string, value: string) {
        if (isShielded(this, key)) return;
        originalSetItem.call(this, key, value);
    };
    proto.removeItem = function removeItem(this: Storage, key: string) {
        if (isShielded(this, key)) return;
        originalRemoveItem.call(this, key);
    };
};
