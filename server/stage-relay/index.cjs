// server/stage-relay/index.cjs
// Web 版 Stage 中继:复用 electron/stageApi.cjs 的路由与状态逻辑,
// 把原本的 Electron IPC 换成与 Host 页之间的 WebSocket。无鉴权,仅限小群内网/反代使用。

const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createStageApi } = require('../../electron/stageApi.cjs');
const { createSpotifyRelay } = require('./spotify.cjs');

const PORT = Number(process.env.STAGE_PORT) || 4100;
const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';
const fs = require('fs');
const NETEASE_PORT = Number(process.env.NETEASE_PORT) || 4000;
const QQ_PORT = Number(process.env.QQ_PORT) || 4300;
const KUGOU_PORT = Number(process.env.KUGOU_PORT) || 4400;
const HOST_WS_PATH = '/stage/host/ws';
// 只放行点歌/遥控所需路由,歌词注入、媒体上传、清状态等写入类路由一律 404
const ALLOWED_ROUTES = [/^\/stage\/health$/, /^\/stage\/player\//];
// 这三个 channel 对应桌面版主进程发给渲染进程的请求
const FORWARDED_CHANNELS = new Set([
  'stage-player-control-request',
  'stage-player-queue-request',
  'stage-external-play-request',
]);

// ---- 访问令牌 ----
// 只有持有令牌的页面才能遥控 Host、读 Host 的曲库、借用 Host 的账号;Host 页自己连中继也要带。
// 令牌来源:环境变量 STAGE_TOKEN > 文件(默认 ~/.folia-stage/token,第一次启动随机生成并保存)。
// 中继之前还有 Vite 反代,所有连接看起来都来自本机,所以不能按来源地址放行,一律验令牌。
const TOKEN_FILE = process.env.STAGE_TOKEN_FILE || path.join(os.homedir(), '.folia-stage', 'token');
const loadStageToken = () => {
  const fromEnv = String(process.env.STAGE_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (saved) return saved;
  } catch { /* 还没有:下面生成 */ }
  const generated = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, generated, { mode: 0o600 });
  return generated;
};
const STAGE_TOKEN = loadStageToken();
const sameSecret = (candidate) => {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(STAGE_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// 令牌错误的请求限流(全局):防止有人在线暴力猜测
const FAILED_AUTH_WINDOW_MS = 60_000;
const FAILED_AUTH_LIMIT = 30;
const failedAuthTimes = [];
const noteFailedAuth = () => {
  const now = Date.now();
  while (failedAuthTimes.length > 0 && now - failedAuthTimes[0] > FAILED_AUTH_WINDOW_MS) failedAuthTimes.shift();
  failedAuthTimes.push(now);
};
const isAuthRateLimited = () => {
  const now = Date.now();
  return failedAuthTimes.filter((time) => now - time <= FAILED_AUTH_WINDOW_MS).length >= FAILED_AUTH_LIMIT;
};
/** 请求头 X-Stage-Token 或查询参数 token(图片、WebSocket 带不了请求头)。 */
const readRequestToken = (req, requestUrl) => String(req.headers['x-stage-token'] || requestUrl.searchParams.get('token') || '');
// 账号占位登录态里带着令牌:`shared-with-stage-host:<令牌>`,代理共用账号的请求时从中取出来验
const SHARED_TOKEN_PATTERN = new RegExp(`${'shared-with-stage-host'}:([A-Za-z0-9_-]+)`);
const sharedAccountTokenOf = (text) => SHARED_TOKEN_PATTERN.exec(String(text || ''))?.[1] || '';

let hostSocket = null;
// 中继向 Host 页发起的请求(读取 Host 的本地曲库、封面、歌词)等待结果的表
const pendingHostRpc = new Map();
// Host 页登录的网易云 cookie,只保存在内存里,不下发给任何浏览器
let hostNeteaseCookie = null;
// Host 页登录的 QQ 音乐会话(`qqmusic_session=<token>`),同样只放内存
let hostQqCookie = null;
// Host 页登录的酷狗会话(`token=..;userid=..;dfid=..`),同样只放内存
let hostKugouCookie = null;
// 遥控页用占位登录态表示"我用 Host 的账号";只有带这个占位的请求才换成 Host 的真实登录态。
// 本机播放模式的访问者自己登录了账号,请求带的是自己的登录态,原样放行,不会被顶成 Host 的账号。
const SHARED_ACCOUNT_MARKER = 'shared-with-stage-host';
// 借用 Host 账号的请求必须带对的令牌(占位登录态里),否则拒绝。返回 true 表示已回复拒绝。
const rejectBadSharedToken = (res, sourceText) => {
  const limited = isAuthRateLimited();
  if (!limited && sameSecret(sharedAccountTokenOf(sourceText))) return false;
  if (!limited) noteFailedAuth();
  res.writeHead(limited ? 429 : 403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: limited ? 429 : 403, message: 'A valid stage token is required to use the shared account.' }));
  return true;
};
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
  const usesSharedAccount = String(requestUrl.searchParams.get('cookie') || '').includes(SHARED_ACCOUNT_MARKER);
  if (usesSharedAccount && rejectBadSharedToken(res, requestUrl.searchParams.get('cookie'))) return true;
  // 登出只拦共用账号的请求:本机模式的访问者可以退出自己的账号
  if (apiPath.startsWith('/logout') && usesSharedAccount) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 403, message: 'Logout is disabled on the shared account.' }));
    return true;
  }

  const target = new URL(`http://127.0.0.1:${NETEASE_PORT}${apiPath}`);
  requestUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  const injected = usesSharedAccount && Boolean(hostNeteaseCookie) && !NETEASE_PASSTHROUGH.test(apiPath);
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

