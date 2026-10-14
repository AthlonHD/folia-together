// src/services/stageRemote.ts
// 遥控模式:本页不出声,所有播放操作经 Stage 中继转给服务器上的 Host 页执行。

import type { SongResult, StagePlayerQueueRequest } from '../types';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';
import { getPlaybackSongKey, getPlaybackSourceRef, isLocalPlaybackSong } from '../utils/appPlaybackGuards';
import { writeProviderSessionValue } from './onlineMusic/providerStorage';
import {
    getStageAuthHeaders,
    getStageToken,
    handleStageAuthFailure,
    isStageRemoteMode,
    REMOTE_PLAYABLE_PROVIDER_IDS,
    SHARED_ACCOUNT_MARKER,
} from './stageMode';
import { installRemoteStorageShield } from './remoteStorageShield';

// 模式判断在 stageMode.ts(存储层也要用);这里转出,现有的 import 不用改
export { isStageRemoteMode } from './stageMode';

// 遥控端用占位 cookie 让应用按"已登录"运行,中继代理时认出占位,换成 Host 账号的真实登录态。
// 遥控模式的账号存储与本机模式分开(见 providerStorage),所以这里每次都重写,不会碰本机自己的账号。
if (isStageRemoteMode()) {
    // 占位里带着访问令牌(`标记:令牌`):中继借用 Host 账号前要验它,没有令牌的页面借不到 Host 的账号
    const placeholder = `${SHARED_ACCOUNT_MARKER}:${getStageToken()}`;
    writeProviderSessionValue('netease', 'cookie', `MUSIC_U=${placeholder}`);
    writeProviderSessionValue('qq', 'cookie', `qqmusic_session=${placeholder}`);
    // 酷狗按 token / userid / dfid 三项判断"已登录",占位三项都写上;userid 由中继换成 Host 账号的
    for (const key of ['token', 'userid', 'dfid']) writeProviderSessionValue('kugou', key, placeholder);
    installRemoteStorageShield();
}

// 服务器播放进度的本地镜像,供每帧时钟循环推算当前位置
export const remoteClock = { positionMs: 0, receivedAt: 0, playing: false, durationMs: 0 };

export const getRemotePositionSec = (): number => {
    const elapsed = remoteClock.playing ? Date.now() - remoteClock.receivedAt : 0;
    const positionMs = remoteClock.positionMs + elapsed;
    return (remoteClock.durationMs > 0 ? Math.min(positionMs, remoteClock.durationMs) : positionMs) / 1000;
};

const request = async <T = any>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`/stage/player/${path}`, body === undefined ? { headers: getStageAuthHeaders() } : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getStageAuthHeaders() },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) handleStageAuthFailure();
    if (!response.ok) {
        throw new Error(data?.error || `Stage relay request failed (${response.status})`);
    }
    return data as T;
};

/**
 * 让 Host 播放的歌:网易云歌曲用数字 songId,Host 本地曲库里的歌用字符串 localSongId,
 * 其他在线音源(QQ 音乐等)用 online = { providerId, mediaId }。
 */
export type RemoteSongRef =
    | { songId: number; localSongId?: undefined; online?: undefined }
    | { localSongId: string; songId?: undefined; online?: undefined }
    | { online: { providerId: string; mediaId: string }; songId?: undefined; localSongId?: undefined };

export const remoteSetLoopMode = (loopMode: 'off' | 'all' | 'one' | 'shuffle' | 'heartbeat') =>
    request('control', { action: 'set-loop', loopMode });
/** 告诉 Host 这批歌来自网易云「我喜欢的音乐」(playlistId 为 null 表示清除),心动模式在 Host 上才认得。 */
export const remoteSetHeartbeatContext = (playlistId: string | number | null, songKeys: readonly string[]) =>
    request('control', { action: 'set-heartbeat-context', playlistId, songKeys });
