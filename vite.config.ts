import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadEnv, type ConfigEnv, type PreviewServer, type UserConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { commandPinyinPlugin } from './dev/pinyin/commandPinyinPlugin.mjs';
import { normalizeBuildCommit, resolveBuildKind, resolveBuildRepo } from './dev/build/buildIdentity.mjs';
import { prepareAiRoute } from './dev/ai/aiProxyRouting.mjs';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LYRIC_PROXY_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
  'Access-Control-Allow-Headers': [
    'X-CSRF-Token',
    'X-Requested-With',
    'Accept',
    'Accept-Version',
    'Content-Length',
    'Content-MD5',
    'Content-Type',
    'Date',
    'X-Api-Version',
    'KG-Rec',
    'KG-RC',
    'KG-CLIENTTIMEMS',
    'mid',
    'x-router',
  ].join(', '),
};

const LYRIC_PROXY_IGNORED_FORWARD_HEADERS = ['host', 'connection', 'content-length', 'origin', 'referer'];

function isAllowedLyricProxyHost(hostname: string): boolean {
  return hostname === 'qq.com' || hostname.endsWith('.qq.com') ||
    hostname === 'y.gtimg.cn' ||
    hostname === 'kugou.com' || hostname.endsWith('.kugou.com') ||
    hostname === 'kgimg.com' || hostname.endsWith('.kgimg.com');
}

function setLyricProxyCorsHeaders(res: import('http').ServerResponse): void {
  Object.entries(LYRIC_PROXY_CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

function sendLyricProxyJson(res: import('http').ServerResponse, statusCode: number, body: unknown): void {
  setLyricProxyCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readDevRequestBody(req: import('http').IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

// 歌词跨域代理。线上部署由 api/lyric-proxy 的无服务函数提供;本地的开发服务器和 `vite preview`
// 都没有那个函数,所以两处都挂同一个中间件(预览服务器用于服务器本机部署的打包版)。
const lyricProxyMiddleware = async (
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  next: () => void,
) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/lyric-proxy') {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    setLyricProxyCorsHeaders(res);
    res.statusCode = 200;
    res.end();
    return;
  }

  const targetUrlStr = requestUrl.searchParams.get('url');
  if (!targetUrlStr) {
    sendLyricProxyJson(res, 400, { error: 'Missing url parameter' });
    return;
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    if (!isAllowedLyricProxyHost(targetUrl.hostname)) {
      sendLyricProxyJson(res, 403, { error: 'Forbidden: Domain not allowed' });
      return;
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!LYRIC_PROXY_IGNORED_FORWARD_HEADERS.includes(key.toLowerCase()) && value) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '');
    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body: hasBody ? await readDevRequestBody(req) : undefined,
    });

    setLyricProxyCorsHeaders(res);

    res.statusCode = response.status;
    res.statusMessage = response.statusText;
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    console.error('Vite lyric proxy request failed:', error);
    sendLyricProxyJson(res, 500, { error: 'Proxy request failed', details: String(error) });
  }
};

function devLyricProxyPlugin() {
  return {
    name: 'folia-dev-lyric-proxy',
    apply: 'serve' as const,
    configureServer(server: ViteDevServer) {
      server.middlewares.use(lyricProxyMiddleware);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(lyricProxyMiddleware);
    },
  };
}

// AI 接口(主题生成、歌词分段)。线上部署由 api/ 下的无服务函数提供,自托管的 `vite dev` / `vite preview`
// 没有它们,这里把同一批函数挂到开发与预览服务器上。函数读的是 process.env,而 Vite 默认不会把 .env.local 里
// 非 VITE_ 开头的变量放进去,所以在配置里补上(Key 只留在服务器进程里,不会进前端包)。
const AI_ENV_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_URL', 'OPENAI_API_MODEL', 'OPENAI_API_TEMPERATURE'];
const AI_BODY_LIMIT_BYTES = 256 * 1024;
// 站点对外开放时没有鉴权,给 AI 接口加个全局限流,免得 Key 被人刷光
const AI_RATE_LIMIT_PER_MINUTE = 30;
const aiRequestTimes: number[] = [];

type AiRoute = { style: 'node' | 'edge'; file: string };
const AI_ROUTES: Record<string, AiRoute> = {
  '/api/generate-theme': { style: 'node', file: 'generate-theme.js' },
  '/api/generate-theme_openai': { style: 'edge', file: 'generate-theme_openai.js' },
  '/api/segment-lyrics': { style: 'edge', file: 'segment-lyrics.js' },
};

function loadAiEnv(mode: string): void {
  const env = loadEnv(mode, __dirname, '');
  for (const key of AI_ENV_KEYS) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
}

