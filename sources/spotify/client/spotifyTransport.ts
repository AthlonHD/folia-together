import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';

// sources/spotify/client/spotifyTransport.ts
// The boundary to the main entry (main/index.ts, which hands the operations to spotifyApiBridge.cjs): requests go
// through folium.rpc's `request`. The Spotify token stays in the main process; a query is named here and sent
// there, and its answer comes back as Spotify gave it. The bridge's code and sentence reach the host as they are
// (folium.sources.error); the desktop side's own word for why something failed (a sign-in's reason, Soloist's
// `soloist-*` words) rides on the error as its cause (spotifyReasonOf), which spotifyLoginFailure.ts and
// spotifyFailure.ts read.
// 本 Fork 的网页版没有 Electron:同一个桥在 Stage 中继里运行 (server/stage-relay/spotify.cjs),这里改经
// POST /stage/spotify/api 去问它,带访问令牌;音频地址也是中继的(/stage/spotify/audio/...),要加上令牌查询参数。

export type SpotifyOperation =
    | 'login_start' | 'login_check' | 'login_cancel' | 'login_open' | 'login_status' | 'logout'
    // 只有网页版中继有的两个(本机播放的浏览器用):授权页的地址,与粘贴回来的授权后网址
    | 'login_url' | 'login_complete'
    | 'query' | 'radio' | 'lyrics' | 'audio' | 'audio_kept' | 'audio_keep' | 'audio_probe' | 'library' | 'playlist_edit' | 'playlist_create'
    | 'playback_mode' | 'soloist_state' | 'soloist_pick' | 'soloist_key' | 'soloist_restart' | 'soloist_open'
    | 'soloist_play' | 'soloist_pause' | 'soloist_resume' | 'soloist_seek' | 'soloist_volume' | 'soloist_status'
    | 'soloist_repeat';
// The queries the main process sends for the client (`RENDERER_QUERIES` in the bridge).
export type SpotifyQuery =
    | 'home' | 'homeSection' | 'browsePage' | 'queryWhatsNewFeed' | 'libraryV3' | 'fetchLibraryTracks' | 'fetchPlaylist'
    | 'getAlbum' | 'queryArtistOverview' | 'queryArtistDiscographyAll' | 'searchTracks' | 'getTrack' | 'areEntitiesInLibrary';
export type SpotifyParams = Record<string, unknown>;
// `reason`: the desktop side's own word for why it failed, where it has one.
export type SpotifyBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; reason?: string } };

export interface SpotifyWireLoginStart { key: string; expiresInMs: number }
/** The playlist Spotify keeps of the songs like one song. */
export interface SpotifyWireRadio { uri: string }
/** The app's own URL for a track's audio, and the file Spotify chose for it ("OGG_VORBIS_320"). */
export interface SpotifyWireAudio { url: string; format: string }
/** The playlist that was made. */
export interface SpotifyWireMadePlaylist { uri: string }
export interface SpotifyWireLyrics { timed: boolean; lines: Array<{ startMs: number; words: string }> }

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface SpotifyTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: SpotifyTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectSpotifyTransport = (next: SpotifyTransportEnv): void => {
    env = next;
};

const host = (): SpotifyTransportEnv => {
    if (!env) throw new Error('[Spotify] the transport is not connected (activate has not run)');
    return env;
};

// The codes the host reads; the bridge gives only these (main/errors.cjs). One it might add later is read as an
// answer that could not be read, as the host would not know it either.
const CODES: ReadonlySet<string> = new Set<FoliumSourceErrorCode>([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
]);

/**
 * The desktop side's word for why a request failed, where it said one. Rides on the error as its `cause`, which
 * the host keeps when it names the source on the error (a new object), so it is recognised by identity here.
 */
export interface SpotifyReason { readonly reason: string }
const reasons = new WeakSet();

/** The desktop side's reason an error of a Spotify request carries, or null. */
export const spotifyReasonOf = (error: unknown): string | null => {
    const cause: unknown = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
    return typeof cause === 'object' && cause !== null && reasons.has(cause) ? (cause as SpotifyReason).reason : null;
};

/** The code and sentence of an error made with folium.sources.error; nothing for any other. */
export const spotifyCodeOf = (error: unknown): { code: string; message: string } | null => {
    if (!(error instanceof Error)) return null;
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? { code, message: error.message } : null;
};