/** 把遥控端改的播放设置(音质、音量、均衡器等)交给 Host 应用 */
export const remoteSetSettings = (settings: Record<string, unknown>) =>
    request('control', { action: 'set-settings', settings });
export const fetchRemoteStatus = () => request('status');
export const fetchRemoteQueue = () => request('queue?limit=500');
export const remotePlaySong = (ref: RemoteSongRef, appendToQueue = false, fm?: { queueSongIds: number[] }) =>
    request('play', { ...ref, appendToQueue, ...(fm ? { fm: true, queueSongIds: fm.queueSongIds } : {}) });
export const remoteControl = (action: 'next' | 'prev' | 'pause' | 'resume' | 'seek', positionMs?: number) =>
    request('control', { action, ...(positionMs !== undefined ? { positionMs: Math.floor(positionMs) } : {}) });
export const remoteQueueOp = (payload: Omit<StagePlayerQueueRequest, 'requestId'>) => request('queue', payload);

// 先判断本地歌:本地歌在播放器里的 id 也是个数字(字符串 id 的哈希),不能当成网易云 id 发出去。
// 网易云歌曲继续用数字 songId;QQ 音乐等其他在线音源用 { providerId, mediaId }。
const toRemoteSongRef = (song: SongResult): RemoteSongRef | null => {
    if (isLocalPlaybackSong(song)) return { localSongId: song.localRef.songId };
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online' || sourceRef.variant === 'cloud') return null;
    if (sourceRef.providerId === 'netease') {
        const songId = Number(sourceRef.mediaId);
        if (!Number.isInteger(songId) || songId <= 0 || song.sourceType === 'cloud') return null;
        return { songId };
    }
    if (!REMOTE_PLAYABLE_PROVIDER_IDS.has(sourceRef.providerId) || !sourceRef.mediaId) return null;
    return { online: { providerId: sourceRef.providerId, mediaId: sourceRef.mediaId } };
};

const refKey = (ref: RemoteSongRef): string => (
    ref.localSongId !== undefined
        ? `local:${ref.localSongId}`
        : ref.online ? `${ref.online.providerId}:${ref.online.mediaId}` : `netease:${ref.songId}`
);

const isSameRef = (a: RemoteSongRef, b: RemoteSongRef) => refKey(a) === refKey(b);

/** 转成队列接口的 items(保持顺序,可混合网易云、本地与其他在线音源)。 */
const toQueueItems = (refs: RemoteSongRef[]) => refs.map(ref => (
    ref.localSongId !== undefined
        ? { localSongId: ref.localSongId }
        : ref.online ? { ...ref.online } : { songId: ref.songId }
));

const UNSUPPORTED_SONG_TEXT = '遥控模式只支持网易云、QQ 音乐歌曲和服务器本地曲库里的歌曲';

const reportRemoteError = (error: unknown) => {
    setStatusMsg({ type: 'error', text: error instanceof Error ? error.message : String(error) });
};

// 遥控模式点歌:让 Host 播放这首歌,并把传入队列里的其余歌曲追加到 Host 队列
export const remotePlaySongWithQueue = async (song: SongResult, queue: SongResult[] = [], isFm = false): Promise<boolean> => {
    const ref = toRemoteSongRef(song);
    if (ref === null) {
        setStatusMsg({ type: 'error', text: UNSUPPORTED_SONG_TEXT });
        return false;
    }
    try {
        const rest = queue
            .map(toRemoteSongRef)
            .filter((candidate): candidate is RemoteSongRef => candidate !== null && !isSameRef(candidate, ref));
        if (isFm) {
            // 个性化电台:Host 以 FM 方式播放,队列末尾由 Host 继续补歌(电台只有网易云歌曲)
            await remotePlaySong(ref, false, {
                queueSongIds: rest.flatMap(candidate => (candidate.songId !== undefined ? [candidate.songId] : [])),
            });
            return true;
        }
        await remotePlaySong(ref);
        if (rest.length > 0) {
            await remoteQueueOp({ action: 'append', items: toQueueItems(rest) });
        }
        return true;
    } catch (error) {
        reportRemoteError(error);
        return false;
    }
};