function readLimitedBody(req: import('http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > AI_BODY_LIMIT_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const aiProxyMiddleware = async (
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  next: () => void,
) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const route = AI_ROUTES[requestUrl.pathname];
  if (!route || req.method !== 'POST') {
    next();
    return;
  }

  const now = Date.now();
  while (aiRequestTimes.length > 0 && now - aiRequestTimes[0] > 60_000) aiRequestTimes.shift();
  if (aiRequestTimes.length >= AI_RATE_LIMIT_PER_MINUTE) {
    sendLyricProxyJson(res, 429, { error: 'Too many AI requests, try again in a minute.' });
    return;
  }
  aiRequestTimes.push(now);

  try {
    // 境外 AI 服务的网络路径要看当下代理的状态(TUN / 系统代理 / 都没开),每次请求前探测
    const aiRoute = await prepareAiRoute();
    if (!aiRoute.reachable && requestUrl.pathname === '/api/generate-theme') {
      // Gemini 在境外:直连和代理都不通时别让请求干等超时,直接说明原因
      sendLyricProxyJson(res, 503, { error: `Cannot reach Google (Gemini): ${aiRoute.reason}. Turn on the proxy or TUN and try again.` });
      return;
    }
    const body = await readLimitedBody(req);
    const handlerModule = await import(pathToFileURL(path.join(__dirname, 'api', route.file)).href);
    const handler = handlerModule.default as (...args: any[]) => Promise<any>;

    if (route.style === 'node') {
      // Vercel 风格 (req, res):补上 req.body 与 res.status().json()
      let parsed: unknown = {};
      try {
        parsed = body.length > 0 ? JSON.parse(body.toString('utf-8')) : {};
      } catch {
        sendLyricProxyJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const shimReq = Object.assign(req, { body: parsed });
      const shimRes = Object.assign(res, {
        status(code: number) {
          res.statusCode = code;
          return shimRes;
        },
        json(payload: unknown) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
          return shimRes;
        },
      });
      await handler(shimReq, shimRes);
      return;
    }

    // Edge 风格 (Request) => Response
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const response: Response = await handler(new Request(`http://localhost${requestUrl.pathname}`, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
    }));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Vite AI proxy request failed:', error instanceof Error ? error.message : error);
    if (!res.headersSent) sendLyricProxyJson(res, 500, { error: 'AI request failed' });
  }
};

function aiProxyPlugin(mode: string) {
  loadAiEnv(mode);
  return {
    name: 'folia-ai-proxy',
    apply: 'serve' as const,
    configureServer(server: ViteDevServer) {
      server.middlewares.use(aiProxyMiddleware);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(aiProxyMiddleware);
    },
  };
}

