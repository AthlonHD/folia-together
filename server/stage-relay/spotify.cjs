// server/stage-relay/spotify.cjs
// Spotify for the web build (Fork): the same bridge the desktop app runs in its main process
// (electron/spotify/spotifyApiBridge.cjs), run here in the relay's Node process, so the Host page and
// the remote pages can use Spotify through the relay instead of through Electron IPC.
//
// - The account (tokens) is kept on the machine of the relay, sealed with a key file next to it, and
//   never leaves it: every visitor with the stage token shares this one Spotify account, the way
//   they share the NetEase, QQ and KuGou accounts of the Host.
// - Sign-in must be done ON THE SERVER: Spotify's consent page sends the browser back to
//   http://127.0.0.1:5588, which only the server can answer. The page that asks for the sign-in opens the
//   consent page in the server's own browser (the Host machine's desktop, via RustDesk or similar).
// - Playback: `@lox-audioserver/node-librespot` (an optional dependency, a native module) connects
//   to Spotify as the account and the relay serves the decrypted audio at /stage/spotify/audio/<id>.
//   It needs a Spotify Premium account and a direct connection to Spotify (librespot does not use an
//   HTTP proxy); the API requests below do go through the system proxy when direct fails.
//
// Not allowed here: anything the desktop app keeps on disk beyond the sign-in (no audio cache).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const { createSpotifyApiBridge } = require('../../electron/spotify/spotifyApiBridge.cjs');

const SPOTIFY_HOST = /(^|\.)(spotify\.com|spotifycdn\.com|scdn\.co)$/i;
const PROBE_HOST = 'accounts.spotify.com';
const PROBE_TIMEOUT_MS = 2500;
const DECISION_TTL_MS = 30_000;
const FAILED_DECISION_TTL_MS = 5_000;
const AUDIO_PATH = /^\/stage\/spotify\/audio\/([0-9A-Za-z]{22})$/;
const AUDIO_SCHEME_PREFIX = 'folia-spotify://audio/';
const AUDIO_URL_PREFIX = '/stage/spotify/audio/';
const MAX_BODY_BYTES = 64 * 1024;

// ---- the account is kept in a file, sealed with a key file (the desktop app uses the OS keychain) ----

const createFileStore = (file) => {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch { /* none yet, or damaged: start empty */ }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  };
  return {
    get: (key) => data[key],
    set: (key, value) => { data[key] = value; save(); },
    delete: (key) => { delete data[key]; save(); },
    has: (key) => key in data,
  };
};

