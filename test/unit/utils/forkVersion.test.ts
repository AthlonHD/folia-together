import { afterEach, describe, expect, it, vi } from 'vitest';
import { getForkVersion } from '@/utils/forkVersion';

// Fork 自己的版本号(FORK_VERSION)由构建期注入;格式不对或没有注入时当没有。

describe('getForkVersion', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('returns the injected semantic version', () => {
        vi.stubGlobal('__FORK_VERSION__', '1.2.3');
        expect(getForkVersion()).toBe('1.2.3');
    });

    it('ignores malformed or empty values', () => {
        vi.stubGlobal('__FORK_VERSION__', '');
        expect(getForkVersion()).toBeNull();
        vi.stubGlobal('__FORK_VERSION__', 'v1.0');
        expect(getForkVersion()).toBeNull();
    });
});
