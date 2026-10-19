// scripts/start-netease-api.cjs
// 启动网易云 API:和桌面版用的是同一份代码(electron/netease/ 的工作线程,@neteasecloudmusicapienhanced/api 加上应用自己的补丁:
// 扫码登录的网络重试、请求超时、身份轮换、登录诊断等),所以服务端和桌面版的网易云行为一致,版本由仓库管,不再依赖仓库外的 api-enhanced 目录。
// 端口默认 4000,可用 NETEASE_PORT 覆盖;只监听本机,外部访问都经 Stage 中继或前端的 /ncm 代理。
// 桌面版同款的诊断(启动各步耗时、登录请求记录)写在日志里,行首是 [Netease API]。

const { createNeteaseApiHost } = require('../electron/netease/neteaseApiHost.cjs');

const port = Number(process.env.NETEASE_PORT) || 4000;
const host = process.env.NETEASE_HOST || '127.0.0.1';

const api = createNeteaseApiHost({
    logger: console,
    // 线程里没接住的异常、或线程结束:这个进程没有存在的意义了,退出让上层(stage-all)看见。
    onWorkerError: (error) => {
        console.error('[Netease API] the worker thread failed', error);
        process.exit(1);
    },
    onExit: (code) => process.exit(code || 1),
});

api.start({ host, port }).then(
    () => console.log(`[Netease API] listening on ${host}:${port}`),
    (error) => {
        console.error('[Netease API] could not start:', error instanceof Error ? error.message : error);
        process.exit(1);
    },
);
