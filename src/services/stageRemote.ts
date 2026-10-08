// src/services/stageRemote.ts
// 遥控模式:本页不出声,所有播放操作经 Stage 中继转给服务器上的 Host 页执行。

import type { SongResult, StagePlayerQueueRequest } from '../types';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';
import { readProviderSessionValue, writeProviderSessionValue } from './onlineMusic/providerStorage';

// ?host=1 为 Host,?local=1 强制本地播放;配置了 VITE_STAGE_RELAY=1 时其余访问默认遥控,?stageremote=1 手动开启
export const isStageRemoteMode = (): boolean => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('host') === '1' || params.get('local') === '1') return false;
    return params.get('stageremote') === '1' || import.meta.env.VITE_STAGE_RELAY === '1';
};

// 遥控端用占位 cookie 让应用按"已登录"运行,真实 cookie 由中继代理时替换为 Host 账号的
if (isStageRemoteMode() && !readProviderSessionValue('netease', 'cookie', ['netease_cookie'])) {
    writeProviderSessionValue('netease', 'cookie', 'MUSIC_U=shared-with-stage-host');
}

// 服务器播放进度的本地镜像,供每帧时钟循环推算当前位置
export const remoteClock = { positionMs: 0, receivedAt: 0, playing: false, durationMs: 0 };

export const getRemotePositionSec = (): number => {
    const elapsed = remoteClock.playing ? Date.now() - remoteClock.receivedAt : 0;
    const positionMs = remoteClock.positionMs + elapsed;
    return (remoteClock.durationMs > 0 ? Math.min(positionMs, remoteClock.durationMs) : positionMs) / 1000;
};

const request = async <T = any>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`/stage/player/${path}`, body === undefined ? undefined : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || `Stage relay request failed (${response.status})`);
    }
    return data as T;
};

export const fetchRemoteStatus = () => request('status');
export const fetchRemoteQueue = () => request('queue?limit=500');
export const remotePlaySong = (songId: number, appendToQueue = false) => request('play', { songId, appendToQueue });
export const remoteControl = (action: 'next' | 'prev' | 'pause' | 'resume' | 'seek', positionMs?: number) =>
    request('control', { action, ...(positionMs !== undefined ? { positionMs: Math.floor(positionMs) } : {}) });
export const remoteQueueOp = (payload: Omit<StagePlayerQueueRequest, 'requestId'>) => request('queue', payload);

const toRemoteSongId = (song: SongResult): number | null => {
    const songId = Number(song.id);
    if (!Number.isInteger(songId) || songId <= 0 || song.sourceType === 'cloud') return null;
    return songId;
};

const reportRemoteError = (error: unknown) => {
    setStatusMsg({ type: 'error', text: error instanceof Error ? error.message : String(error) });
};

// 遥控模式点歌:让 Host 播放这首歌,并把传入队列里的其余歌曲追加到 Host 队列
export const remotePlaySongWithQueue = async (song: SongResult, queue: SongResult[] = []): Promise<boolean> => {
    const songId = toRemoteSongId(song);
    if (songId === null) {
        setStatusMsg({ type: 'error', text: '遥控模式只支持网易云歌曲' });
        return false;
    }
    try {
        await remotePlaySong(songId);
        const rest = queue.map(toRemoteSongId).filter((id): id is number => id !== null && id !== songId);
        if (rest.length > 0) {
            await remoteQueueOp({ action: 'append', songIds: rest });
        }
        return true;
    } catch (error) {
        reportRemoteError(error);
        return false;
    }
};

// 遥控模式加入队列;behavior 为 'next' 时插到当前歌曲之后
export const remoteAddToQueue = async (songs: SongResult[], behavior: 'append' | 'next' = 'append') => {
    const songIds = songs.map(toRemoteSongId).filter((id): id is number => id !== null);
    if (songIds.length === 0) {
        setStatusMsg({ type: 'error', text: '遥控模式只支持网易云歌曲' });
        return 0;
    }
    try {
        await remoteQueueOp({ action: behavior === 'next' ? 'insert-next' : 'append', songIds });
        setStatusMsg({ type: 'success', text: '已加入服务器播放队列', nonce: Date.now(), durationMs: 1200 });
    } catch (error) {
        reportRemoteError(error);
        return 0;
    }
    return songIds.length;
};

export const remoteClearQueue = () => remoteQueueOp({ action: 'clear' }).catch(reportRemoteError);

export const remoteRemoveQueueSong = (index: number) =>
    remoteQueueOp({ action: 'remove', index }).catch(reportRemoteError);

export const remoteMoveQueueSong = (fromIndex: number, toIndex: number) =>
    remoteQueueOp({ action: 'move', fromIndex, toIndex }).catch(reportRemoteError);

// 把服务器队列依次移动成 targetQueue 的顺序(选择排序式,逐项 move),用于批量"下一首/移到末尾"
export const remoteReorderQueue = async (currentQueue: SongResult[], targetQueue: SongResult[]) => {
    const working = currentQueue.map(song => String(song.id));
    try {
        for (let toIndex = 0; toIndex < targetQueue.length; toIndex += 1) {
            const wanted = String(targetQueue[toIndex].id);
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
    const currentId = currentSong ? String(currentSong.id) : null;
    const ids = queue.map(toRemoteSongId).filter((id): id is number => id !== null && String(id) !== currentId);
    for (let index = ids.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [ids[index], ids[randomIndex]] = [ids[randomIndex], ids[index]];
    }
    try {
        await remoteQueueOp({ action: 'clear' });
        if (ids.length > 0) {
            await remoteQueueOp({ action: 'append', songIds: ids });
        }
    } catch (error) {
        reportRemoteError(error);
    }
};
