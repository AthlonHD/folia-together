// src/services/passthrough/passthroughStatusStore.ts
// What pass-through is doing right now: whether it holds the sound for the current track, the real chain the helper reported,
// and why it stood aside if it did.

import { create } from 'zustand';
import type { PassthroughChain } from './types';

export type PassthroughFallbackReason =
    | 'helper-unavailable'
    | 'unsupported-source'
    | 'device-in-use'
    | 'exclusive-not-allowed'
    | 'format-unsupported'
    | 'device-missing'
    | 'device-lost'
    | 'open-failed'
    | 'decode-failed'
    | 'stage-failed';

interface PassthroughStatusState {
    /** The web audio output must be silent: pass-through is playing the current track, or is about to. */
    silenceWebOutput: boolean;
    /** The helper confirmed it holds the sound of the current track. */
    engaged: boolean;
    chain: PassthroughChain | null;
    fallbackReason: PassthroughFallbackReason | null;
    setSilenceWebOutput: (silence: boolean) => void;
    setEngaged: (engaged: boolean) => void;
    setChain: (chain: PassthroughChain | null) => void;
    setFallbackReason: (reason: PassthroughFallbackReason | null) => void;
}

export const usePassthroughStatusStore = create<PassthroughStatusState>((set) => ({
    silenceWebOutput: false,
    engaged: false,
    chain: null,
    fallbackReason: null,
    setSilenceWebOutput: (silenceWebOutput) => set({ silenceWebOutput }),
    setEngaged: (engaged) => set({ engaged }),
    setChain: (chain) => set({ chain }),
    setFallbackReason: (fallbackReason) => set({ fallbackReason }),
}));

const KNOWN_REASONS: readonly PassthroughFallbackReason[] = [
    'helper-unavailable', 'unsupported-source', 'device-in-use', 'exclusive-not-allowed', 'format-unsupported',
    'device-missing', 'device-lost', 'open-failed', 'decode-failed', 'stage-failed',
];

/** Maps an error code from the helper or the main process onto a reason the UI has text for. */
export const toFallbackReason = (code: string): PassthroughFallbackReason => (
    (KNOWN_REASONS as readonly string[]).includes(code) ? code as PassthroughFallbackReason : 'open-failed'
);
