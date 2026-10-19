// src/components/app/passthrough/passthroughSource.ts
// Decides how the page hands the track it is playing to the pass-through helper: bytes read out of a blob URL, or a URL the main process fetches itself.

import type { PassthroughSource } from '../../../services/passthrough/types';

export type PassthroughSourceKind = 'blob' | 'remote' | 'unsupported';

/** Addresses the main process (or a blob read) can turn into a file: web and file addresses, and the app's own `folia-*` audio schemes (the main process only serves the ones it knows). */
export const classifyAudioSrc = (src: string | null | undefined): PassthroughSourceKind => {
    if (!src) return 'unsupported';
    if (src.startsWith('blob:')) return 'blob';
    if (/^(https?|file):/i.test(src) || /^folia-[a-z]+:/i.test(src)) return 'remote';
    return 'unsupported';
};

const EXTENSION_BY_MIME: Record<string, string> = {
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
};

export const extensionForMime = (mime: string): string | undefined => EXTENSION_BY_MIME[mime.split(';')[0].trim().toLowerCase()];

/** Builds the request source for `src`; null when it is not something the helper can play. */
export const buildPassthroughSource = async (src: string): Promise<PassthroughSource | null> => {
    const kind = classifyAudioSrc(src);
    if (kind === 'unsupported') return null;
    if (kind === 'remote') return { kind: 'url', url: src };
    const response = await fetch(src);
    const blob = await response.blob();
    return { kind: 'bytes', bytes: await blob.arrayBuffer(), ext: extensionForMime(blob.type) };
};

/**
 * Where the helper should start. A track that has only just begun starts from its first sample, because the helper takes a moment to open
 * and the page's own clock will be pulled back to it; a track resumed part-way starts where the page is.
 */
export const startSecFor = (elementTime: number): number => (
    Number.isFinite(elementTime) && elementTime > 8 ? elementTime : 0
);
