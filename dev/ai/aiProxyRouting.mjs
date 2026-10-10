// dev/ai/aiProxyRouting.mjs
// 自托管服务器上的 AI 接口(Gemini 等)要访问境外服务,而代理的状态并不固定:
// 有时开着 TUN(直连就通),有时只开系统代理,有时都不开。所以不写死走不走代理,每次实际探测:
//   1. 直连能连上 Google -> 直连(TUN 或网络本身就通);
//   2. 直连不通,但系统代理(或 HTTPS_PROXY / AI_PROXY_URL)开着且在监听 -> 走代理;
//   3. 都不通 -> 直接告诉调用方原因,不让请求干等超时。
// 只有 AI_HOSTS 里的境外主机才可能走代理,本机、中继、国内站点永远直连。
// 探测结果缓存一小段时间;用户开关代理后几十秒内自动跟上。

import net from 'node:net';
import { execFileSync } from 'node:child_process';

const AI_HOSTS = new Set(['generativelanguage.googleapis.com', 'api.openai.com']);
const PROBE_HOST = 'generativelanguage.googleapis.com';
const PROBE_TIMEOUT_MS = 2500;
const DECISION_TTL_MS = 30_000;
const FAILED_DECISION_TTL_MS = 5_000;
const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/** @type {{ mode: 'direct' | 'proxy'; proxyUrl: string | null; reachable: boolean; reason: string; decidedAt: number }} */
let route = { mode: 'direct', proxyUrl: null, reachable: true, reason: 'not decided yet', decidedAt: 0 };
let routerInstalled = false;
let inflightDecision = null;
const proxyAgents = new Map();

const normalizeProxyUrl = (value) => {
  const text = String(value || '').trim();
  if (!text || /^socks/i.test(text)) return null;
  return /^https?:\/\//i.test(text) ? text : `http://${text}`;
};

const regValue = (name) => {
  try {
    const output = execFileSync('reg', ['query', INTERNET_SETTINGS_KEY, '/v', name], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    return output.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith(name))?.split(/\s{2,}|\t/).slice(2).join(' ').trim() ?? null;
  } catch {
    return null;
  }
};

/** 显式配置的代理 > 环境变量 > Windows 系统代理(只在开关打开时)。 */
export const readConfiguredProxyUrl = () => {
  const explicit = process.env.AI_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (explicit) return normalizeProxyUrl(explicit);
  if (process.platform !== 'win32') return null;
  if (regValue('ProxyEnable') !== '0x1') return null;
  const server = regValue('ProxyServer');
  if (!server) return null;
  // 形如 "127.0.0.1:7890" 或 "http=127.0.0.1:7890;https=127.0.0.1:7890"
  const entries = server.split(';').map(entry => entry.trim()).filter(Boolean);
  const pick = entries.find(entry => entry.startsWith('https=')) || entries.find(entry => entry.startsWith('http=')) || entries.find(entry => !entry.includes('='));
  return normalizeProxyUrl(pick?.replace(/^https?=/, ''));
};

const canConnect = (host, port, timeoutMs) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  const done = (ok) => {
    socket.destroy();
    resolve(ok);
  };
  socket.setTimeout(timeoutMs, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

const proxyIsListening = async (proxyUrl) => {
  try {
    const { hostname, port } = new URL(proxyUrl);
    return await canConnect(hostname, Number(port) || 80, 1000);
  } catch {
    return false;
  }
};

const decide = async () => {
  const proxyUrl = readConfiguredProxyUrl();
  let next;
  if (await canConnect(PROBE_HOST, 443, PROBE_TIMEOUT_MS)) {
    next = { mode: 'direct', proxyUrl: null, reachable: true, reason: 'direct connection works' };
  } else if (proxyUrl && await proxyIsListening(proxyUrl)) {
    next = { mode: 'proxy', proxyUrl, reachable: true, reason: `direct connection failed, using proxy ${proxyUrl}` };
  } else {
    next = {
      mode: 'direct',
      proxyUrl: null,
      reachable: false,
      reason: proxyUrl
        ? `direct connection failed and the proxy ${proxyUrl} is not listening`
        : 'direct connection failed and no proxy is enabled',
    };
  }
  if (next.mode !== route.mode || next.reachable !== route.reachable || next.reason !== route.reason) {
    console.log(`[AI] network route: ${next.reason}`);
  }
  route = { ...next, decidedAt: Date.now() };
  return route;
};

/** 请求前调用:装好路由并(必要时重新)探测当前该直连还是走代理。 */
export const prepareAiRoute = async () => {
  await installRouter();
  const age = Date.now() - route.decidedAt;
  if (age < (route.reachable ? DECISION_TTL_MS : FAILED_DECISION_TTL_MS)) return route;
  inflightDecision ??= decide().finally(() => { inflightDecision = null; });
  return inflightDecision;
};

const installRouter = async () => {
  if (routerInstalled) return;
  routerInstalled = true;
  let undici;
  try {
    // undici 是 discord-rpc 依赖链里带的,不在 package.json 里直接声明;取不到就保持 Node 默认行为(直连)
    undici = await import('undici');
  } catch (error) {
    console.warn('[AI] undici is unavailable, outbound AI requests will connect directly:', error?.message || error);
    return;
  }
  const { Agent, ProxyAgent, Dispatcher, setGlobalDispatcher } = undici;
  const direct = new Agent();
  const proxyFor = (proxyUrl) => {
    let agent = proxyAgents.get(proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(proxyUrl);
      proxyAgents.set(proxyUrl, agent);
    }
    return agent;
  };

  class AiRouter extends Dispatcher {
    dispatch(options, handler) {
      let host = '';
      try {
        host = new URL(options.origin ?? 'http://localhost').hostname;
      } catch { /* 取不到主机就直连 */ }
      const useProxy = route.mode === 'proxy' && route.proxyUrl && AI_HOSTS.has(host);
      return (useProxy ? proxyFor(route.proxyUrl) : direct).dispatch(options, handler);
    }

    close() {
      return Promise.all([direct.close(), ...[...proxyAgents.values()].map(agent => agent.close())]);
    }

    destroy(error) {
      return Promise.all([direct.destroy(error), ...[...proxyAgents.values()].map(agent => agent.destroy(error))]);
    }
  }

  setGlobalDispatcher(new AiRouter());
};
