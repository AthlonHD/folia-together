import type { CrossPlaylist } from './crossPlaylistModel';
import { normalizePlaylists } from './crossPlaylistModel';

// src/components/app/crossPlaylist/crossPlaylistSyncClient.ts
// The device's half of syncing the cross-platform playlists with the Stage server (server/stage-relay/playlistSync.cjs): making a group,
// the code that hands it to another device, and one round of sending what changed and taking what the server has.
//
// A page served by the server reaches it on its own address (`serverUrl` empty). The desktop app is not served by it, so it is told the
// address. Nothing here needs the browser's crypto.subtle (a page on a plain http address of the local network has none): the group id
// and secret are random numbers, and the secret goes in a header.

export interface CrossSyncConfig {
    /** The server's address; empty when the page is served by it. */
    serverUrl: string;
    groupId: string;
    secret: string;
}

export type CrossSyncErrorKind = 'network' | 'unauthorized' | 'badCode' | 'rateLimited' | 'unavailable' | 'server';

export class CrossSyncError extends Error {
    constructor(public readonly kind: CrossSyncErrorKind, message?: string) {
        super(message ?? kind);
        this.name = 'CrossSyncError';
    }
}

type FetchLike = typeof fetch;

export const syncBaseOf = (serverUrl: string): string => serverUrl.trim().replace(/\/+$/, '');

const randomHex = (bytes: number): string => {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
};

const request = async (
    fetchImpl: FetchLike,
    serverUrl: string,
    route: string,
    options: { method?: string; body?: unknown; secret?: string } = {},
): Promise<any> => {
    let response: Response;
    try {
        response = await fetchImpl(`${syncBaseOf(serverUrl)}/stage/sync/${route}`, {
            method: options.method ?? 'GET',
            headers: { 'Content-Type': 'application/json', ...(options.secret ? { Authorization: `Bearer ${options.secret}` } : {}) },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
    } catch {
        throw new CrossSyncError('network');
    }
    if (response.ok) return response.json().catch(() => ({}));
    if (response.status === 401) throw new CrossSyncError('unauthorized');
    if (response.status === 404 && route === 'redeem') throw new CrossSyncError('badCode');
    if (response.status === 404) throw new CrossSyncError('unavailable');
    if (response.status === 429) throw new CrossSyncError('rateLimited');
    throw new CrossSyncError('server', String(response.status));
};

/** Whether there is a sync service at this address (a page that is not served by the Stage server has none). */
export const pingSyncServer = async (serverUrl: string, fetchImpl: FetchLike = fetch): Promise<boolean> => {
    try {
        const body = await request(fetchImpl, serverUrl, 'ping');
        return Boolean(body && body.ok === true && body.playlistSync);
    } catch {
        return false;
    }
};

/** Makes a group on the server for this device. */
export const createSyncGroup = async (serverUrl: string, fetchImpl: FetchLike = fetch): Promise<CrossSyncConfig> => {
    const config: CrossSyncConfig = { serverUrl: syncBaseOf(serverUrl), groupId: randomHex(16), secret: randomHex(32) };
    await request(fetchImpl, serverUrl, 'groups', { method: 'POST', body: { groupId: config.groupId, secret: config.secret } });
    return config;
};

/** A short code another device can join this group with, good for a few minutes and one use. */
export const requestSyncCode = async (config: CrossSyncConfig, fetchImpl: FetchLike = fetch): Promise<{ code: string; expiresInSec: number }> => {
    const body = await request(fetchImpl, config.serverUrl, 'pair', { method: 'POST', body: { groupId: config.groupId }, secret: config.secret });
    return { code: String(body.code), expiresInSec: Number(body.expiresInSec) || 300 };
};

/** Joins the group a code belongs to. */
export const redeemSyncCode = async (serverUrl: string, code: string, fetchImpl: FetchLike = fetch): Promise<CrossSyncConfig> => {
    const body = await request(fetchImpl, serverUrl, 'redeem', { method: 'POST', body: { code } });
    return { serverUrl: syncBaseOf(serverUrl), groupId: String(body.groupId), secret: String(body.secret) };
};

/** Sends the playlists and answers with what the server holds after merging them in. */
export const syncPlaylists = async (config: CrossSyncConfig, playlists: readonly CrossPlaylist[], fetchImpl: FetchLike = fetch): Promise<CrossPlaylist[]> => {
    const body = await request(fetchImpl, config.serverUrl, `groups/${config.groupId}`, { method: 'POST', body: { playlists }, secret: config.secret });
    return normalizePlaylists(body.playlists);
};

/** Takes the group's data off the server (the devices keep their own copies). */
export const deleteSyncGroup = async (config: CrossSyncConfig, fetchImpl: FetchLike = fetch): Promise<void> => {
    await request(fetchImpl, config.serverUrl, `groups/${config.groupId}`, { method: 'DELETE', secret: config.secret });
};

export const SYNC_CONFIG_STORAGE_KEY = 'cross_playlist_sync';

export const readSyncConfig = (): CrossSyncConfig | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(SYNC_CONFIG_STORAGE_KEY) || 'null');
        if (parsed && typeof parsed.groupId === 'string' && typeof parsed.secret === 'string') {
            return { serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '', groupId: parsed.groupId, secret: parsed.secret };
        }
    } catch {
        // No saved group, or the storage is not there: not syncing.
    }
    return null;
};

export const writeSyncConfig = (config: CrossSyncConfig | null): void => {
    try {
        if (config) localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(config));
        else localStorage.removeItem(SYNC_CONFIG_STORAGE_KEY);
    } catch {
        // The group lasts until the page is closed.
    }
};
