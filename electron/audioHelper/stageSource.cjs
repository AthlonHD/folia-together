'use strict';

// electron/audioHelper/stageSource.cjs
// Turns "what the page is playing" (an http(s) URL, a file URL, an address of the app's own audio schemes, or bytes read out of a blob URL)
// into a file path the helper can open. Staged files live in one directory and the oldest are removed, so pass-through never grows the
// disk without bound. Audio that arrives through the app's own schemes (decrypted or transcoded by the app) is staged as an ephemeral
// `eph-` file: it is removed as soon as the next track is staged and when the app starts or quits, never kept as a cache.
//
// A song that has to be downloaded is handed over as soon as its first part is on disk (`beginStage` resolves then), while the rest keeps
// arriving into a `.part` file: the helper reads that file as it grows (see GrowingFile in the helper), so the song starts in a fraction
// of a second instead of after the whole download. `done` settles when the file is complete and has been renamed to its final name.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const KEEP_STAGED_FILES = 6;
const EPHEMERAL_PREFIX = 'eph-';
/** How much of a download must be on disk before the song is handed to the helper (it needs the header and the first frames). */
const HEAD_START_BYTES = 512 * 1024;

const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 24);

const prune = async (directory, keepName) => {
    const names = await fs.promises.readdir(directory).catch(() => []);
    const entries = [];
    for (const name of names) {
        if (name.endsWith('.part') || name.startsWith(EPHEMERAL_PREFIX)) continue;
        const stat = await fs.promises.stat(path.join(directory, name)).catch(() => null);
        if (stat) entries.push({ name, mtimeMs: stat.mtimeMs });
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(KEEP_STAGED_FILES)) {
        if (entry.name !== keepName) await fs.promises.unlink(path.join(directory, entry.name)).catch(() => {});
    }
};

/**
 * Removes the ephemeral files except `keepPath`. A file the helper still has open cannot be deleted on Windows; that failure is
 * ignored and the file goes with the next call (or at quit), by which time the helper has moved on.
 */
const cleanEphemeral = async (directory, keepPath = null) => {
    const names = await fs.promises.readdir(directory).catch(() => []);
    for (const name of names) {
        if (!name.startsWith(EPHEMERAL_PREFIX)) continue;
        const full = path.join(directory, name);
        if (keepPath && path.resolve(full) === path.resolve(keepPath)) continue;
        await fs.promises.unlink(full).catch(() => {});
    }
};

const writeAtomically = async (finalPath, writeInto) => {
    const partPath = `${finalPath}.part`;
    await writeInto(partPath);
    await fs.promises.rename(partPath, finalPath);
};

/**
 * Starts downloading `url` into `target`. Resolves, as `ready`, once enough is on disk to start playing (or the whole file, if it is
 * smaller), with the path to read from (`target.part` while it is coming in) and the size the file will have. `done` settles at the end.
 * Without a known size nothing can be played before the end, so the file is simply downloaded whole and `ready` follows `done`.
 */
const startDownload = async (fetchImpl, url, target, signal) => {
    const response = await fetchImpl(url, signal ? { signal } : undefined);
    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const partPath = `${target}.part`;
    const out = fs.createWriteStream(partPath);
    const threshold = total ? Math.min(total, HEAD_START_BYTES) : Infinity;

    let flushed = 0;
    let signalReady;
    let failReady;
    const ready = new Promise((resolve, reject) => {
        signalReady = resolve;
        failReady = reject;
    });

    const done = (async () => {
        const reader = response.body.getReader();
        try {
            for (;;) {
                const { done: finished, value } = await reader.read();
                if (finished) break;
                await new Promise((resolve, reject) => {
                    out.write(value, (error) => (error ? reject(error) : resolve()));
                });
                flushed += value.length;
                if (flushed >= threshold) signalReady();
            }
            await new Promise((resolve) => out.end(resolve));
            await fs.promises.rename(partPath, target);
            signalReady();
            return target;
        } catch (error) {
            out.destroy();
            await fs.promises.unlink(partPath).catch(() => {});
            failReady(error);
            throw error;
        } finally {
            reader.releaseLock?.();
        }
    })();
    // A failure nobody awaits (the caller moved on) must not become an unhandled rejection.
    done.catch(() => {});
    ready.catch(() => {});

    await ready;
    // Everything arrived within the head start (or the size is unknown, and `ready` only came at the end): hand over the finished file.
    if (!total || flushed >= total) {
        const finalPath = await done;
        return { path: finalPath, totalBytes: total, growing: false, done };
    }
    return { path: partPath, totalBytes: total, growing: true, done };
};

/**
 * @param {{
 *   directory: string,
 *   source: { kind: 'url', url: string } | { kind: 'bytes', bytes: ArrayBuffer | Uint8Array, ext?: string },
 *   fetchImpl?: typeof fetch,          // fetch that understands the app's own schemes (Electron's net.fetch); plain fetch otherwise
 *   customSchemes?: string[],          // schemes (without the colon) answered by the app itself
 *   signal?: AbortSignal,              // ends a download that is no longer wanted (the song was replaced)
 * }} options
 * @returns {Promise<{ path: string, growing: boolean, totalBytes: number, done: Promise<string> }>}
 *   `path` is readable now; when `growing`, it is a file still being written, `totalBytes` its final size, and `done` settles when complete.
 */
async function beginStage({ directory, source, fetchImpl = fetch, customSchemes = [], signal }) {
    await fs.promises.mkdir(directory, { recursive: true });
    const complete = (file) => ({ path: file, growing: false, totalBytes: 0, done: Promise.resolve(file) });

    if (source.kind === 'bytes') {
        const buffer = Buffer.from(source.bytes);
        const digest = crypto.createHash('sha1').update(buffer).digest('hex');
        const name = `${hashOf(`${buffer.length}:${digest}`)}${source.ext ? `.${source.ext}` : ''}`;
        const target = path.join(directory, name);
        if (!fs.existsSync(target)) await writeAtomically(target, (part) => fs.promises.writeFile(part, buffer));
        await prune(directory, name);
        await cleanEphemeral(directory);
        return complete(target);
    }

    if (source.kind === 'url') {
        const url = new URL(source.url);
        if (url.protocol === 'file:') return complete(fileURLToPath(url));

        if (url.protocol === 'http:' || url.protocol === 'https:') {
            const name = hashOf(source.url);
            const target = path.join(directory, name);
            if (fs.existsSync(target)) {
                await prune(directory, name);
                await cleanEphemeral(directory);
                return complete(target);
            }
            const started = await startDownload(fetchImpl, source.url, target, signal);
            await prune(directory, name);
            await cleanEphemeral(directory);
            return started;
        }

        if (customSchemes.includes(url.protocol.replace(/:$/, ''))) {
            // Addresses of the app's own schemes are one-off (they carry a key issued for this play), and what they answer was decrypted
            // or converted by the app: kept only for as long as this track needs it.
            const target = path.join(directory, `${EPHEMERAL_PREFIX}${hashOf(`${source.url}:${Date.now()}`)}`);
            const started = await startDownload(fetchImpl, source.url, target, signal);
            await cleanEphemeral(directory, started.path);
            return started;
        }

        throw new Error(`unsupported source scheme: ${url.protocol}`);
    }

    throw new Error('unknown source kind');
}

/** The whole file, once it is complete: what the staging was before it could start early. */
async function stageSource(options) {
    const staged = await beginStage(options);
    return staged.done;
}

module.exports = { beginStage, stageSource, cleanEphemeral, EPHEMERAL_PREFIX, HEAD_START_BYTES };
