// server/stage-relay/index.cjs
// Web 版 Stage 中继:复用 electron/stageApi.cjs 的路由与状态逻辑,
// 把原本的 Electron IPC 换成与 Host 页之间的 WebSocket。无鉴权,仅限小群内网/反代使用。

const os = require('os');
const crypto = require('crypto');
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
// 中继向 Host 页发起的请求(读取 Host 的本地曲库、封面、歌词)等待结果的表
const pendingHostRpc = new Map();
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

// 向 Host 页发一个 RPC 并等结果。Host 不在线、超时或 Host 报错都会 reject。
const hostRpc = (method, params, timeoutMs = 30000) => new Promise((resolve, reject) => {
  if (!hostSocket || hostSocket.readyState !== 1) {
    reject(new Error('Host is offline'));
    return;
  }
  const id = crypto.randomUUID();
  const timer = setTimeout(() => {
    pendingHostRpc.delete(id);
    reject(new Error('Host RPC timed out'));
  }, timeoutMs);
  pendingHostRpc.set(id, { resolve, reject, timer });
  hostSocket.send(JSON.stringify({ type: 'rpc', id, method, params }));
});

// ---- Host 本地曲库的只读共享:曲库列表、封面、歌词都由 Host 页读自己的数据库后回给遥控端 ----
const LIBRARY_CACHE_TTL_MS = 15_000;
const COVER_CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
const COVER_ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const LOCAL_SONG_ID = /^[\w.:-]{1,200}$/;
let libraryCache = null;
const coverCache = new Map();
let coverCacheBytes = 0;

const sendJson = (res, statusCode, payload) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};

const rememberCover = (key, value) => {
  coverCache.set(key, value);
  coverCacheBytes += value.bytes.length;
  while (coverCacheBytes > COVER_CACHE_LIMIT_BYTES && coverCache.size > 1) {
    const [oldestKey, oldest] = coverCache.entries().next().value;
    coverCache.delete(oldestKey);
    coverCacheBytes -= oldest.bytes.length;
  }
};

const handleHostLocalLibrary = async (req, res, requestUrl) => {
  const { pathname } = requestUrl;
  if (!pathname.startsWith('/stage/local/')) return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return true;
  }

  try {
    if (pathname === '/stage/local/library') {
      if (!libraryCache || Date.now() - libraryCache.at > LIBRARY_CACHE_TTL_MS) {
        libraryCache = { at: Date.now(), body: JSON.stringify(await hostRpc('local-library', {}, 60000)) };
      }
      sendJson(res, 200, libraryCache.body);
      return true;
    }

    const coverMatch = /^\/stage\/local\/cover\/(.+)$/.exec(pathname);
    if (coverMatch) {
      const assetId = decodeURIComponent(coverMatch[1]);
      const sizeParam = Number(requestUrl.searchParams.get('size'));
      const size = sizeParam === 512 || sizeParam === 1024 ? sizeParam : 0;
      if (!COVER_ASSET_ID.test(assetId)) {
        sendJson(res, 400, { error: 'Invalid cover id.' });
        return true;
      }
      const key = `${assetId}@${size}`;
      let cover = coverCache.get(key);
      if (!cover) {
        const data = await hostRpc('local-cover', { assetId, size });
        // 只接受图片:Host 那边出了岔子时不能把别的内容缓存成"永不过期的封面"
        if (!data || !data.base64 || !String(data.mime || '').startsWith('image/')) {
          sendJson(res, 404, { error: 'Cover not found.' });
          return true;
        }
        cover = { mime: data.mime, bytes: Buffer.from(data.base64, 'base64') };
        rememberCover(key, cover);
      }
      // 封面按内容哈希寻址,内容不会变,可以放心长期缓存
      res.writeHead(200, {
        'Content-Type': cover.mime,
        'Content-Length': cover.bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(cover.bytes);
      return true;
    }

    const lyricsMatch = /^\/stage\/local\/lyrics\/(.+)$/.exec(pathname);
    if (lyricsMatch) {
      const songId = decodeURIComponent(lyricsMatch[1]);
      if (!LOCAL_SONG_ID.test(songId)) {
        sendJson(res, 400, { error: 'Invalid song id.' });
        return true;
      }
      sendJson(res, 200, await hostRpc('local-lyrics', { songId }));
      return true;
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    sendJson(res, 503, { error: String(error?.message || error) });
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
      if (message.type === 'rpc-result') {
        const pending = pendingHostRpc.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingHostRpc.delete(message.id);
          if (message.ok) pending.resolve(message.data);
          else pending.reject(new Error(String(message.error || 'Host RPC failed')));
        }
      } else if (message.type === 'account') {
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
        for (const [id, pending] of pendingHostRpc) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Host disconnected'));
          pendingHostRpc.delete(id);
        }
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
  extraHttpHandler: async (req, res, requestUrl) => (
    (await handleNeteaseProxy(req, res, requestUrl)) || (await handleHostLocalLibrary(req, res, requestUrl))
  ),
});

stageApi.startStageServerIfNeeded().then(() => {
  console.log(`[Relay] Listening on ${LISTEN_HOST}:${PORT}, Netease API on 127.0.0.1:${NETEASE_PORT}`);
}).catch((error) => {
  console.error('[Relay] Failed to start', error);
  process.exit(1);
});
