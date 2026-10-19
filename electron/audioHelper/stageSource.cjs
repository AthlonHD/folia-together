'use strict';

// electron/audioHelper/stageSource.cjs
// Turns "what the page is playing" (an http(s) URL, a file URL, or bytes read out of a blob URL) into a file path the helper can open.
// Staged files live in one directory and the oldest are removed, so pass-through never grows the disk without bound.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const KEEP_STAGED_FILES = 6;

const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 24);

const prune = async (directory, keepName) => {
    const names = await fs.promises.readdir(directory).catch(() => []);
    const entries = [];
    for (const name of names) {
        if (name.endsWith('.part')) continue;
        const stat = await fs.promises.stat(path.join(directory, name)).catch(() => null);
        if (stat) entries.push({ name, mtimeMs: stat.mtimeMs });
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(KEEP_STAGED_FILES)) {
        if (entry.name !== keepName) await fs.promises.unlink(path.join(directory, entry.name)).catch(() => {});
    }
};

const writeAtomically = async (finalPath, writeInto) => {
    const partPath = `${finalPath}.part`;
    await writeInto(partPath);
    await fs.promises.rename(partPath, finalPath);
};

/**
 * @param {{ directory: string, source: { kind: 'url', url: string } | { kind: 'bytes', bytes: ArrayBuffer | Uint8Array, ext?: string } }} options
 * @returns {Promise<string>} absolute path of a readable file
 */
async function stageSource({ directory, source }) {
    await fs.promises.mkdir(directory, { recursive: true });

    if (source.kind === 'bytes') {
        const buffer = Buffer.from(source.bytes);
        const digest = crypto.createHash('sha1').update(buffer).digest('hex');
        const name = `${hashOf(`${buffer.length}:${digest}`)}${source.ext ? `.${source.ext}` : ''}`;
        const target = path.join(directory, name);
        if (!fs.existsSync(target)) await writeAtomically(target, (part) => fs.promises.writeFile(part, buffer));
        await prune(directory, name);
        return target;
    }

    if (source.kind === 'url') {
        const url = new URL(source.url);
        if (url.protocol === 'file:') return fileURLToPath(url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error(`unsupported source scheme: ${url.protocol}`);
        }
        const name = hashOf(source.url);
        const target = path.join(directory, name);
        if (!fs.existsSync(target)) {
            const response = await fetch(source.url);
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
        }
        await prune(directory, name);
        return target;
    }

    throw new Error('unknown source kind');
}

module.exports = { stageSource };
