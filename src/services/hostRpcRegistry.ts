// src/services/hostRpcRegistry.ts
// Host 页响应中继 RPC 的处理函数注册表:中继想读 Host 本机的数据(本地曲库、封面、歌词)时,
// 通过 WebSocket 发来 { type: 'rpc', id, method, params },stageWebChannel 按 method 查这里并把结果回给中继。

export type HostRpcHandler = (params: any) => Promise<unknown> | unknown;

const handlers = new Map<string, HostRpcHandler>();

export const registerHostRpcHandler = (method: string, handler: HostRpcHandler) => {
    handlers.set(method, handler);
};

export const getHostRpcHandler = (method: string): HostRpcHandler | undefined => handlers.get(method);
