// server/stage-relay/index.cjs
// Web 版 Stage 中继:复用 electron/stageApi.cjs 的路由与状态逻辑,
// 把原本的 Electron IPC 换成与 Host 页之间的 WebSocket。无鉴权,仅限小群内网/反代使用。

const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createStageApi } = require('../../electron/stageApi.cjs');

const PORT = Number(process.env.STAGE_PORT) || 4100;
const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';
const NETEASE_PORT = Number(process.env.NETEASE_PORT) || 4000;
const HOST_WS_PATH = '/stage/host/ws';
// 只放行点歌/遥控所需路由,歌词注入、媒体上传、清状态等写入类路由一律 404
const ALLOWED_ROUTES = [/^\/stage\/health$/, /^\/stage\/player\//];
// 这三个 channel 对应桌面版主进程发给渲染进程的请求
const FORWARDED_CHANNELS = new Set([
  'stage-player-control-request',
  'stage-player-queue-request',
  'stage-external-play-request',
]);

let hostSocket = null;
// Host 页登录的网易云 cookie,只保存在内存里,不下发给任何浏览器
let hostNeteaseCookie = null;
// 登录相关接口原样透传;/logout 会让 Host 账号下线,一律拒绝
// /login/status 要换成 Host 的 cookie,否则遥控端判定为未登录
const NETEASE_PASSTHROUGH = /^\/(login(?!\/status)|register|captcha)/;
const hostWss = new WebSocketServer({ noServer: true });

// 伪装成 Electron BrowserWindow,只实现 stageApi 用到的两个成员
const fakeMainWindow = {
  isDestroyed: () => !hostSocket || hostSocket.readyState !== 1,
  webContents: {
    send: (channel, payload) => {
      if (!FORWARDED_CHANNELS.has(channel) || !hostSocket || hostSocket.readyState !== 1) return;
      hostSocket.send(JSON.stringify({ type: 'request', channel, payload }));
    },
  },
};

const memoryStore = new Map([['stageModeEnabled', true], ['stageModeSource', 'stage-api']]);
const store = {
  get: (key) => memoryStore.get(key),
  set: (key, value) => memoryStore.set(key, value),
  has: (key) => memoryStore.has(key),
};

let stageApi = null;

// /ncm/* 反向代理到本机网易云 API,并把请求里的 cookie 换成 Host 账号的,让所有访问者共用 Host 账号
const handleNeteaseProxy = async (req, res, requestUrl) => {
  if (!requestUrl.pathname.startsWith('/ncm/')) return false;

  const apiPath = requestUrl.pathname.slice('/ncm'.length);
  if (apiPath.startsWith('/logout')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 403, message: 'Logout is disabled on the shared account.' }));
    return true;
  }

  const target = new URL(`http://127.0.0.1:${NETEASE_PORT}${apiPath}`);
  requestUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  const injected = Boolean(hostNeteaseCookie) && !NETEASE_PASSTHROUGH.test(apiPath);
  if (injected) {
    target.searchParams.set('cookie', hostNeteaseCookie);
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
    const upstream = await fetch(target, {
      method: req.method,
      headers: req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {},
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    let body = Buffer.from(await upstream.arrayBuffer());
    // 响应里的 cookie 字段就是 Host 的真实 cookie,不能下发给浏览器
    if (injected && contentType.includes('json')) {
      try {
        const json = JSON.parse(body.toString('utf-8'));
        if (json && typeof json === 'object' && 'cookie' in json) {
          delete json.cookie;
          body = Buffer.from(JSON.stringify(json));
        }
      } catch { /* 非 JSON 原样返回 */ }
    }
    res.writeHead(upstream.status, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 502, message: String(error) }));
  }
  return true;
};

// Host 页升级到 /stage/host/ws 时接管;同时只保留一个 Host,新连接顶掉旧连接
const handleHostUpgrade = (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname !== HOST_WS_PATH) return false;

  hostWss.handleUpgrade(req, socket, head, (ws) => {
    if (hostSocket && hostSocket !== ws) {
      try { hostSocket.close(4000, 'Replaced by a new host.'); } catch { /* ignore */ }
    }
    hostSocket = ws;
    console.log('[Relay] Host connected.');

    ws.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'account') {
        hostNeteaseCookie = typeof message.cookie === 'string' && message.cookie ? message.cookie : null;
      } else if (message.type === 'snapshot') {
        stageApi.publishStagePlayerSnapshot(message.snapshot, message.options || {});
      } else if (message.type === 'complete') {
        const handlers = {
          control: stageApi.completeStagePlayerControlRequest,
          queue: stageApi.completeStagePlayerQueueRequest,
          play: stageApi.completeStageExternalPlayRequest,
        };
        handlers[message.kind]?.(message.payload);
      }
    });
    ws.on('close', () => {
      if (hostSocket === ws) {
        hostSocket = null;
        console.log('[Relay] Host disconnected.');
      }
    });
  });
  return true;
};

stageApi = createStageApi({
  app: { getPath: () => path.join(os.tmpdir(), 'folia-stage-relay') },
  store,
  getMainWindow: () => fakeMainWindow,
  stageModeEnabledSettingKey: 'stageModeEnabled',
  stageModeSourceSettingKey: 'stageModeSource',
  stageApiTokenSettingKey: 'stageApiToken',
  stageApiPortSettingKey: 'stageApiPort',
  defaultStageApiPort: PORT,
  getNeteasePort: () => NETEASE_PORT,
  listenHost: LISTEN_HOST,
  skipAuth: true,
  routeFilter: (pathname, method) => method === 'OPTIONS' || ALLOWED_ROUTES.some((re) => re.test(pathname)),
  extraUpgradeHandler: handleHostUpgrade,
  extraHttpHandler: handleNeteaseProxy,
});

stageApi.startStageServerIfNeeded().then(() => {
  console.log(`[Relay] Listening on ${LISTEN_HOST}:${PORT}, Netease API on 127.0.0.1:${NETEASE_PORT}`);
}).catch((error) => {
  console.error('[Relay] Failed to start', error);
  process.exit(1);
});