const createKeyfileSeal = (keyFile) => {
  const loadKey = () => {
    try {
      const saved = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
      if (saved.length === 32) return saved;
    } catch { /* first run */ }
    const generated = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, generated.toString('base64'), { mode: 0o600 });
    return generated;
  };
  let key = null;
  const keyOf = () => { key ??= loadKey(); return key; };
  // The shape of Electron's safeStorage, as far as the session repository uses it.
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'aes-256-gcm-keyfile',
    encryptString: (text) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyOf(), iv);
      const sealed = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), sealed]);
    },
    decryptString: (buffer) => {
      const iv = buffer.subarray(0, 12);
      const tag = buffer.subarray(12, 28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyOf(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
};

// ---- the network: direct, or through the system proxy when Spotify cannot be reached directly ----

const normalizeProxyUrl = (value) => {
  const text = String(value || '').trim();
  if (!text || /^socks/i.test(text)) return null;
  return /^https?:\/\//i.test(text) ? text : `http://${text}`;
};

const canConnect = (host, port, timeoutMs) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  const done = (ok) => { socket.destroy(); resolve(ok); };
  socket.setTimeout(timeoutMs, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

const createRoutedFetch = ({ log, warn }) => {
  let route = { mode: 'direct', proxyUrl: null, decidedAt: 0, reachable: true };
  let deciding = null;
  let undiciPromise = null;
  const agents = new Map();
  const undici = () => { undiciPromise ??= import('undici'); return undiciPromise; };

  const decide = async () => {
    // The configured proxy: explicit setting, environment, then the Windows system proxy (reuses the AI route's reader).
    let proxyUrl = null;
    try {
      const { readConfiguredProxyUrl } = await import('../../dev/ai/aiProxyRouting.mjs');
      proxyUrl = readConfiguredProxyUrl();
    } catch {
      proxyUrl = normalizeProxyUrl(process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
    }
    let next;
    if (await canConnect(PROBE_HOST, 443, PROBE_TIMEOUT_MS)) {
      next = { mode: 'direct', proxyUrl: null, reachable: true, reason: 'direct connection works' };
    } else if (proxyUrl) {
      const { hostname, port } = new URL(proxyUrl);
      const listening = await canConnect(hostname, Number(port) || 80, 1000);
      next = listening
        ? { mode: 'proxy', proxyUrl, reachable: true, reason: `direct connection failed, using proxy ${proxyUrl}` }
        : { mode: 'direct', proxyUrl: null, reachable: false, reason: `direct connection failed and the proxy ${proxyUrl} is not listening` };
    } else {
      next = { mode: 'direct', proxyUrl: null, reachable: false, reason: 'direct connection failed and no proxy is enabled' };
    }
    if (next.mode !== route.mode || next.reachable !== route.reachable || next.reason !== route.reason) log(`[Spotify] network route: ${next.reason}`);
    route = { ...next, decidedAt: Date.now() };
    return route;
  };
  const currentRoute = async () => {
    const age = Date.now() - route.decidedAt;
    if (age < (route.reachable ? DECISION_TTL_MS : FAILED_DECISION_TTL_MS)) return route;
    deciding ??= decide().finally(() => { deciding = null; });
    return deciding;
  };

  return async (input, init = {}) => {
    const url = input instanceof URL ? input.href : String(input);
    let host = '';
    try { host = new URL(url).hostname; } catch { /* a bad address fails in fetch */ }
    const { credentials, ...rest } = init;
    void credentials;
    if (!SPOTIFY_HOST.test(host)) return fetch(url, rest);
    const chosen = await currentRoute();
    if (chosen.mode !== 'proxy' || !chosen.proxyUrl) return fetch(url, rest);
    try {
      const { fetch: undiciFetch, ProxyAgent } = await undici();
      let agent = agents.get(chosen.proxyUrl);
      if (!agent) { agent = new ProxyAgent(chosen.proxyUrl); agents.set(chosen.proxyUrl, agent); }
      return await undiciFetch(url, { ...rest, dispatcher: agent });
    } catch (error) {
      warn(`[Spotify] request through the proxy failed: ${error?.message || error}`);
      throw error;
    }
  };
};

// ---- opening Spotify's consent page in the server's own browser ----

const openInServerBrowser = (url) => new Promise((resolve, reject) => {
  let parsed;
  try { parsed = new URL(url); } catch { reject(new Error('Invalid address')); return; }
  // Only Spotify's own sign-in page is opened from here.
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'accounts.spotify.com') { reject(new Error('Refused to open this address')); return; }
  const [command, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', parsed.href]]
    : process.platform === 'darwin' ? ['open', [parsed.href]] : ['xdg-open', [parsed.href]];
  execFile(command, args, { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
});

// ---- the relay's Spotify service ----

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { reject(new Error('Body too large')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

/**
 * `stateDir`: where the sign-in is kept (default ~/.folia-spotify).
 * `deps`: test seams (`openSession` for the playback component, `fetch`, `openExternal`).
 */
const createSpotifyRelay = ({ stateDir = process.env.SPOTIFY_STATE_DIR || path.join(os.homedir(), '.folia-spotify'), log = console.log, warn = console.warn, deps = {} } = {}) => {
  const bridge = createSpotifyApiBridge({
    store: createFileStore(path.join(stateDir, 'spotify-store.json')),
    safeStorage: createKeyfileSeal(path.join(stateDir, 'spotify-secret')),
    fetch: deps.fetch ?? createRoutedFetch({ log, warn }),
    openExternal: deps.openExternal ?? openInServerBrowser,
    language: () => 'zh-CN',
    log,
    warn,
    ...(deps.openSession ? { openSession: deps.openSession } : {}),
  });

  // The renderer is given paths of the relay instead of the desktop app's own scheme.
  const toRelayAudio = (data) => (
    data && typeof data.url === 'string' && data.url.startsWith(AUDIO_SCHEME_PREFIX)
      ? { ...data, url: data.url.replace(AUDIO_SCHEME_PREFIX, AUDIO_URL_PREFIX) }
      : data
  );
  const toSchemeAudio = (params) => (
    typeof params.url === 'string' && params.url.startsWith(AUDIO_URL_PREFIX)
      ? { ...params, url: params.url.replace(AUDIO_URL_PREFIX, AUDIO_SCHEME_PREFIX) }
      : params
  );

  const request = async (operation, params = {}) => {
    const safeParams = params && typeof params === 'object' && !Array.isArray(params) ? toSchemeAudio(params) : params;
    const result = await bridge.request(operation, safeParams);
    return result.ok && operation === 'audio' ? { ...result, data: toRelayAudio(result.data) } : result;
  };

  /** POST /stage/spotify/api  { operation, params } -> the bridge's result, as the desktop IPC returns it. */
  const handleApi = async (req, res, sendJson) => {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'invalid-response', message: 'Invalid Spotify request' } });
      return;
    }
    sendJson(res, 200, await request(String(body?.operation ?? ''), body?.params ?? {}));
  };

  /** GET /stage/spotify/audio/<trackId>?k=<key>[&token=..]: the decrypted audio, Range supported. */
  const handleAudio = async (req, res, requestUrl) => {
    const match = AUDIO_PATH.exec(requestUrl.pathname);
    if (!match) return false;
    const key = requestUrl.searchParams.get('k') ?? '';
    const incoming = new Request(`${AUDIO_SCHEME_PREFIX}${match[1]}?k=${encodeURIComponent(key)}`, {
      method: req.method === 'HEAD' ? 'GET' : req.method,
      headers: req.headers.range ? { range: req.headers.range } : {},
    });
    const response = await bridge.handleAudioRequest(incoming);
    if (response.type === 'error') {
      res.destroy();
      return true;
    }
    const headers = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    res.writeHead(response.status, headers);
    if (!response.body || req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = Readable.fromWeb(response.body);
    const stop = () => stream.destroy();
    res.on('close', stop);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  };

  return { request, handleApi, handleAudio };
};

module.exports = { createSpotifyRelay, createKeyfileSeal, createFileStore };
