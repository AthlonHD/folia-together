// src/services/deviceProfile.ts
// 这个设备该用哪套界面布局:手机(phone)还是电脑(desktop)。
// 手机布局和电脑布局是两套独立的外壳与页面,分叉点就在这里决定;一切拿不准的情况都按电脑处理,
// 这样电脑端的行为不会被误判改变。
//
// 判断按设备能力而不是只看 UA:
// - 主指针是触屏且不能悬停:(pointer: coarse) 且 (hover: none);
// - 按设备**短边**判断(小于 600 CSS 像素),不是当前窗口宽度:手机横竖屏切换时布局不会来回跳,
//   平板(短边通常 ≥ 600)和被拖窄的电脑窗口也不会被当成手机。
// 用户可以在设置里改成"始终手机 / 始终电脑",网址里的 ?layout=phone|desktop 优先于一切(调试和兜底用)。
// 这个模块不依赖应用里的其他模块,存储层和外壳都可以直接用。

export type LayoutMode = 'phone' | 'desktop';
export type LayoutPreference = 'auto' | LayoutMode;
export type DeviceOrientation = 'portrait' | 'landscape';

const LAYOUT_PREFERENCE_KEY = 'folia_layout_preference';
/** 设备短边小于这个值才可能是手机。 */
export const PHONE_SHORT_SIDE_MAX_PX = 600;
const LAYOUT_PREFERENCE_EVENT = 'folia-layout-preference-changed';

export type DeviceSignals = {
    coarsePointer: boolean;
    noHover: boolean;
    /** 设备短边(CSS 像素)。 */
    shortSidePx: number;
    /** UA 自报是手机(Android Mobile / iPhone)且有触点:有些手机浏览器的 pointer / hover 媒体查询不准,作为补充证据。 */
    mobileUa?: boolean;
};

/** 纯规则:网址参数 > 用户偏好 > 自动判断。 */
export const resolveLayoutMode = ({
    urlParam,
    preference,
    signals,
}: {
    urlParam?: string | null;
    preference: LayoutPreference;
    signals: DeviceSignals;
}): LayoutMode => {
    if (urlParam === 'phone' || urlParam === 'mobile') return 'phone';
    if (urlParam === 'desktop') return 'desktop';
    if (preference === 'phone' || preference === 'desktop') return preference;
    if (signals.shortSidePx >= PHONE_SHORT_SIDE_MAX_PX) return 'desktop';
    return (signals.coarsePointer && signals.noHover) || signals.mobileUa ? 'phone' : 'desktop';
};

const hasWindow = (): boolean => typeof window !== 'undefined';

const matches = (query: string): boolean => (
    hasWindow() && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
);

export const readDeviceSignals = (): DeviceSignals => {
    let shortSidePx = Number.POSITIVE_INFINITY;
    if (hasWindow()) {
        const screenSides = [window.screen?.width, window.screen?.height].filter((value): value is number => Number(value) > 0);
        const viewportSides = [window.innerWidth, window.innerHeight].filter(value => value > 0);
        // 优先用设备屏幕;拿不到才退回视口(此时窗口大小就是仅有的信息)
        const sides = screenSides.length > 0 ? screenSides : viewportSides;
        if (sides.length > 0) shortSidePx = Math.min(...sides);
    }
    return {
        coarsePointer: matches('(pointer: coarse)'),
        noHover: matches('(hover: none)'),
        shortSidePx,
        mobileUa: hasWindow() && typeof navigator !== 'undefined'
            && /Android.+Mobile|iPhone|iPod/i.test(navigator.userAgent || '')
            && (navigator.maxTouchPoints || 0) > 0,
    };
};

export const readLayoutPreference = (): LayoutPreference => {
    try {
        const stored = localStorage.getItem(LAYOUT_PREFERENCE_KEY);
        return stored === 'phone' || stored === 'desktop' ? stored : 'auto';
    } catch {
        return 'auto';
    }
};

export const setLayoutPreference = (preference: LayoutPreference): void => {
    try {
        if (preference === 'auto') localStorage.removeItem(LAYOUT_PREFERENCE_KEY);
        else localStorage.setItem(LAYOUT_PREFERENCE_KEY, preference);
    } catch { /* 存不了就只对本次页面有效 */ }
    if (hasWindow()) window.dispatchEvent(new Event(LAYOUT_PREFERENCE_EVENT));
};

export const getLayoutMode = (): LayoutMode => {
    const urlParam = hasWindow() && window.location ? new URLSearchParams(window.location.search).get('layout') : null;
    return resolveLayoutMode({ urlParam, preference: readLayoutPreference(), signals: readDeviceSignals() });
};

export const getDeviceOrientation = (): DeviceOrientation => (
    hasWindow() && (matches('(orientation: landscape)') || (window.innerWidth > window.innerHeight && !matches('(orientation: portrait)')))
        ? 'landscape'
        : 'portrait'
);

/** 订阅布局相关信号的变化(偏好、指针能力、方向、窗口大小)。返回取消订阅函数。 */
export const subscribeLayout = (listener: () => void): (() => void) => {
    if (!hasWindow()) return () => undefined;
    const queries = ['(pointer: coarse)', '(hover: none)', '(orientation: portrait)']
        .map(query => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null))
        .filter((query): query is MediaQueryList => query !== null);
    queries.forEach(query => query.addEventListener('change', listener));
    window.addEventListener('resize', listener);
    window.addEventListener('storage', listener);
    window.addEventListener(LAYOUT_PREFERENCE_EVENT, listener);
    return () => {
        queries.forEach(query => query.removeEventListener('change', listener));
        window.removeEventListener('resize', listener);
        window.removeEventListener('storage', listener);
        window.removeEventListener(LAYOUT_PREFERENCE_EVENT, listener);
    };
};

/**
 * 把布局写到 <html> 的 data-layout / data-orientation 上,并在变化时更新。
 * 共享组件里零碎的手机修补可以直接用 CSS 按它分叉:`:root[data-layout="phone"] .x { ... }`。
 * 在应用渲染之前调用,避免第一帧用错布局。
 */
export const installLayoutAttributes = (): (() => void) => {
    if (typeof document === 'undefined') return () => undefined;
    const apply = () => {
        const root = document.documentElement;
        root.dataset.layout = getLayoutMode();
        root.dataset.orientation = getDeviceOrientation();
    };
    apply();
    return subscribeLayout(apply);
};