export default async function viteConfig(_config: ConfigEnv): Promise<UserConfig> {
  let commitHash = '';
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    commitHash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
  } else {
    try {
      commitHash = execSync('git rev-parse --short HEAD').toString().trim();
    } catch (e) {
      console.warn('Could not get commit hash:', e);
      commitHash = 'unknown, probably dev version';
    }
  }

  let gitBranch = '';
  if (process.env.VERCEL_GIT_COMMIT_REF) {
    gitBranch = process.env.VERCEL_GIT_COMMIT_REF;
  } else {
    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    } catch (e) {
      console.warn('Could not get git branch:', e);
      gitBranch = 'unknown';
    }
  }

  let commitSuffix = '';
  const canResolveCommitName = /^[0-9a-f]{7,40}$/i.test(commitHash) && !/^0+$/.test(commitHash);
  if (canResolveCommitName) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`https://namoe.izuna.top/api/namoe?hash=${commitHash}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as { name?: string };
        if (data?.name) {
          commitSuffix = `/${data.name}`;
        }
      }
    } catch (e) {
      // Ignore errors during fetch to prevent build failure
    }
  }
  if (process.env.REQUIRE_COMMIT_NAME === 'true' && canResolveCommitName && !commitSuffix) {
    throw new Error(`Could not resolve the commit name for ${commitHash}`);
  }

  // 请求 AMLL 官方 API 时 UA 里的构建身份，见 dev/build/buildIdentity.mjs
  const buildRepo = resolveBuildRepo(process.env, () => execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  const buildCommit = normalizeBuildCommit(commitHash);
  // 官方 / 自部署 / 非官方：设置里的版本号、扫码诊断报告和反馈入口都会读它
  const buildKind = resolveBuildKind(process.env);

  const appVersionLabel = process.env.APP_VERSION_LABEL?.trim() || 'Realeco';
  const appReleaseChannel = process.env.APP_RELEASE_CHANNEL?.trim().toLowerCase() || 'realeco';
  const dockerStackVersion = process.env.DOCKER_STACK_VERSION?.trim() || '';

  return {
    base: process.env.ELECTRON === 'true' ? './' : '/',
    worker: {
      format: 'es'
    },
    optimizeDeps: {
      // Only metadataParser.worker.ts imports music-metadata, and the startup dep scan does not
      // follow worker entries. Left out, the first local import discovers it at runtime, Vite
      // re-optimizes, and every open page is force-reloaded ("optimized dependencies changed").
      include: ['music-metadata'],
    },
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          stageClient: 'stage-client.html',
          modExport: 'mod-export.html',
        },
        output: {
          // three.js is a large dependency used only by the diorama 3D visualizer. Split it into its
          // own chunk so it doesn't bloat the main bundle past the PWA precache size limit (each file
          // must stay under workbox.maximumFileSizeToCacheInBytes to be cached for offline use).
          manualChunks(id) {
            return id.includes('/node_modules/three/') ? 'three' : undefined;
          },
          // folium.ui.icon loads each lucide icon as its own chunk (~2000 of them). They live in one
          // directory so the PWA precache can leave them out: only mods ask for them, and mods run in
          // the desktop app, which does not go through the service worker.
          chunkFileNames(chunk) {
            return chunk.moduleIds.some(id => id.includes('/node_modules/lucide-react/dist/esm/icons/'))
              && chunk.moduleIds.length === 1
              ? 'assets/folium-icons/[name]-[hash].js'
              : 'assets/[name]-[hash].js';
          },
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Stage 中继(Host 页 WebSocket 与遥控 HTTP)走同源代理,反代只需暴露 3000 一个端口
      proxy: {
        '/stage': { target: `http://127.0.0.1:${process.env.STAGE_PORT || 4100}`, ws: true },
        // 网易云 API 经中继同源代理(中继会换成 Host 账号的 cookie),配合 VITE_NETEASE_API_BASE=/ncm
        '/ncm': { target: `http://127.0.0.1:${process.env.STAGE_PORT || 4100}` },
        // QQ 音乐 API 同样经中继代理(换成 Host 的 QQ 会话),配合 VITE_QQ_API_BASE=/qq
        '/qq': { target: `http://127.0.0.1:${process.env.STAGE_PORT || 4100}` },
        // 酷狗音乐 API 同样经中继代理(换成 Host 的酷狗会话),配合 VITE_KUGOU_API_BASE=/kugou
        '/kugou': { target: `http://127.0.0.1:${process.env.STAGE_PORT || 4100}` },
      },
      allowedHosts: true,
      watch: {
        // Build output and model weights are not sources, and watching them breaks packaging: the
        // watcher opens a handle on every directory it finds, and electron-builder packages by
        // extracting Electron into release/win-unpacked.tmp and renaming it to release/win-unpacked.
        // On Windows that rename fails with EPERM while anything holds the directory - so a dev
        // server left running in another terminal kills every `npm run build:electron`.
        ignored: ['**/release/**', '**/models/**'],
      },
    },
    plugins: [
      devLyricProxyPlugin(),
      aiProxyPlugin(_config.mode),
      commandPinyinPlugin(),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        devOptions: {
          enabled: true
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5000000,
          // Docker serves this file dynamically; it must never be pinned in the PWA precache.
          globIgnores: ['**/runtime-config.js', '**/assets/folium-icons/**'],
          // API navigations must reach the deployment platform instead of the SPA shell.
          navigateFallbackDenylist: [/^\/api(?:\/|$)/]
        },
        manifest: {
          name: 'Folia Music',
          short_name: 'Folia',
          description: 'A beautiful AI-themed music player',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          icons: [
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    define: {
      '__COMMIT_HASH__': JSON.stringify(commitHash + commitSuffix),
      '__GIT_BRANCH__': JSON.stringify(gitBranch),
      '__BUILD_REPO__': JSON.stringify(buildRepo),
      '__BUILD_COMMIT__': JSON.stringify(buildCommit),
      '__BUILD_KIND__': JSON.stringify(buildKind.kind),
      '__BUILD_HOST__': JSON.stringify(buildKind.host ?? ''),
      '__APP_VERSION__': JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version),
      '__APP_VERSION_LABEL__': JSON.stringify(appVersionLabel),
      '__APP_RELEASE_CHANNEL__': JSON.stringify(appReleaseChannel),
      '__DOCKER_STACK_VERSION__': JSON.stringify(dockerStackVersion)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    }
  };
}
