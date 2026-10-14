// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getLayoutMode,
    installLayoutAttributes,
    readLayoutPreference,
    resolveLayoutMode,
    setLayoutPreference,
    type DeviceSignals,
} from '@/services/deviceProfile';

// 手机 / 电脑布局的判断规则:按设备能力、短边,拿不准一律电脑;网址参数和用户偏好可以覆盖。

const phone: DeviceSignals = { coarsePointer: true, noHover: true, shortSidePx: 390 };
const desktop: DeviceSignals = { coarsePointer: false, noHover: false, shortSidePx: 1080 };

describe('resolveLayoutMode', () => {
    it('treats a coarse, hover-less device with a short side under 600px as a phone', () => {
        expect(resolveLayoutMode({ preference: 'auto', signals: phone })).toBe('phone');
        // 横屏时当前宽度很大,但设备短边没变,仍是手机
        expect(resolveLayoutMode({ preference: 'auto', signals: { ...phone, shortSidePx: 360 } })).toBe('phone');
    });

    it('keeps desktops, tablets and hybrids on the desktop layout', () => {
        expect(resolveLayoutMode({ preference: 'auto', signals: desktop })).toBe('desktop');
        // 平板:触屏但短边 ≥ 600
        expect(resolveLayoutMode({ preference: 'auto', signals: { coarsePointer: true, noHover: true, shortSidePx: 768 } })).toBe('desktop');
        // 带触屏的笔记本:主指针是鼠标
        expect(resolveLayoutMode({ preference: 'auto', signals: { coarsePointer: false, noHover: false, shortSidePx: 540 } })).toBe('desktop');
        // 小窗口的桌面浏览器:不是触屏,窗口再窄也不切手机
        expect(resolveLayoutMode({ preference: 'auto', signals: { coarsePointer: false, noHover: false, shortSidePx: 400 } })).toBe('desktop');
    });

    it('goes to the desktop layout when only part of the evidence points to a phone', () => {
        expect(resolveLayoutMode({ preference: 'auto', signals: { ...phone, noHover: false } })).toBe('desktop');
        expect(resolveLayoutMode({ preference: 'auto', signals: { ...phone, coarsePointer: false } })).toBe('desktop');
    });

    it('trusts a mobile user agent with touch points when the media queries disagree, but never on a wide screen', () => {
        const odd: DeviceSignals = { coarsePointer: false, noHover: false, shortSidePx: 412, mobileUa: true };
        expect(resolveLayoutMode({ preference: 'auto', signals: odd })).toBe('phone');
        expect(resolveLayoutMode({ preference: 'auto', signals: { ...odd, shortSidePx: 800 } })).toBe('desktop');
    });

    it('lets the user preference override the guess', () => {
        expect(resolveLayoutMode({ preference: 'desktop', signals: phone })).toBe('desktop');
        expect(resolveLayoutMode({ preference: 'phone', signals: desktop })).toBe('phone');
    });

    it('lets the URL parameter override everything', () => {
        expect(resolveLayoutMode({ urlParam: 'phone', preference: 'desktop', signals: desktop })).toBe('phone');
        expect(resolveLayoutMode({ urlParam: 'mobile', preference: 'auto', signals: desktop })).toBe('phone');
        expect(resolveLayoutMode({ urlParam: 'desktop', preference: 'phone', signals: phone })).toBe('desktop');
        expect(resolveLayoutMode({ urlParam: 'nonsense', preference: 'auto', signals: phone })).toBe('phone');
    });
});

describe('layout preference and attributes', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState({}, '', '/');
        delete document.documentElement.dataset.layout;
        delete document.documentElement.dataset.orientation;
    });
    afterEach(() => vi.restoreAllMocks());

    it('stores, reads and clears the preference', () => {
        expect(readLayoutPreference()).toBe('auto');
        setLayoutPreference('phone');
        expect(readLayoutPreference()).toBe('phone');
        setLayoutPreference('desktop');
        expect(readLayoutPreference()).toBe('desktop');
        setLayoutPreference('auto');
        expect(readLayoutPreference()).toBe('auto');
        localStorage.setItem('folia_layout_preference', 'garbage');
        expect(readLayoutPreference()).toBe('auto');
    });

    it('is the desktop layout in a plain jsdom window, and follows the preference and the URL', () => {
        expect(getLayoutMode()).toBe('desktop');
        setLayoutPreference('phone');
        expect(getLayoutMode()).toBe('phone');
        window.history.replaceState({}, '', '/?layout=desktop');
        expect(getLayoutMode()).toBe('desktop');
    });

    it('writes data-layout and data-orientation to <html> and keeps them current', () => {
        const stop = installLayoutAttributes();
        expect(document.documentElement.dataset.layout).toBe('desktop');
        expect(['portrait', 'landscape']).toContain(document.documentElement.dataset.orientation);

        setLayoutPreference('phone');
        expect(document.documentElement.dataset.layout).toBe('phone');

        stop();
        setLayoutPreference('desktop');
        expect(document.documentElement.dataset.layout).toBe('phone');
    });
});