// /qq/* 反向代理到本机 QQ 音乐 API:非登录接口一律换成 Host 账号的会话,让所有访问者共用 Host 账号。
// 登录接口(扫码)原样透传,否则 Host 自己扫码时二维码会话会被打断。
const QQ_PASSTHROUGH = /^\/login\/(?!status)/;
const QQ_SESSION_HEADER = 'X-QQ-Session';
const handleQqProxy = async (req, res, requestUrl) => {
  if (!requestUrl.pathname.startsWith('/qq/')) return false;

  const apiPath = requestUrl.pathname.slice('/qq'.length);
  const sessionHeader = String(req.headers[QQ_SESSION_HEADER.toLowerCase()] || '');
  const usesSharedAccount = sessionHeader.includes(SHARED_ACCOUNT_MARKER)
    || String(requestUrl.searchParams.get('cookie') || '').includes(SHARED_ACCOUNT_MARKER);
  if (usesSharedAccount && rejectBadSharedToken(res, `${sessionHeader} ${requestUrl.searchParams.get('cookie') || ''}`)) return true;
  if (apiPath.startsWith('/logout') && usesSharedAccount) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 403, message: 'Logout is disabled on the shared account.' }));
    return true;
  }

  const target = new URL(`http://127.0.0.1:${QQ_PORT}${apiPath}`);
  requestUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  const hostToken = hostQqCookie ? /(?:^|;\s*)qqmusic_session=([^;]+)/.exec(hostQqCookie)?.[1] : null;
  const injected = usesSharedAccount && Boolean(hostToken) && !QQ_PASSTHROUGH.test(apiPath);
  const headers = {};
  if (sessionHeader && !injected) {
    headers[QQ_SESSION_HEADER] = sessionHeader;
  }
  if (injected) {
    target.searchParams.delete('cookie');
    headers[QQ_SESSION_HEADER] = hostToken;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    let body = Buffer.from(await upstream.arrayBuffer());
    // 响应里的 cookie 字段就是 Host 的真实会话,不能下发给浏览器
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

// /kugou/* 反向代理到本机酷狗 API:酷狗的登录态是随请求的 cookie 参数带的(token / userid / dfid),
// 带共用占位的请求把整串 cookie 换成 Host 的,并把显式的 userid 参数也换成 Host 的账号。
// 登录(扫码)与设备注册接口原样透传,否则 Host 自己扫码登录会被打断。
const KUGOU_PASSTHROUGH = /^\/(login|register|captcha)(\/|$)/;
const handleKugouProxy = async (req, res, requestUrl) => {
  if (!requestUrl.pathname.startsWith('/kugou/')) return false;

  const apiPath = requestUrl.pathname.slice('/kugou'.length);
  const usesSharedAccount = String(requestUrl.searchParams.get('cookie') || '').includes(SHARED_ACCOUNT_MARKER);
  if (usesSharedAccount && rejectBadSharedToken(res, requestUrl.searchParams.get('cookie'))) return true;
  if (apiPath.startsWith('/logout') && usesSharedAccount) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 403, message: 'Logout is disabled on the shared account.' }));
    return true;
  }

  const target = new URL(`http://127.0.0.1:${KUGOU_PORT}${apiPath}`);
  requestUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  const injected = usesSharedAccount && Boolean(hostKugouCookie) && !KUGOU_PASSTHROUGH.test(apiPath);
  if (injected) {
    target.searchParams.set('cookie', hostKugouCookie);
    const hostUserId = /(?:^|;\s*)userid=([^;]+)/.exec(hostKugouCookie)?.[1];
    if (hostUserId && target.searchParams.has('userid')) target.searchParams.set('userid', hostUserId);
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
    // 响应里的 cookie / token 就是 Host 的真实凭据,不能下发给浏览器
    if (injected && contentType.includes('json')) {
      try {
        const json = JSON.parse(body.toString('utf-8'));
        if (json && typeof json === 'object') {
          delete json.cookie;
          for (const holder of [json.data, json.body, json.body?.data]) {
            if (holder && typeof holder === 'object') {
              delete holder.cookie;
              delete holder.token;
              delete holder.dfid;
            }
          }
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

// /stage/player/*(遥控)、/stage/local/*(Host 的曲库、封面、歌词)与 /stage/spotify/*(Spotify)必须带令牌;/stage/auth/check 供页面验证令牌。
// /stage/health 不涉及任何内容,保持公开。
const handleStageAuth = async (req, res, requestUrl) => {
  const { pathname } = requestUrl;
  const isCheck = pathname === '/stage/auth/check';
  if (!isCheck && !pathname.startsWith('/stage/player/') && !pathname.startsWith('/stage/local/') && !pathname.startsWith('/stage/spotify/')) return false;
  if (req.method === 'OPTIONS') return false;

  const limited = isAuthRateLimited();
  const valid = !limited && sameSecret(readRequestToken(req, requestUrl));
  if (valid) {
    if (isCheck) {
      sendJson(res, 200, { ok: true });
      return true;
    }
    return false;
  }
  if (!limited) noteFailedAuth();
  sendJson(res, limited ? 429 : 401, { error: limited ? 'Too many failed attempts, try again in a minute.' : 'A valid stage token is required.' });
  return true;
};

// ---- Spotify(网页版):桌面版的 Spotify 桥在中继里运行,账号存在服务器本机,带令牌的访问者共用它 ----
// 懒创建:不用 Spotify 的部署不会加载它(也不会去碰可选的 librespot 原生模块)。
let spotifyRelay = null;
const getSpotifyRelay = () => {
  spotifyRelay ??= createSpotifyRelay();
  return spotifyRelay;
};
const handleSpotify = async (req, res, requestUrl) => {
  const { pathname } = requestUrl;
  if (!pathname.startsWith('/stage/spotify/')) return false;
  if (req.method === 'OPTIONS') return false;
  try {
    if (pathname === '/stage/spotify/api') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'unsupported', message: 'POST only' } });
        return true;
      }
      await getSpotifyRelay().handleApi(req, res, sendJson);
      return true;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && await getSpotifyRelay().handleAudio(req, res, requestUrl)) return true;
  } catch (error) {
    console.warn('[Relay] Spotify request failed:', error?.message || error);
    if (!res.headersSent) sendJson(res, 502, { ok: false, error: { code: 'unavailable', message: 'Spotify is not available on this server' } });
    else res.destroy();
    return true;
  }
  sendJson(res, 404, { ok: false, error: { code: 'unsupported', message: 'Unknown Spotify route' } });
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
  const upgradeUrl = new URL(req.url || '/', 'http://localhost');
  if (upgradeUrl.pathname !== HOST_WS_PATH) return false;
  // Host 页连中继也要带令牌(WebSocket 带不了请求头,走查询参数)
  if (isAuthRateLimited() || !sameSecret(upgradeUrl.searchParams.get('token'))) {
    if (!isAuthRateLimited()) noteFailedAuth();
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }

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
        hostQqCookie = typeof message.qqCookie === 'string' && message.qqCookie ? message.qqCookie : null;
        hostKugouCookie = typeof message.kugouCookie === 'string' && message.kugouCookie ? message.kugouCookie : null;
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
    (await handleStageAuth(req, res, requestUrl))
    || (await handleNeteaseProxy(req, res, requestUrl))
    || (await handleQqProxy(req, res, requestUrl))
    || (await handleKugouProxy(req, res, requestUrl))
    || (await handleSpotify(req, res, requestUrl))
    || (await handleHostLocalLibrary(req, res, requestUrl))
  ),
});

stageApi.startStageServerIfNeeded().then(() => {
  console.log(`[Relay] Listening on ${LISTEN_HOST}:${PORT}, Netease API on 127.0.0.1:${NETEASE_PORT}`);
  console.log(`[Relay] Access token (遥控与 Host 页都要带): ${STAGE_TOKEN}`);
  console.log(`[Relay] Token file: ${process.env.STAGE_TOKEN ? '(from STAGE_TOKEN)' : TOKEN_FILE}`);
}).catch((error) => {
  console.error('[Relay] Failed to start', error);
  process.exit(1);
});
