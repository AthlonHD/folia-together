// src/services/stageMode.ts
// 本页以哪种方式运行:
// - Host:?host=1,在服务器上真正出声的那一页。
// - 遥控:不出声,所有播放操作经 Stage 中继转给 Host;需要 Host 的令牌(带 ?token= 的访问地址会直接进入遥控)。
// - 本机:和原版一样在本设备上播放,账号、队列、曲库都是本设备自己的。
// 遥控与本机的选择存在本设备的 localStorage 里,切换后刷新页面生效。默认是本机播放;进入遥控模式需要 Host 的令牌。
// 这个模块不依赖应用里的任何其他模块,存储层也要用它,所以单独放。

export type PlayTarget = 'remote' | 'local';

/** 遥控页的占位登录态里带的标记:中继认它来决定"这个请求用 Host 的账号"。 */
export const SHARED_ACCOUNT_MARKER = 'shared-with-stage-host';

/** 遥控模式下 Host 能点播的在线音源(账号列表、搜索来源、点歌都以它为准);新增音源要同时让 Host 能凭 { providerId, mediaId } 取详情并播放。 */
export const REMOTE_PLAYABLE_PROVIDER_IDS: ReadonlySet<string> = new Set(['netease', 'qq', 'kugou', 'spotify']);

const PLAY_TARGET_KEY = 'folia_play_target';

const readParams = (): URLSearchParams | null => {
    if (typeof window === 'undefined' || !window.location) return null;
    return new URLSearchParams(window.location.search);
};

export const isStageHostMode = (): boolean => readParams()?.get('host') === '1';

/** 桌面版:页面的地址背后没有中继(它的遥控走设置里的「遥控服务器」,在独立窗口里打开服务器的遥控页)。 */
const isDesktopApp = (): boolean => typeof window !== 'undefined' && Boolean((window as unknown as { electron?: unknown }).electron);

/** 这个部署有没有中继可连:配置了 VITE_STAGE_RELAY=1,或网址里手动带了 ?stageremote=1。 */
export const isStageRelayAvailable = (): boolean => (
    !isDesktopApp() && (import.meta.env.VITE_STAGE_RELAY === '1' || readParams()?.get('stageremote') === '1')
);

export const getStoredPlayTarget = (): PlayTarget => {
    try {
        return localStorage.getItem(PLAY_TARGET_KEY) === 'remote' ? 'remote' : 'local';
    } catch {
        return 'local';
    }
};

// ── 访问令牌 ──
// 遥控服务器需要 Host 那边的令牌(见中继 server/stage-relay)。令牌来自两处:
// 带 ?token= 的访问地址(打开即进入遥控模式),或在设置里选择遥控模式时填写。保存在本设备的 localStorage。
const STAGE_TOKEN_KEY = 'folia_stage_token';

export const getStageToken = (): string => {
    try {
        return localStorage.getItem(STAGE_TOKEN_KEY) || '';
    } catch {
        return '';
    }
};

export const saveStageToken = (token: string): void => {
    try {
        localStorage.setItem(STAGE_TOKEN_KEY, token);
    } catch { /* 存不了就只对本次页面有效 */ }
};

export const clearStageToken = (): void => {
    try {
        localStorage.removeItem(STAGE_TOKEN_KEY);
    } catch { /* ignore */ }
};

/** 发给中继的请求要带的令牌请求头。 */
export const getStageAuthHeaders = (): Record<string, string> => {
    const token = getStageToken();
    return token ? { 'X-Stage-Token': token } : {};
};

/** 给图片这类带不了请求头的地址加上令牌查询参数。 */
export const withStageTokenQuery = (url: string): string => {
    const token = getStageToken();
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
};

// 访问地址里带 ?token=:记下令牌;不是 Host 页的话同时选定遥控模式。随后把令牌从地址栏去掉,
// 免得它留在历史记录、截图和转发的链接里(要分享给别人用的是带令牌的完整链接,那是 Host 页上复制出来的)。
const ingestTokenFromUrl = (): void => {
    const params = readParams();
    const token = params?.get('token');
    if (!params || !token || typeof window === 'undefined') return;
    saveStageToken(token);
    if (params.get('host') !== '1') {
        try {
            localStorage.setItem(PLAY_TARGET_KEY, 'remote');
        } catch { /* ignore */ }
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    try {
        window.history.replaceState(window.history.state, '', url.toString());
    } catch { /* ignore */ }
};
ingestTokenFromUrl();

// ?host=1 为 Host;?local=1 / ?stageremote=1 是临时指定(不改保存的选择);
// 其余按保存的选择:只有带令牌的访问地址或在设置里选择并填写了令牌之后才是遥控,默认是本机播放。
export const isStageRemoteMode = (): boolean => {
    const params = readParams();
    if (!params || isDesktopApp()) return false;
    if (params.get('host') === '1' || params.get('local') === '1') return false;
    if (params.get('stageremote') === '1') return true;
    if (import.meta.env.VITE_STAGE_RELAY !== '1') return false;
    return getStoredPlayTarget() === 'remote';
};

/** 令牌被中继拒绝(换过令牌、令牌不对):清掉它并回到本机播放,免得遥控页一直报错。 */
export const handleStageAuthFailure = (): void => {
    try {
        if (sessionStorage.getItem('folia_stage_auth_reset') === '1') return;
        sessionStorage.setItem('folia_stage_auth_reset', '1');
    } catch { /* 没有 sessionStorage 就不防重复 */ }
    clearStageToken();
    switchPlayTarget('local');
};

/** 保存选择并刷新页面;网址里临时指定模式的参数要去掉,否则刷新后又被它盖过去。 */
export const switchPlayTarget = (target: PlayTarget): void => {
    try {
        localStorage.setItem(PLAY_TARGET_KEY, target);
    } catch { /* 存不了就只按网址参数决定 */ }
    if (typeof window === 'undefined' || !window.location) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('local');
    url.searchParams.delete('stageremote');
    // 换了模式,上一个模式的页面路由(歌单、专辑等)不一定还有意义,回到首页
    url.hash = '';
    window.location.replace(url.toString());
};
