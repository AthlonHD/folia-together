// src/services/stageMode.ts
// 本页以哪种方式运行:
// - Host:?host=1,在服务器上真正出声的那一页。
// - 遥控:不出声,所有播放操作经 Stage 中继转给 Host(配置了 VITE_STAGE_RELAY=1 时对访问者默认)。
// - 本机:和原版一样在本设备上播放,账号、队列、曲库都是本设备自己的。
// 遥控与本机的选择存在本设备的 localStorage 里,切换后刷新页面生效。
// 这个模块不依赖应用里的任何其他模块,存储层也要用它,所以单独放。

export type PlayTarget = 'remote' | 'local';

/** 遥控页的占位登录态里带的标记:中继认它来决定"这个请求用 Host 的账号"。 */
export const SHARED_ACCOUNT_MARKER = 'shared-with-stage-host';

/** 遥控模式下 Host 能点播的在线音源(账号列表、搜索来源、点歌都以它为准);新增音源要同时让 Host 能凭 { providerId, mediaId } 取详情并播放。 */
export const REMOTE_PLAYABLE_PROVIDER_IDS: ReadonlySet<string> = new Set(['netease', 'qq']);

const PLAY_TARGET_KEY = 'folia_play_target';

const readParams = (): URLSearchParams | null => {
    if (typeof window === 'undefined' || !window.location) return null;
    return new URLSearchParams(window.location.search);
};

export const isStageHostMode = (): boolean => readParams()?.get('host') === '1';

/** 这个部署有没有中继可连:配置了 VITE_STAGE_RELAY=1,或网址里手动带了 ?stageremote=1。 */
export const isStageRelayAvailable = (): boolean => (
    import.meta.env.VITE_STAGE_RELAY === '1' || readParams()?.get('stageremote') === '1'
);

export const getStoredPlayTarget = (): PlayTarget => {
    try {
        return localStorage.getItem(PLAY_TARGET_KEY) === 'local' ? 'local' : 'remote';
    } catch {
        return 'remote';
    }
};

// ?host=1 为 Host;?local=1 / ?stageremote=1 是临时指定(不改保存的选择);其余按保存的选择,默认遥控。
export const isStageRemoteMode = (): boolean => {
    const params = readParams();
    if (!params) return false;
    if (params.get('host') === '1' || params.get('local') === '1') return false;
    if (params.get('stageremote') === '1') return true;
    if (import.meta.env.VITE_STAGE_RELAY !== '1') return false;
    return getStoredPlayTarget() !== 'local';
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
