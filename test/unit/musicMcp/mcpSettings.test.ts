import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { startMusicMcp } = require('../../../electron/mcp/server.cjs');

// Exercises the settings flow through a real local listener while keeping the token in main.
describe('Music MCP settings', () => {
    it('enables the listener, copies the live configuration and revokes it when switched off', async () => {
        const occupied = createServer();
        await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
        const bound = occupied.address();
        if (!bound || typeof bound === 'string') throw new Error('Test port is unavailable');

        const listeningLog = vi.spyOn(console, 'info').mockImplementation(() => {});
        const settings = new Map();
        const handlers = new Map();
        const clipboard = { writeText: vi.fn() };
        const dispose = startMusicMcp({
            ipcMain: { handle: handlers.set.bind(handlers), removeHandler: handlers.delete.bind(handlers) },
            isTrustedSender: (event: boolean) => event,
            store: { get: (key: string, fallback?: unknown) => settings.get(key) ?? fallback, set: settings.set.bind(settings) },
            env: { FOLIA_MCP_PORT: String(bound.port) },
            clipboard,
        });
        const invoke = handlers.get('music-mcp-settings');
        try {
            expect(await invoke(true, 'status')).toMatchObject({ enabled: false, running: false, writeEnabled: false });
            expect(() => invoke(false, 'copy-config')).toThrow('Untrusted');
            expect(await invoke(true, 'enabled', true)).toMatchObject({ enabled: true, running: false, error: 'port-in-use' });
            await new Promise<void>(resolve => occupied.close(() => resolve()));
            const running = await invoke(true, 'enabled', true);
            expect(running).toMatchObject({ enabled: true, running: true, tokenPersistent: false, error: null });
            expect(listeningLog).toHaveBeenCalledTimes(1);
            expect(Object.keys(running)).not.toContain('token');
            expect(await invoke(true, 'copy-config')).toBe(true);
            const config = JSON.parse(clipboard.writeText.mock.calls[0][0]).mcpServers['folia-music'];
            expect(config.url).toBe(running.address);
            expect(config.headers.Authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
            expect((await fetch(config.url, { method: 'POST' })).status).toBe(403);
            expect(await invoke(true, 'write', true)).toMatchObject({ writeEnabled: true });
            expect(await invoke(true, 'enabled', false)).toMatchObject({ enabled: false, running: false });
            expect(await invoke(true, 'copy-config')).toBe(false);
            expect(settings.get('MUSIC_MCP_ENABLED')).toBe(false);
        } finally {
            listeningLog.mockRestore();
            if (occupied.listening) occupied.close();
            dispose();
        }
    });
});
