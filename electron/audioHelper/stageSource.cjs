'use strict';

// electron/audioHelper/stageSource.cjs
// Turns "what the page is playing" (an http(s) URL, a file URL, an address of the app's own audio schemes, or bytes read out of a blob URL)
// into a file path the helper can open. Staged files live in one directory and the oldest are removed, so pass-through never grows the
// disk without bound. Audio that arrives through the app's own schemes (decrypted or transcoded by the app) is staged as an ephemeral
// `eph-` file: it is removed as soon as the next track is staged and when the app starts or quits, never kept as a cache.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const KEEP_STAGED_FILES = 6;
const EPHEMERAL_PREFIX = 'eph-';

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

const download = async (fetchImpl, url, target) => {
    const response = await fetchImpl(url);
    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
    await writeAtomically(target, async (part) => {
        const out = fs.createWriteStream(part);
        const reader = response.body.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
            }
        } finally {
            await new Promise((resolve) => out.end(resolve));
        }
    });
};

/**
 * @param {{
 *   directory: string,
 *   source: { kind: 'url', url: string } | { kind: 'bytes', bytes: ArrayBuffer | Uint8Array, ext?: string },
 *   fetchImpl?: typeof fetch,          // fetch that understands the app's own schemes (Electron's net.fetch); plain fetch otherwise
 *   customSchemes?: string[],          // schemes (without the colon) answered by the app itself
 * }} options
 * @returns {Promise<string>} absolute path of a readable file
 */
async function stageSource({ directory, source, fetchImpl = fetch, customSchemes = [] }) {
    await fs.promises.mkdir(directory, { recursive: true });

    if (source.kind === 'bytes') {
        const buffer = Buffer.from(source.bytes);
        const digest = crypto.createHash('sha1').update(buffer).digest('hex');
        const name = `${hashOf(`${buffer.length}:${digest}`)}${source.ext ? `.${source.ext}` : ''}`;
        const target = path.join(directory, name);
        if (!fs.existsSync(target)) await writeAtomically(target, (part) => fs.promises.writeFile(part, buffer));
        await prune(directory, name);
        await cleanEphemeral(directory);
        return target;
    }

    if (source.kind === 'url') {
        const url = new URL(source.url);
        if (url.protocol === 'file:') return fileURLToPath(url);

        if (url.protocol === 'http:' || url.protocol === 'https:') {
            const name = hashOf(source.url);
            const target = path.join(directory, name);
            if (!fs.existsSync(target)) await download(fetchImpl, source.url, target);
            await prune(directory, name);
            await cleanEphemeral(directory);
            return target;
        }

        if (customSchemes.includes(url.protocol.replace(/:$/, ''))) {
            // Addresses of the app's own schemes are one-off (they carry a key issued for this play), and what they answer was decrypted
            // or converted by the app: kept only for as long as this track needs it.
            const target = path.join(directory, `${EPHEMERAL_PREFIX}${hashOf(`${source.url}:${Date.now()}`)}`);
            await download(fetchImpl, source.url, target);
            await cleanEphemeral(directory, target);
            return target;
        }

        throw new Error(`unsupported source scheme: ${url.protocol}`);
    }

    throw new Error('unknown source kind');
}

module.exports = { stageSource, cleanEphemeral, EPHEMERAL_PREFIX };
