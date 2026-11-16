const { createServer } = require('node:http');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { registerMusicTools } = require('./tools.cjs');
const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');
const { encryptionAvailable } = require('../osEncryption.cjs');

// Owns the loopback MCP listener and pairs each tool call with the current player renderer.
function startMusicMcp({ ipcMain, getWindow, isTrustedSender, player, store, safeStorage, clipboard, env = process.env }) {
    const requestedPort = Number(env.FOLIA_MCP_PORT || 38451);
    const port = Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= 65535 ? requestedPort : 38451;
    const address = `http://127.0.0.1:${port}/mcp`;
    const initialToken = typeof env.FOLIA_MCP_TOKEN === 'string' && /^[!-~]{32,256}$/.test(env.FOLIA_MCP_TOKEN)
        ? env.FOLIA_MCP_TOKEN : null;
    let token = initialToken;
    let tokenPersistent = false;
    let enabled = store.get('MUSIC_MCP_ENABLED', Boolean(initialToken)) === true;
    let enabledWrites = store.get('MUSIC_MCP_WRITE', Boolean(initialToken) && env.FOLIA_MCP_WRITE === '1') === true;
    let listenError = null;
    let transition = Promise.resolve();
    let disposed = false;
    const pending = new Map();

    const ensureToken = () => {
        if (token) return token;
        const canSeal = encryptionAvailable(safeStorage, process.platform);
        if (canSeal) {
            try {
                const sealed = store.get('MUSIC_MCP_TOKEN_SEALED');
                if (typeof sealed === 'string' && sealed) {
                    const decrypted = safeStorage.decryptString(Buffer.from(sealed, 'base64'));
                    if (/^[a-f0-9]{64}$/.test(decrypted)) {
                        token = decrypted;
                        tokenPersistent = true;
                        return token;
                    }
                }
            } catch (cause) {
                console.warn('[MusicMcp] Could not restore the connection token', cause);
            }
        }
        token = randomBytes(32).toString('hex');
        if (canSeal) {
            try {
                store.set('MUSIC_MCP_TOKEN_SEALED', safeStorage.encryptString(token).toString('base64'));
                tokenPersistent = true;
            } catch (cause) {
                console.warn('[MusicMcp] Could not save the connection token', cause);
            }
        }
        return token;
    };

    const finish = (id, result) => {
        const request = pending.get(id);
        if (!request) return;
        clearTimeout(request.timer);
        request.dispose();
        pending.delete(id);
        request.resolve(result);
    };
    const error = message => ({ error: message });
    const call = async (tool, args, writes) => {
        if (!enabled || disposed || (writes && !enabledWrites)) return error('Music MCP access has been disabled');
        if (tool === 'play_track' || tool === 'control_playback') {
            try {
                if (tool === 'play_track') {
                    await player.requestStageSongPlay({ providerId: args.provider, songId: args.id }, { appendToQueue: args.enqueue });
                } else {
                    if (args.action === 'seek' && args.positionMs === undefined) return error('positionMs is required for seeking');
                    await player.requestStagePlayerControl(args);
                }
                return { data: { accepted: true } };
            } catch {
                return error('Folia could not perform the playback action');
            }
        }
        if (writes && [...pending.values()].some(request => request.writes)) return error('Another music write is in progress');
        const window = getWindow();
        if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) {
            return error('Folia player is not ready');
        }
        if (pending.size >= 8) return error('Too many Folia requests in progress');
        return new Promise(resolve => {
            const id = randomUUID();
            const contents = window.webContents;
            const frame = contents.mainFrame;
            const gone = () => finish(id, error('Folia player became unavailable'));
            const navigate = (_event, _url, inPlace, isMainFrame) => {
                if (isMainFrame && !inPlace) gone();
            };
            const timer = setTimeout(() => {
                const result = error('Folia request timed out. Check the result on the platform before retrying a write.');
                if (writes) resolve(result);
                else finish(id, result);
            }, 90_000);
            const dispose = () => {
                contents.removeListener('destroyed', gone);
                contents.removeListener('render-process-gone', gone);
                contents.removeListener('did-start-navigation', navigate);
            };
            pending.set(id, { resolve, timer, contents, frame, writes, dispose });
            contents.once('destroyed', gone);
            contents.once('render-process-gone', gone);
            contents.on('did-start-navigation', navigate);
            try {
                contents.send('music-mcp-request', { id, tool, args });
            } catch {
                finish(id, error('Folia player is unavailable'));
            }
        });
    };
    ipcMain.handle('music-mcp-complete', createSenderGuardedHandler({
        channel: 'music-mcp-complete',
        isTrusted: isTrustedSender,
        handler: (event, { id, result } = {}) => {
            const request = pending.get(id);
            if (request && request.contents === event.sender && request.frame === event.senderFrame) finish(id, result);
        },
    }));

    const listener = createServer(async (req, res) => {
        const host = '127.0.0.1:' + port;
        const supplied = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from('Bearer ' + (token ?? ''));
        if (!enabled || disposed || !token || req.headers.host !== host || req.headers.origin !== undefined
            || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            res.writeHead(403).end();
            return;
        }
        if (req.url !== '/mcp' || req.method !== 'POST') {
            res.writeHead(req.url === '/mcp' ? 405 : 404).end();
            return;
        }
        const server = new McpServer({ name: 'folia-music', version: '0.1.0' });
        const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
        res.once('close', () => void server.close());
        try {
            registerMusicTools(server, call, enabledWrites);
            await server.connect(transport);
            await transport.handleRequest(req, res);
        } catch (cause) {
            console.warn('[MusicMcp] Transport failed', cause);
            if (!res.headersSent) res.writeHead(500);
            res.end();
        }
    });
    const status = () => ({ enabled, writeEnabled: enabledWrites, running: listener.listening, address, tokenPersistent, error: listenError });
    const stop = () => new Promise(resolve => {
        if (!listener.listening) return resolve();
        listener.close(() => resolve());
        listener.closeAllConnections();
    });
    const reconcile = async () => {
        listenError = null;
        if (!enabled || disposed) {
            await stop();
            return;
        }
        if (listener.listening) return;
        ensureToken();
        await new Promise(resolve => {
            const failed = cause => {
                listener.removeListener('listening', ready);
                listenError = cause.code === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed';
                console.warn('[MusicMcp] Listener failed', cause);
                resolve();
            };
            const ready = () => {
                listener.removeListener('error', failed);
                console.info('[MusicMcp] Listening on 127.0.0.1:' + port);
                resolve();
            };
            listener.once('error', failed);
            listener.listen(port, '127.0.0.1', ready);
        });
    };
    const queueReconcile = () => {
        transition = transition.then(reconcile, reconcile);
        return transition;
    };

    ipcMain.handle('music-mcp-settings', createSenderGuardedHandler({
        channel: 'music-mcp-settings',
        isTrusted: isTrustedSender,
        handler: async (_event, action, value) => {
            switch (action) {
                case 'status':
                    await transition;
                    return status();
                case 'enabled':
                    if (typeof value !== 'boolean') throw new Error('Invalid Music MCP setting');
                    store.set('MUSIC_MCP_ENABLED', value);
                    enabled = value;
                    await queueReconcile();
                    return status();
                case 'write':
                    if (typeof value !== 'boolean') throw new Error('Invalid Music MCP setting');
                    store.set('MUSIC_MCP_WRITE', value);
                    enabledWrites = value;
                    return status();
                case 'copy-config': {
                    if (!enabled || !listener.listening || !token) return false;
                    const config = { mcpServers: { 'folia-music': { type: 'http', url: address, headers: {
                        Authorization: 'Bearer ' + token,
                    } } } };
                    clipboard.writeText(JSON.stringify(config, null, 2));
                    return true;
                }
                default:
                    throw new Error('Unknown Music MCP setting');
            }
        },
    }));
    void queueReconcile();
    return () => {
        if (disposed) return;
        disposed = true;
        for (const id of pending.keys()) finish(id, error('Folia is shutting down'));
        ipcMain.removeHandler('music-mcp-complete');
        ipcMain.removeHandler('music-mcp-settings');
        void queueReconcile();
    };
}

module.exports = { startMusicMcp };