/** An error of the host's, with the bridge's code (or `invalid-response` for one the host does not know) and sentence. */
export const spotifyError = (code: string | undefined, message: string, reason?: string): FoliumSourceError => {
    const known = code !== undefined && CODES.has(code) ? code as FoliumSourceErrorCode : 'invalid-response';
    // 网页版中继在音源 activate 之前就会拒绝登录：这时还没有宿主的 error，错本身带上 code 即可。
    if (!env) {
        const error = new Error(message) as FoliumSourceError;
        (error as { code: string }).code = known;
        return error;
    }
    if (!reason) return host().error(known, message);
    const cause: SpotifyReason = Object.freeze({ reason });
    reasons.add(cause);
    return host().error(known, message, { cause });
};

// Stage 中继的令牌和页面模式，与 src/services/stageMode.ts 同一套键。写在这里是为了音源工程不把宿主的 Vite 模块拉进来。
const STAGE_TOKEN_KEY = 'folia_stage_token';
const STAGE_TARGET_KEY = 'folia_play_target';
const stageParams = (): URLSearchParams | null => (
    typeof window === 'undefined' || !window.location ? null : new URLSearchParams(window.location.search)
);
const stageRelayFlag = (): boolean => {
    const env = (import.meta as ImportMeta & { env?: { VITE_STAGE_RELAY?: string } }).env;
    return env?.VITE_STAGE_RELAY === '1';
};
const isStageDesktop = (): boolean => typeof window !== 'undefined'
    && Boolean((window as Window & { electron?: unknown }).electron);
const isStageHostMode = (): boolean => stageParams()?.get('host') === '1';
const isStageRelayAvailable = (): boolean => !isStageDesktop() && (stageRelayFlag() || stageParams()?.get('stageremote') === '1');
const getStageToken = (): string => {
    try { return localStorage.getItem(STAGE_TOKEN_KEY) || ''; } catch { return ''; }
};
const getStageAuthHeaders = (): Record<string, string> => {
    const token = getStageToken();
    return token ? { 'X-Stage-Token': token } : {};
};
const withStageTokenQuery = (url: string): string => {
    const token = getStageToken();
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
};
const isStageRemoteMode = (): boolean => {
    const params = stageParams();
    if (!params || isStageDesktop()) return false;
    if (params.get('host') === '1' || params.get('local') === '1') return false;
    if (params.get('stageremote') === '1') return true;
    if (!stageRelayFlag()) return false;
    try { return localStorage.getItem(STAGE_TARGET_KEY) === 'remote'; } catch { return false; }
};
const handleStageAuthFailure = (): void => {
    try {
        if (sessionStorage.getItem('folia_stage_auth_reset') === '1') return;
        sessionStorage.setItem('folia_stage_auth_reset', '1');
    } catch { /* 没有 sessionStorage 就不防重复 */ }
    try { localStorage.removeItem(STAGE_TOKEN_KEY); } catch { /* ignore */ }
    try { localStorage.setItem(STAGE_TARGET_KEY, 'local'); } catch { /* ignore */ }
    if (typeof window === 'undefined' || !window.location) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('local');
    url.searchParams.delete('stageremote');
    url.hash = '';
    window.location.replace(url.toString());
};

const hasDesktopBridge = (): boolean => (
    typeof window !== 'undefined'
    && typeof (window as Window & { electron?: { spotifyRequest?: unknown } }).electron?.spotifyRequest === 'function'
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
    const named = operation === 'query' ? `${operation} ${String(params.name)}` : operation;
    const startedAt = Date.now();
    const viaRelay = hasRelayBridge() && !hasDesktopBridge();
    if (!hasDesktopBridge() && !hasRelayBridge() && !env) {
        throw spotifyError('unavailable', 'Spotify requires the desktop app or a configured Stage relay');
    }
    let result: SpotifyBridgeResult;
    try {
        result = viaRelay
            ? await requestViaRelay(operation, params)
            : await host().call<SpotifyBridgeResult>('request', operation, params);
    } catch (error) {
        console.warn(`[Spotify] ${named} did not reach the ${viaRelay ? 'relay' : 'desktop app'}`, error);
        throw spotifyError('network', viaRelay ? 'Spotify request failed' : 'Spotify desktop request failed');
    }
    if (!result.ok) {
        console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message ?? ''})`);
        throw spotifyError(result.error.code, result.error.message, result.error.reason);
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
