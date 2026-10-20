import { describe, expect, it } from 'vitest';
import { isSameSearchSourceOrder, normalizeSearchSourceOrder, orderSearchSources } from '../../../src/utils/searchSourceOrder';

// test/unit/search/searchSourceOrder.test.ts
// The order of the source tabs on the search page.

const SOURCES = ['netease', 'qq', 'kugou', 'spotify', 'local', 'navidrome'] as const;

describe('orderSearchSources', () => {
    it('keeps the page order when nothing is saved and the current platform is not asked to lead', () => {
        expect(orderSearchSources({ sources: SOURCES, order: [], currentFirst: false })).toEqual([...SOURCES]);
    });

    it('follows the saved order, and puts a source the order does not know yet after the ones it does', () => {
        expect(orderSearchSources({ sources: SOURCES, order: ['kugou', 'local', 'netease'], currentFirst: false }))
            .toEqual(['kugou', 'local', 'netease', 'qq', 'spotify', 'navidrome']);
    });

    it('ignores saved ids that are not sources right now', () => {
        expect(orderSearchSources({ sources: ['netease', 'qq'], order: ['ytm', 'qq', 'netease'], currentFirst: false })).toEqual(['qq', 'netease']);
    });

    it('puts the platform in use first when asked, the rest keeping the saved order', () => {
        expect(orderSearchSources({ sources: SOURCES, order: ['kugou', 'qq', 'netease'], activeProviderId: 'netease', currentFirst: true }))
            .toEqual(['netease', 'kugou', 'qq', 'spotify', 'local', 'navidrome']);
    });

    it('leaves the saved order alone when the platform in use is not a source or the setting is off', () => {
        expect(orderSearchSources({ sources: SOURCES, order: ['qq'], activeProviderId: 'ytm', currentFirst: true }).slice(0, 2)).toEqual(['qq', 'netease']);
        expect(orderSearchSources({ sources: SOURCES, order: ['qq'], activeProviderId: 'netease', currentFirst: false }).slice(0, 2)).toEqual(['qq', 'netease']);
    });

    it('returns exactly the sources it was given', () => {
        const result = orderSearchSources({ sources: SOURCES, order: ['local', 'spotify'], activeProviderId: 'kugou', currentFirst: true });
        expect([...result].sort()).toEqual([...SOURCES].sort());
    });
});

describe('normalizeSearchSourceOrder', () => {
    it('keeps strings once, in order, and drops everything else', () => {
        expect(normalizeSearchSourceOrder(['qq', 'netease', 'qq', 3, '', null, 'local'])).toEqual(['qq', 'netease', 'local']);
        expect(normalizeSearchSourceOrder('qq')).toEqual([]);
        expect(normalizeSearchSourceOrder(null)).toEqual([]);
    });
});

describe('isSameSearchSourceOrder', () => {
    it('compares the order, not only the members', () => {
        expect(isSameSearchSourceOrder(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(isSameSearchSourceOrder(['a', 'b'], ['b', 'a'])).toBe(false);
        expect(isSameSearchSourceOrder([], [])).toBe(true);
    });
});
