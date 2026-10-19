import { OnlineProviderError } from '../../../types/onlineMusic';
import { getStageAuthHeaders, getStageToken, handleStageAuthFailure, isStageHostMode, isStageRelayAvailable, isStageRemoteMode, withStageTokenQuery } from '../../stageMode';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

// src/services/onlineMusic/spotify/spotifyTransport.ts
// The boundary to electron/spotify/spotifyApiBridge.cjs. The Spotify token stays in the main
// process; a query is named here and sent there, and its answer comes back as Spotify gave it.
// In the desktop app that is Electron IPC. 本 Fork 的网页版没有 Electron:同一个桥在 Stage 中继里运行
// (server/stage-relay/spotify.cjs),这里改经 POST /stage/spotify/api 去问它,带访问令牌;
// 音频地址也是中继的(/stage/spotify/audio/...),要加上令牌查询参数。

export type SpotifyOperation =
    | 'login_start' | 'login_check' | 'login_cancel' | 'login_open' | 'login_status' | 'logout'
    // 只有网页版中继有的两个(本机播放的浏览器用):授权页的地址,与粘贴回来的授权后网址
    | 'login_url' | 'login_complete'
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

// 本机播放的页面(不是 Host 页、也不是遥控页)在服务器上有自己的一份 Spotify 账号:一个随机的账号标识存在
// 本浏览器里,服务器只存它的哈希,账号用它封存;与 Host / 遥控页共用的那个账号互相独立。
const PROFILE_KEY = 'folia_spotify_profile';
const readProfileSecret = (): string => {
    try {
        const saved = localStorage.getItem(PROFILE_KEY);
        if (saved && /^[A-Za-z0-9_-]{32,64}$/.test(saved)) return saved;
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        const made = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(PROFILE_KEY, made);
        return made;
    } catch {
        return '';
    }
};
/** 这个页面用自己的账号(本机播放),还是用服务器上共用的那个(Host 页、遥控页)。 */
const usesOwnProfile = (): boolean => !isStageHostMode() && !isStageRemoteMode();

/** 网页版:这个部署配置了 Stage 中继;共用账号要访问令牌(Host 页与遥控页都有),本机播放的页面用自己的账号标识。 */
const hasRelayBridge = (): boolean => isStageRelayAvailable() && (usesOwnProfile() ? readProfileSecret() !== '' : getStageToken() !== '');

export const getSpotifyTransportAvailability = () => (
    hasDesktopBridge() || hasRelayBridge()
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

// 服务器上的这一个 Spotify 账号由 Host 页管理:登录、取消登录与登出只在 Host 页(或桌面版)里做,
// 别的页面(遥控页、带令牌的本机页)只能用它——否则任何一个拿到令牌的页面点一下「登出」,所有人就都下线了。
const MANAGE_ONLY_ON_HOST: ReadonlySet<SpotifyOperation> = new Set(['login_start', 'login_check', 'login_cancel', 'login_open', 'login_url', 'login_complete', 'logout']);

// 问中继:与桌面 IPC 同一种结果。令牌被拒(401)按 Stage 的规矩处理。
const requestViaRelay = async (operation: SpotifyOperation, params: SpotifyParams): Promise<SpotifyBridgeResult> => {
    const own = usesOwnProfile();
    if (!own && MANAGE_ONLY_ON_HOST.has(operation) && !isStageHostMode()) {
        return { ok: false, error: { code: 'unsupported', message: 'Spotify is signed in on the server: sign in or out on the Host page' } };
    }
    const response = await fetch('/stage/spotify/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(own ? { 'X-Spotify-Profile': readProfileSecret() } : getStageAuthHeaders()) },
        body: JSON.stringify({ operation, params }),
    });
    if (response.status === 401) {
        if (!own) handleStageAuthFailure();
        return { ok: false, error: { code: 'auth-required', message: 'The stage token was refused' } };
    }
    if (response.status === 429) {
        return { ok: false, error: { code: 'network', message: 'Too many attempts, try again in a minute' } };
    }
    const result = await response.json() as SpotifyBridgeResult;
    // 中继给的音频地址是它自己的路径:浏览器的 audio 元素带不了请求头,令牌放在查询参数里。
    if (result.ok && operation === 'audio') {
        const wire = result.data as SpotifyWireAudio | null;
        if (wire && typeof wire.url === 'string') {
            const url = own ? `${wire.url}${wire.url.includes('?') ? '&' : '?'}profile=${encodeURIComponent(readProfileSecret())}` : withStageTokenQuery(wire.url);
            return { ok: true, data: { ...wire, url } };
        }
    }
    // 本机播放的页面不在服务器的桌面上:授权页要在本浏览器里打开,而不是服务器的浏览器。
    if (result.ok && own && operation === 'login_open') {
        const page = await requestViaRelay('login_url', {});
        const address = page.ok ? (page.data as { url?: string } | null)?.url : undefined;
        if (address) window.open(address, '_blank', 'noopener');
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

/**
 * 本机播放的页面登录用:授权后浏览器被送回 http://127.0.0.1:5588/login?code=…(设备不是服务器时打不开),
 * 把地址栏里的这个网址交给服务器上等着的登录。在服务器自己的机器上登录时浏览器自己就能送到,不需要这一步。
 */
export const completeSpotifyLogin = (redirectUrl: string): Promise<boolean> => requestSpotify<boolean>('login_complete', { redirectUrl });

/** 本机播放的网页页面登录 Spotify 要不要给「粘贴授权后网址」这一步(桌面版与 Host / 遥控页都不需要)。 */
export const spotifyLoginNeedsPasteBack = (): boolean => !hasDesktopBridge() && hasRelayBridge() && usesOwnProfile();
