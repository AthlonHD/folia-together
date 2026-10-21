'use strict';

// electron/networkProxy/networkProxy.cjs
// The proxy the desktop app uses to reach Spotify and YouTube Music, which a good part of the world cannot reach directly (and which
// those services' own apps have a proxy setting for). It is the app's own setting, not the system's:
//   system  - follow the Windows proxy setting (what both services did before this setting existed);
//   direct  - no proxy;
//   custom  - one proxy address: http://host:port, https://host:port, socks5://host:port (or socks4://).
// It is applied to the network sessions of the two services, to the browser that is opened for the YouTube Music sign-in, and to the
// playback component of Spotify (librespot), which opens its own connections and takes an HTTP proxy only.
// Nothing here needs Electron: the pieces that do are handed in.

const MODES = ['system', 'direct', 'custom'];
const SCHEMES = ['http:', 'https:', 'socks5:', 'socks4:'];
const DEFAULT_PORTS = { 'http:': 80, 'https:': 443, 'socks5:': 1080, 'socks4:': 1080 };

/**
 * One proxy address as typed: `host:port` alone is taken as an HTTP proxy. Credentials in the address are refused (they would be stored
 * and logged in plain text; a proxy that needs them is not supported here).
 * @returns {{ ok: true, url: string, scheme: string, host: string, port: number } | { ok: false, error: 'empty' | 'invalid' | 'scheme' | 'credentials' }}
 */
function parseProxyAddress(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const scheme = parsed.protocol === 'socks:' ? 'socks5:' : parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol;
  if (!SCHEMES.includes(scheme)) return { ok: false, error: 'scheme' };
  if (parsed.username || parsed.password) return { ok: false, error: 'credentials' };
  if (!parsed.hostname || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) return { ok: false, error: 'invalid' };
  const port = parsed.port ? Number(parsed.port) : DEFAULT_PORTS[scheme];
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'invalid' };
  const host = parsed.hostname;
  const shownHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return { ok: true, url: `${scheme}//${shownHost}:${port}`, scheme, host, port };
}

/** What is stored (or sent by the page) as a setting; anything odd falls back to following the system. */
function normalizeProxyConfig(raw) {
  const mode = MODES.includes(raw?.mode) ? raw.mode : 'system';
  if (mode !== 'custom') return { mode, url: '' };
  const parsed = parseProxyAddress(raw?.url);
  return parsed.ok ? { mode, url: parsed.url } : { mode: 'system', url: '' };
}

/** The argument of Electron's `session.setProxy`. */
function toElectronProxyConfig(config) {
  if (config.mode === 'direct') return { mode: 'direct' };
  if (config.mode === 'custom') {
    const parsed = parseProxyAddress(config.url);
    if (parsed.ok) return { mode: 'fixed_servers', proxyRules: parsed.url };
  }
  return { mode: 'system' };
}

/**
 * The first usable entry of what Chromium answers to `resolveProxy` ("PROXY 127.0.0.1:7890; DIRECT", "HTTPS h:p", "SOCKS5 h:p", "DIRECT").
 * Only an HTTP(S) proxy is of use to the Spotify playback component; DIRECT or a SOCKS proxy answer null (the entry says so).
 * @returns {{ kind: 'direct' } | { kind: 'http', url: string } | { kind: 'socks', url: string } | null}
 */
function parseResolvedProxy(answer) {
  for (const entry of String(answer ?? '').split(';').map(part => part.trim()).filter(Boolean)) {
    const [type, address] = entry.split(/\s+/);
    const kind = String(type).toUpperCase();
    if (kind === 'DIRECT') return { kind: 'direct' };
    const parsed = parseProxyAddress(address);
    if (!parsed.ok) continue;
    if (kind === 'PROXY' || kind === 'HTTP') return { kind: 'http', url: `http://${parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host}:${parsed.port}` };
    if (kind === 'HTTPS') return { kind: 'http', url: `https://${parsed.host}:${parsed.port}` };
    if (kind.startsWith('SOCKS')) return { kind: 'socks', url: `socks5://${parsed.host}:${parsed.port}` };
  }
  return null;
}

/**
 * The proxy for the Spotify playback component, or null for none. `resolved` is the answer to `resolveProxy` for a Spotify address, used
 * where the setting follows the system.
 * @returns {{ url: string | null, reason: 'none' | 'direct' | 'http' | 'socks-unsupported' }}
 */
function playbackProxyFor(config, resolved) {
  if (config.mode === 'direct') return { url: null, reason: 'direct' };
  if (config.mode === 'custom') {
    const parsed = parseProxyAddress(config.url);
    if (!parsed.ok) return { url: null, reason: 'none' };
    if (parsed.scheme.startsWith('socks')) return { url: null, reason: 'socks-unsupported' };
    return { url: parsed.url, reason: 'http' };
  }
  const found = parseResolvedProxy(resolved);
  if (!found || found.kind === 'direct') return { url: null, reason: 'none' };
  if (found.kind === 'socks') return { url: null, reason: 'socks-unsupported' };
  return { url: found.url, reason: 'http' };
}

/** The switches for the browser that is started for the YouTube Music sign-in (a Chromium follows the system on its own). */
function browserProxyArgs(config) {
  if (config.mode === 'direct') return ['--no-proxy-server'];
  if (config.mode === 'custom') {
    const parsed = parseProxyAddress(config.url);
    if (parsed.ok) return [`--proxy-server=${parsed.url}`];
  }
  return [];
}

const STORE_KEY = 'networkProxy';

/**
 * The saved setting, with the part that talks to Electron handed in.
 * @param {{ store: { get: (key: string) => unknown, set: (key: string, value: unknown) => void } }} deps
 */
function createNetworkProxy({ store }) {
  let config = normalizeProxyConfig(store.get(STORE_KEY));
  return {
    get: () => config,
    /** @returns {{ ok: true, config } | { ok: false, error: string }} */
    save(raw) {
      if (raw?.mode === 'custom') {
        const parsed = parseProxyAddress(raw.url);
        if (!parsed.ok) return { ok: false, error: parsed.error };
      }
      config = normalizeProxyConfig(raw);
      store.set(STORE_KEY, config);
      return { ok: true, config };
    },
  };
}

/**
 * Whether Spotify and YouTube Music can be reached with this setting: one small request to each, through a session that has the setting.
 * `fetchThrough(url, signal)` resolves to a response-like `{ status }`.
 */
async function probeServices({ fetchThrough, now = Date.now, timeoutMs = 8000 }) {
  const targets = [
    { id: 'spotify', url: 'https://accounts.spotify.com/' },
    { id: 'youtubeMusic', url: 'https://music.youtube.com/' },
  ];
  return Promise.all(targets.map(async (target) => {
    const startedAt = now();
    try {
      const response = await fetchThrough(target.url, AbortSignal.timeout(timeoutMs));
      // Any answer means the service was reached; what it answers is its own business.
      return { id: target.id, ok: true, status: response.status, ms: now() - startedAt };
    } catch (error) {
      return { id: target.id, ok: false, error: error instanceof Error ? error.message : String(error), ms: now() - startedAt };
    }
  }));
}

module.exports = {
  MODES,
  parseProxyAddress,
  normalizeProxyConfig,
  toElectronProxyConfig,
  parseResolvedProxy,
  playbackProxyFor,
  browserProxyArgs,
  createNetworkProxy,
  probeServices,
};
