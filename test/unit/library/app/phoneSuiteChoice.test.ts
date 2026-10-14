import { describe, expect, it } from 'vitest';
import { resolveChosenLibrarySuiteId } from '@/library/app/librarySuiteChoice';

// 手机布局下实际渲染手机版 suite;电脑布局和用户的选择不受影响。

describe('resolveChosenLibrarySuiteId', () => {
    it('keeps the stored choice on the desktop layout', () => {
        expect(resolveChosenLibrarySuiteId('bravais', false)).toBe('bravais');
        expect(resolveChosenLibrarySuiteId('grid')).toBe('grid');
        expect(resolveChosenLibrarySuiteId('unknown-suite', false)).toBe('grid');
    });

    it('renders the phone suite on the phone layout, whatever was chosen', () => {
        expect(resolveChosenLibrarySuiteId('bravais', true)).toBe('phone');
        expect(resolveChosenLibrarySuiteId('grid', true)).toBe('phone');
    });
});
