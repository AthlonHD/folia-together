'use strict';

// electron/audioHelper/audioHelperIpc.cjs
// IPC surface of pass-through playback: lets the page pick an endpoint, start/stop a file on it, and hear back what the chain really is.

const fs = require('fs');
const path = require('path');
const { createAudioHelperProcess } = require('./helperProcess.cjs');
const { stageSource } = require('./stageSource.cjs');
const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');

const EVENT_CHANNEL = 'audio-helper:event';
const HELPER_NAME = 'folia-audio-helper.exe';

/** Dev override first, then the packaged resource, then the in-repo build output. */
function resolveHelperExecutable({ resourcesPath, appPath }) {
    if (process.platform !== 'win32') return null;
    const candidates = [
        process.env.FOLIA_AUDIO_HELPER_PATH,
        resourcesPath && path.join(resourcesPath, HELPER_NAME),
        appPath && path.join(appPath, 'build', HELPER_NAME),
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * @param {{
 *   ipcMain: import('electron').IpcMain,
 *   isTrusted: (event: import('electron').IpcMainInvokeEvent) => boolean,
 *   getWindow: () => import('electron').BrowserWindow | null,
 *   stageDirectory: string,
 *   resourcesPath?: string,
 *   appPath?: string,
 * }} options
 */
function registerAudioHelperIpc({ ipcMain, isTrusted, getWindow, stageDirectory, resourcesPath, appPath }) {
    const helper = createAudioHelperProcess({
        resolveExecutable: () => resolveHelperExecutable({ resourcesPath, appPath }),
        onEvent: (event) => {
            if (event.event === 'error') console.warn('[AudioHelper]', event.code, event.message);
            const window = getWindow();
            if (window && !window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event);
        },
    });

    let loadSerial = 0;

    const guarded = (channel, handler, onUntrusted) => {
        ipcMain.handle(channel, createSenderGuardedHandler({ channel, isTrusted, handler, onUntrusted }));
    };

    guarded('audio-helper:status', () => ({
        available: helper.isAvailable(),
        running: helper.isRunning(),
    }), () => ({ available: false, running: false }));

    guarded('audio-helper:devices', async () => {
        try {
            return { ok: true, devices: await helper.devices() };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }, () => ({ ok: false, error: 'untrusted' }));

    guarded('audio-helper:probe', async (_event, deviceId) => {
        try {
            return { ok: true, formats: await helper.probe(String(deviceId)) };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }, () => ({ ok: false, error: 'untrusted' }));

    guarded('audio-helper:configure', (_event, config) => helper.configure({
        deviceId: String(config?.deviceId ?? ''),
        rateStrategy: config?.rateStrategy === 'fixed' ? 'fixed' : 'native',
        mode: config?.mode === 'shared' ? 'shared' : 'exclusive',
        fixedRate: Number.isFinite(config?.fixedRate) ? Math.round(config.fixedRate) : 192000,
    }));

    guarded('audio-helper:load', async (_event, request) => {
        const serial = ++loadSerial;
        try {
            const filePath = await stageSource({ directory: stageDirectory, source: request.source });
            // A newer load arrived while this one was downloading: the page has moved on, so this one is dropped unplayed.
            if (serial !== loadSerial) return { ok: false, error: 'superseded' };
            const sent = helper.send({
                cmd: 'load',
                path: filePath,
                startSec: Number.isFinite(request.startSec) ? request.startSec : 0,
                autoplay: request.autoplay !== false,
                token: Number.isFinite(request.token) ? request.token : 0,
            });
            return sent ? { ok: true } : { ok: false, error: 'helper-unavailable' };
        } catch (error) {
            console.warn('[AudioHelper] staging the source failed', error);
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    guarded('audio-helper:play', () => helper.sendIfRunning({ cmd: 'play' }));
    guarded('audio-helper:pause', () => helper.sendIfRunning({ cmd: 'pause' }));
    guarded('audio-helper:seek', (_event, sec) => helper.sendIfRunning({ cmd: 'seek', sec: Number(sec) || 0 }));
    guarded('audio-helper:stop', () => {
        loadSerial += 1;
        return helper.sendIfRunning({ cmd: 'stop' });
    });

    return { shutdown: () => helper.stop() };
}

module.exports = { registerAudioHelperIpc, resolveHelperExecutable };
