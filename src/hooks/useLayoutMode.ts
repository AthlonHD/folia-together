import { useSyncExternalStore } from 'react';
import {
    getDeviceOrientation,
    getLayoutMode,
    readLayoutPreference,
    subscribeLayout,
    type DeviceOrientation,
    type LayoutMode,
    type LayoutPreference,
} from '../services/deviceProfile';

// src/hooks/useLayoutMode.ts
// 当前该用手机布局还是电脑布局(规则见 services/deviceProfile.ts),以及设备方向。
// 读的都是原始字符串,useSyncExternalStore 靠值比较,不会因为每次读到新对象而反复渲染。

/** 当前生效的布局。手机外壳和手机版页面都据此分叉;电脑那一支保持原样。 */
export const useLayoutMode = (): LayoutMode => useSyncExternalStore(subscribeLayout, getLayoutMode, () => 'desktop');

export const useIsPhoneLayout = (): boolean => useLayoutMode() === 'phone';

/** 设备方向(手机布局内部区分竖屏 / 横屏用)。 */
export const useDeviceOrientation = (): DeviceOrientation => (
    useSyncExternalStore(subscribeLayout, getDeviceOrientation, () => 'portrait')
);

/** 用户在设置里选的偏好(auto / phone / desktop),不是最终生效的布局。 */
export const useLayoutPreference = (): LayoutPreference => (
    useSyncExternalStore(subscribeLayout, readLayoutPreference, () => 'auto')
);
