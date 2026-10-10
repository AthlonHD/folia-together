// src/services/stageWebChannel.ts
// Web 版 Host 页与 Stage 中继之间的 WebSocket 通道,接口形状与 preload 中的 Stage 桥一致。

import type {
    StageExternalPlayRequest,
    StageExternalPlayResult,
    StagePlayerControlRequest,
    StagePlayerQueueRequest,
    StagePlayerRequestResult,
    StagePlayerSnapshot,
} from '../types';
import { readProviderSessionValue } from './onlineMusic/providerStorage';
import { getHostRpcHandler } from './hostRpcRegistry';

export interface StageBridge {
    publishStagePlayerSnapshot: (snapshot: StagePlayerSnapshot, options?: { forcePlaybackEvent?: boolean }) => Promise<unknown>;
    completeStagePlayerControlRequest: (result: StagePlayerRequestResult) => Promise<boolean>;
    completeStagePlayerQueueRequest: (result: StagePlayerRequestResult) => Promise<boolean>;
    completeStageExternalPlayRequest: (result: StageExternalPlayResult) => Promise<boolean>;
    onStagePlayerControlRequest: (callback: (request: StagePlayerControlRequest) => void) => () => void;
    onStagePlayerQueueRequest: (callback: (request: StagePlayerQueueRequest) => void) => () => void;
    onStageExternalPlayRequest: (callback: (request: StageExternalPlayRequest) => void) => () => void;
}

const HOST_WS_PATH = '/stage/host/ws';
const RECONNECT_DELAY_MS = 2000;
const ACCOUNT_SYNC_INTERVAL_MS = 10_000;

type Listener = (payload: any) => void;

// 创建单例通道:自动连接、断线重连,按 channel 分发中继转来的请求
const createStageWebChannel = (): StageBridge => {
    const listeners: Record<string, Set<Listener>> = {
        'stage-player-control-request': new Set(),
        'stage-player-queue-request': new Set(),
        'stage-external-play-request': new Set(),
    };
    let socket: WebSocket | null = null;

    const connect = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}${HOST_WS_PATH}`);
        socket = ws;
        ws.onopen = syncAccount;
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(String(event.data));
                if (message.type === 'request') {
                    listeners[message.channel]?.forEach((listener) => listener(message.payload));
                } else if (message.type === 'rpc') {
                    void answerRpc(ws, message);
                }
            } catch (error) {
                console.warn('[Stage] Bad relay message', error);
            }
        };
        ws.onclose = () => {
            if (socket === ws) {
                socket = null;
                window.setTimeout(connect, RECONNECT_DELAY_MS);
            }
        };
    };

    // 把 Host 登录的网易云 cookie 和 QQ 音乐会话交给中继,由中继在代理请求时替换给所有访问者
    const syncAccount = () => {
        send({
            type: 'account',
            cookie: readProviderSessionValue('netease', 'cookie', ['netease_cookie']),
            qqCookie: readProviderSessionValue('qq', 'cookie'),
        });
    };

    // 中继向 Host 要数据(本地曲库、封面、歌词):按 method 找处理函数,把结果或错误回给中继
    const answerRpc = async (ws: WebSocket, message: { id: string; method: string; params?: unknown }) => {
        const reply = (payload: Record<string, unknown>) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'rpc-result', id: message.id, ...payload }));
        };
        const handler = getHostRpcHandler(message.method);
        if (!handler) {
            reply({ ok: false, error: `Unknown rpc method: ${message.method}` });
            return;
        }
        try {
            reply({ ok: true, data: await handler(message.params ?? {}) });
        } catch (error) {
            reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    };

    const send = (message: unknown) => {
        if (socket?.readyState !== WebSocket.OPEN) {
            return false;
        }
        socket.send(JSON.stringify(message));
        return true;
    };

    const subscribe = (channel: string) => (callback: Listener) => {
        listeners[channel].add(callback);
        return () => { listeners[channel].delete(callback); };
    };

    connect();
    window.setInterval(syncAccount, ACCOUNT_SYNC_INTERVAL_MS);
    // 本地曲库的 RPC 处理依赖数据库和歌词解析等较重的模块,Host 页才需要,按需加载
    void import('./hostLocalLibraryRpc').then(module => module.registerHostLocalLibraryRpc());

    return {
        publishStagePlayerSnapshot: async (snapshot, options) => send({ type: 'snapshot', snapshot, options }),
        completeStagePlayerControlRequest: async (payload) => send({ type: 'complete', kind: 'control', payload }),
        completeStagePlayerQueueRequest: async (payload) => send({ type: 'complete', kind: 'queue', payload }),
        completeStageExternalPlayRequest: async (payload) => send({ type: 'complete', kind: 'play', payload }),
        onStagePlayerControlRequest: subscribe('stage-player-control-request'),
        onStagePlayerQueueRequest: subscribe('stage-player-queue-request'),
        onStageExternalPlayRequest: subscribe('stage-external-play-request'),
    };
};

let webChannel: StageBridge | null = null;

// Host 模式由 URL 参数 ?host=1 开启
export const isStageHostMode = (): boolean =>
    typeof window !== 'undefined' && Boolean(window.location) && new URLSearchParams(window.location.search).get('host') === '1';

// 桌面版返回 Electron 桥,Web Host 页返回 WebSocket 通道,其余情况返回 null
export const getStageBridge = (): StageBridge | null => {
    if (typeof window === 'undefined') return null;
    if (window.electron?.publishStagePlayerSnapshot) {
        return window.electron as unknown as StageBridge;
    }
    if (!isStageHostMode()) return null;
    webChannel ??= createStageWebChannel();
    return webChannel;
};