// 遥控模式"立即播放":只让 Host 播这一首(Host 会把它插到当前位置之后),不动队列其余部分
export const remotePlayNow = async (song: SongResult): Promise<boolean> => {
    const ref = toRemoteSongRef(song);
    if (ref === null) {
        setStatusMsg({ type: 'error', text: UNSUPPORTED_SONG_TEXT });
        return false;
    }
    try {
        await remotePlaySong(ref);
        return true;
    } catch (error) {
        reportRemoteError(error);
        return false;
    }
};

// 遥控模式在服务器队列里跳到第 index 首
export const remoteSelectQueueSong = async (index: number): Promise<boolean> => {
    try {
        await remoteQueueOp({ action: 'select', index });
        return true;
    } catch (error) {
        reportRemoteError(error);
        return false;
    }
};

// 遥控模式加入队列;behavior 为 'next' 时插到当前歌曲之后
export const remoteAddToQueue = async (songs: SongResult[], behavior: 'append' | 'next' = 'append') => {
    const refs = songs.map(toRemoteSongRef).filter((ref): ref is RemoteSongRef => ref !== null);
    if (refs.length === 0) {
        setStatusMsg({ type: 'error', text: UNSUPPORTED_SONG_TEXT });
        return 0;
    }
    try {
        await remoteQueueOp({ action: behavior === 'next' ? 'insert-next' : 'append', items: toQueueItems(refs) });
        setStatusMsg({ type: 'success', text: '已加入服务器播放队列', nonce: Date.now(), durationMs: 1200 });
    } catch (error) {
        reportRemoteError(error);
        return 0;
    }
    return refs.length;
};

export const remoteClearQueue = () => remoteQueueOp({ action: 'clear' }).catch(reportRemoteError);

export const remoteRemoveQueueSong = (index: number) =>
    remoteQueueOp({ action: 'remove', index }).catch(reportRemoteError);

export const remoteMoveQueueSong = (fromIndex: number, toIndex: number) =>
    remoteQueueOp({ action: 'move', fromIndex, toIndex }).catch(reportRemoteError);

// 把服务器队列依次移动成 targetQueue 的顺序(选择排序式,逐项 move),用于批量"下一首/移到末尾"
export const remoteReorderQueue = async (currentQueue: SongResult[], targetQueue: SongResult[]) => {
    const working = currentQueue.map(song => getPlaybackSongKey(song));
    try {
        for (let toIndex = 0; toIndex < targetQueue.length; toIndex += 1) {
            const wanted = getPlaybackSongKey(targetQueue[toIndex]);
            const fromIndex = working.indexOf(wanted, toIndex);
            if (fromIndex === -1 || fromIndex === toIndex) continue;
            await remoteQueueOp({ action: 'move', fromIndex, toIndex });
            working.splice(toIndex, 0, ...working.splice(fromIndex, 1));
        }
    } catch (error) {
        reportRemoteError(error);
    }
};

// 随机播放:清空服务器队列(保留当前曲)后,按打乱后的顺序重新追加,只需两次请求
export const remoteShuffleQueue = async (queue: SongResult[], currentSong: SongResult | null) => {
    const currentRef = currentSong ? toRemoteSongRef(currentSong) : null;
    const refs = queue
        .map(toRemoteSongRef)
        .filter((ref): ref is RemoteSongRef => ref !== null && !(currentRef && isSameRef(ref, currentRef)));
    for (let index = refs.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [refs[index], refs[randomIndex]] = [refs[randomIndex], refs[index]];
    }
    try {
        await remoteQueueOp({ action: 'clear' });
        if (refs.length > 0) {
            await remoteQueueOp({ action: 'append', items: toQueueItems(refs) });
        }
    } catch (error) {
        reportRemoteError(error);
    }
};
