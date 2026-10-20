// src/utils/searchSourceOrder.ts
// The order of the source tabs on the search page (the online platforms, then the local library and Navidrome): the user's own order,
// with the platform in use in front when they ask for that. A source the saved order does not know yet (a platform that was added
// later) goes after the ones it does, in the order it was offered.

export const normalizeSearchSourceOrder = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const item of value) {
        if (typeof item === 'string' && item && !seen.has(item)) {
            seen.add(item);
            order.push(item);
        }
    }
    return order;
};

/** `sources` in the order the page would show them without any setting; the result holds exactly the same sources. */
export const orderSearchSources = <T extends string>({
    sources,
    order,
    activeProviderId,
    currentFirst,
}: {
    sources: readonly T[];
    order: readonly string[];
    activeProviderId?: string;
    currentFirst: boolean;
}): T[] => {
    const rank = new Map(order.map((id, index) => [id, index]));
    const ordered = [...sources].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
    if (currentFirst && activeProviderId) {
        const at = ordered.indexOf(activeProviderId as T);
        if (at > 0) ordered.unshift(...ordered.splice(at, 1));
    }
    return ordered;
};

export const isSameSearchSourceOrder = (a: readonly string[], b: readonly string[]): boolean => (
    a.length === b.length && a.every((id, index) => id === b[index])
);
