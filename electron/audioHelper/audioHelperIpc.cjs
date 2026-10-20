'use strict';

// electron/audioHelper/audioHelperIpc.cjs
// IPC surface of pass-through playback: lets the page pick an endpoint, start/stop a file on it, and hear back what the chain really is.

const fs = require('fs');
const path = require('path');
const { createAudioHelperProcess } = require('./helperProcess.cjs');
const { beginStage, cleanEphemeral } = require('./stageSource.cjs');
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
 *   fetchImpl?: typeof fetch,
 *   customSchemes?: string[],
 *   resourcesPath?: string,
 *   appPath?: string,
 * }} options
 */
function registerAudioHelperIpc({ ipcMain, isTrusted, getWindow, stageDirectory, fetchImpl, customSchemes = [], resourcesPath, appPath }) {
    // Ephemeral files of an earlier run are not wanted: they are removed at start as well as at quit.
    void cleanEphemeral(stageDirectory);

    const helper = createAudioHelperProcess({
        resolveExecutable: () => resolveHelperExecutable({ resourcesPath, appPath }),
        onEvent: (event) => {
            if (event.event === 'error') console.warn('[AudioHelper]', event.code, event.message);
            const window = getWindow();
            if (window && !window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event);
        },
    });

    let loadSerial = 0;
    // The download of the song being loaded: ended when another song replaces it, so it does not go on taking the connection.
    let currentDownload = null;

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
        resampler: config?.resampler === 'soxr' ? 'soxr' : 'rubato',
        fixedRate: Number.isFinite(config?.fixedRate) ? Math.round(config.fixedRate) : 192000,
    }));

    const endCurrentDownload = () => {
        currentDownload?.abort();
        currentDownload = null;
    };

    guarded('audio-helper:load', async (_event, request) => {
        const serial = ++loadSerial;
        endCurrentDownload();
        const download = new AbortController();
        currentDownload = download;
        try {
            // Resolves once the first part of the song is on disk: the helper starts from there while the rest is still coming in.
            const staged = await beginStage({ directory: stageDirectory, source: request.source, fetchImpl, customSchemes, signal: download.signal });
            // A newer load arrived while this one was starting: the page has moved on, so this one is dropped unplayed.
            if (serial !== loadSerial) {
                download.abort();
                return { ok: false, error: 'superseded' };
            }
            const sent = helper.send({
                cmd: 'load',
                path: staged.path,
                startSec: Number.isFinite(request.startSec) ? request.startSec : 0,
                autoplay: request.autoplay !== false,
                token: Number.isFinite(request.token) ? request.token : 0,
                ...(staged.growing ? { totalBytes: staged.totalBytes } : {}),
            });
            if (staged.growing) {
                // The rest of the song failed to arrive: the helper would only wait for it, so say so now.
                staged.done.catch((error) => {
                    if (serial !== loadSerial || download.signal.aborted) return;
                    console.warn('[AudioHelper] the download of the song failed part-way', error);
                    helper.sendIfRunning({ cmd: 'stop' });
                    const window = getWindow();
                    if (window && !window.isDestroyed()) {
                        window.webContents.send(EVENT_CHANNEL, { event: 'error', code: 'stage-failed', message: error instanceof Error ? error.message : String(error) });
                    }
                });
            }
            return sent ? { ok: true } : { ok: false, error: 'helper-unavailable' };
        } catch (error) {
            if (download.signal.aborted && serial !== loadSerial) return { ok: false, error: 'superseded' };
            console.warn('[AudioHelper] staging the source failed', error);
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    guarded('audio-helper:play', () => helper.sendIfRunning({ cmd: 'play' }));
    guarded('audio-helper:pause', () => helper.sendIfRunning({ cmd: 'pause' }));
    guarded('audio-helper:seek', (_event, sec) => helper.sendIfRunning({ cmd: 'seek', sec: Number(sec) || 0 }));
    guarded('audio-helper:stop', () => {
        loadSerial += 1;
        endCurrentDownload();
        return helper.sendIfRunning({ cmd: 'stop' });
    });

    return {
        shutdown: async () => {
            endCurrentDownload();
            await helper.stop();
            await cleanEphemeral(stageDirectory);
        },
    };
}

module.exports = { registerAudioHelperIpc, resolveHelperExecutable };
