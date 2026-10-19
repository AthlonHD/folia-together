import { OnlineProviderError } from '../../../types/onlineMusic';
import { getStageAuthHeaders, getStageToken, handleStageAuthFailure, isStageRelayAvailable, withStageTokenQuery } from '../../stageMode';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

// src/services/onlineMusic/spotify/spotifyTransport.ts
// The boundary to electron/spotify/spotifyApiBridge.cjs. The Spotify token stays in the main
// process; a query is named here and sent there, and its answer comes back as Spotify gave it.
// In the desktop app that is Electron IPC. 本 Fork 的网页版没有 Electron:同一个桥在 Stage 中继里运行
// (server/stage-relay/spotify.cjs),这里改经 POST /stage/spotify/api 去问它,带访问令牌;
// 音频地址也是中继的(/stage/spotify/audio/...),要加上令牌查询参数。

export type SpotifyOperation =
    | 'login_start' | 'login_check' | 'login_cancel' | 'login_open' | 'login_status' | 'logout'
    | 'query' | 'radio' | 'lyrics' | 'audio' | 'audio_kept' | 'audio_keep' | 'library' | 'playlist_edit' | 'playlist_create';
// The queries the main process sends for the renderer (`RENDERER_QUERIES` in the bridge).
export type SpotifyQuery =
    | 'home' | 'homeSection' | 'browsePage' | 'queryWhatsNewFeed' | 'libraryV3' | 'fetchLibraryTracks' | 'fetchPlaylist'
    | 'getAlbum' | 'queryArtistOverview' | 'queryArtistDiscographyAll' | 'searchTracks' | 'getTrack' | 'areEntitiesInLibrary';
export type SpotifyParams = Record<string, unknown>;
// `reason`: the desktop side's own word for why a sign-in failed, where it has one.
export type SpotifyBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: ProviderErrorCode; message: string; reason?: string } };

export interface SpotifyWireLoginStart { key: string; expiresInMs: number }
/** The playlist Spotify keeps of the songs like one song. */
export interface SpotifyWireRadio { uri: string }
/** The app's own URL for a track's audio, and the file Spotify chose for it ("OGG_VORBIS_320"). */
export interface SpotifyWireAudio { url: string; format: string }
/** The playlist that was made. */
export interface SpotifyWireMadePlaylist { uri: string }
export interface SpotifyWireLyrics { timed: boolean; lines: Array<{ startMs: number; words: string }> }

const hasDesktopBridge = (): boolean => (
    typeof window !== 'undefined' && typeof window.electron?.spotifyRequest === 'function'
);

/** 网页版:这个部署配置了 Stage 中继,而且本页有访问令牌(Host 页与遥控页都有)。 */
const hasRelayBridge = (): boolean => isStageRelayAvailable() && getStageToken() !== '';

export const getSpotifyTransportAvailability = () => (
    hasDesktopBridge() || hasRelayBridge()
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

// 问中继:与桌面 IPC 同一种结果。令牌被拒(401)按 Stage 的规矩处理。
const requestViaRelay = async (operation: SpotifyOperation, params: SpotifyParams): Promise<SpotifyBridgeResult> => {
    const response = await fetch('/stage/spotify/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getStageAuthHeaders() },
        body: JSON.stringify({ operation, params }),
    });
    if (response.status === 401) {
        handleStageAuthFailure();
        return { ok: false, error: { code: 'auth-required', message: 'The stage token was refused' } };
    }
    if (response.status === 429) {
        return { ok: false, error: { code: 'network', message: 'Too many attempts, try again in a minute' } };
    }
    const result = await response.json() as SpotifyBridgeResult;
    // 中继给的音频地址是它自己的路径:浏览器的 audio 元素带不了请求头,令牌放在查询参数里。
    if (result.ok && operation === 'audio') {
        const wire = result.data as SpotifyWireAudio | null;
        if (wire && typeof wire.url === 'string') return { ok: true, data: { ...wire, url: withStageTokenQuery(wire.url) } };
    }
    return result;
};

export async function requestSpotify<T = unknown>(operation: SpotifyOperation, params: SpotifyParams = {}): Promise<T> {
    if (!getSpotifyTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', 'Spotify requires the desktop app or a configured Stage relay', 'spotify');
    }
    const named = operation === 'query' ? `${operation} ${String(params.name)}` : operation;
    const startedAt = Date.now();
    let result: SpotifyBridgeResult;
    try { result = hasDesktopBridge() ? await window.electron!.spotifyRequest(operation, params) : await requestViaRelay(operation, params); }
    catch {
        console.warn(`[Spotify] ${named} did not reach the ${hasDesktopBridge() ? 'desktop app' : 'relay'}`);
        throw new OnlineProviderError('network', 'Spotify request failed', 'spotify');
    }
    if (!result.ok) {
        console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message ?? ''})`);
        // The reason goes with the error as its cause (spotifyLoginFailure.ts reads it there).
        throw new OnlineProviderError(result.error.code, result.error.message, 'spotify', result.error.reason);
    }
    return result.data as T;
}

// One of Spotify's named queries, answered with the `data` of its reply.
export const querySpotify = <T = unknown>(name: SpotifyQuery, variables: Record<string, unknown> = {}): Promise<T> => (
    requestSpotify<T>('query', { name, variables })
);
