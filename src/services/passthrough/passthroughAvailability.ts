import { runsOnWindows } from '../../utils/platform';

// The native helper owns the output whenever pass-through is requested and supported.
export const isPassthroughRequested = (enabled: boolean): boolean => (
    enabled && typeof window !== 'undefined' && Boolean(window.electron?.audioHelper) && runsOnWindows()
);
