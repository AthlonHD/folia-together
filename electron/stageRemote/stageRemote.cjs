'use strict';

// electron/stageRemote/stageRemote.cjs
// The desktop app as a REMOTE CONTROLLER of a Stage server (the fork's "play on the server, control from anywhere" setup).
//
// It opens the server's own controller page in a window of its own, so the controller is always the same one the phone gets, with
// nothing duplicated here. The app is only ever the controller: it opens no port and runs no relay, so nothing can control it.
//
// The window has no preload and a sandbox: the page is somebody else's web page (the server's) and gets no access to this app. The
// address and the access token are kept in the main process; the token is sealed with safeStorage (DPAPI on Windows) and never goes
// back to the settings page, which only learns whether one is saved.

const URL_KEY = 'STAGE_REMOTE_URL';
const TOKEN_SEALED_KEY = 'STAGE_REMOTE_TOKEN_SEALED';
const TOKEN_PLAIN_KEY = 'STAGE_REMOTE_TOKEN';
const WINDOW_PARTITION = 'persist:folia-stage-remote';

/** `192.168.1.5:3000` or `http://host:3000/anything` -> `http://host:3000`. Only http(s), no embedded credentials. */
function normalizeServerUrl(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('empty-url');
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
    let url;
    try {
        url = new URL(withScheme);
    } catch {
        throw new Error('invalid-url');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid-url');
    if (url.username || url.password || !url.hostname) throw new Error('invalid-url');
    return url.origin;
}

/** The controller page address. A token in the query makes the page enter controller mode and then remove it from the address bar. */
function buildControllerUrl(origin, token) {
    return token ? `${origin}/?token=${encodeURIComponent(token)}` : `${origin}/?stageremote=1`;
}

/**
 * @param {{
 *   store: { get: (key: string) => unknown, set: (key: string, value: unknown) => void, delete: (key: string) => void },
 *   safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (text: string) => Buffer, decryptString: (data: Buffer) => string },
 *   BrowserWindow: typeof import('electron').BrowserWindow,
 *   title: string,
 *   fetchImpl?: typeof fetch,
 *   warn?: (...args: unknown[]) => void,
 * }} options
 */
function createStageRemote({ store, safeStorage, BrowserWindow, title, fetchImpl = fetch, warn = console.warn }) {
    let remoteWindow = null;

    const readToken = () => {
        const sealed = store.get(TOKEN_SEALED_KEY);
        if (typeof sealed === 'string' && sealed) {
            try {
                return safeStorage.decryptString(Buffer.from(sealed, 'base64'));
            } catch (error) {
                warn('[StageRemote] the saved token could not be unsealed; it is dropped', error);
                store.delete(TOKEN_SEALED_KEY);
                return '';
            }
        }
        const plain = store.get(TOKEN_PLAIN_KEY);
        return typeof plain === 'string' ? plain : '';
    };

    const writeToken = (token) => {
        store.delete(TOKEN_SEALED_KEY);
        store.delete(TOKEN_PLAIN_KEY);
        if (!token) return;
        if (safeStorage.isEncryptionAvailable()) {
            store.set(TOKEN_SEALED_KEY, safeStorage.encryptString(token).toString('base64'));
        } else {
            // No keyring (some Linux setups): the user typed this by hand, so it is kept rather than lost at every restart.
            store.set(TOKEN_PLAIN_KEY, token);
        }
    };

    const getConfig = () => {
        const url = store.get(URL_KEY);
        return { url: typeof url === 'string' ? url : '', hasToken: Boolean(readToken()) };
    };

    /**
     * `token`: undefined keeps the saved one, '' clears it, any other text replaces it.
     * @param {{ url: unknown, token?: string }} config
     */
    const saveConfig = ({ url, token }) => {
        let origin;
        try {
            origin = normalizeServerUrl(url);
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'invalid-url' };
        }
        store.set(URL_KEY, origin);
        if (typeof token === 'string') writeToken(token.trim());
        return { ok: true, url: origin, hasToken: Boolean(readToken()) };
    };

    const open = () => {
        const { url: origin } = getConfig();
        if (!origin) return { ok: false, error: 'not-configured' };
        if (remoteWindow && !remoteWindow.isDestroyed()) {
            remoteWindow.show();
            remoteWindow.focus();
            return { ok: true };
        }
        const win = new BrowserWindow({
            width: 480,
            height: 860,
            minWidth: 360,
            minHeight: 560,
            title,
            autoHideMenuBar: true,
            backgroundColor: '#0a0a0a',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                partition: WINDOW_PARTITION,
            },
        });
        remoteWindow = win;
        win.on('closed', () => {
            if (remoteWindow === win) remoteWindow = null;
        });
        // Only the server's own pages: no way out to another site, no new windows.
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event, target) => {
            try {
                if (new URL(target).origin !== origin) event.preventDefault();
            } catch {
                event.preventDefault();
            }
        });
        win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
            if (!isMainFrame || code === -3) return; // -3: a load that was replaced by another
            warn('[StageRemote] could not load the controller page', { code, description });
            const message = `Could not reach ${origin} (${description}). Check the address in Settings, that the server is running, and that this computer can reach it.`;
            const escaped = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
            void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="font:14px system-ui;background:#0a0a0a;color:#ddd;padding:24px"><p>${escaped}</p>`)}`);
            void failedUrl;
        });
        void win.loadURL(buildControllerUrl(origin, readToken()));
        return { ok: true };
    };

    /** Which build the server runs (its public /stage/version): lets the settings page say whether it matches this app. */
    const fetchServerVersion = async () => {
        const { url: origin } = getConfig();
        if (!origin) return { ok: false, error: 'not-configured' };
        try {
            const response = await fetchImpl(`${origin}/stage/version`, { signal: AbortSignal.timeout(6000) });
            if (!response.ok) return { ok: false, error: `http-${response.status}` };
            const data = await response.json();
            return { ok: true, commit: String(data.commit || ''), forkVersion: String(data.forkVersion || '') };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'unreachable' };
        }
    };

    const close = () => {
        if (remoteWindow && !remoteWindow.isDestroyed()) remoteWindow.close();
    };

    return { getConfig, saveConfig, open, close, fetchServerVersion };
}

module.exports = { createStageRemote, normalizeServerUrl, buildControllerUrl, URL_KEY, TOKEN_SEALED_KEY, TOKEN_PLAIN_KEY };
