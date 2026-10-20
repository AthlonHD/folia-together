'use strict';

// electron/togetherUpdate/togetherUpdate.cjs
// Update check and update for THIS fork's builds. The installed app asks the fork's own rolling release (`together-latest`, made by
// .github/workflows/together-installer.yml on every push) whether it is newer than the commit the app was built from, downloads the
// installer, checks its SHA-256 and runs it. It replaces electron-updater here: that one follows version numbers and the upstream
// project's releases, and fork builds carry the upstream's version number.
//
// What the page can ask for is narrow: check, and install what the last check found. The address that gets downloaded comes from the
// GitHub release answered to the main process, never from the page, and must be one of this repository's own release assets.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_REPO = 'AthlonHD/folia-together';
const DEFAULT_TAG = 'together-latest';
const INSTALLER_PATTERN = /^Folia-Together-.*-Setup\.exe$/;
const PORTABLE_PATTERN = /^Folia-Together-.*-Portable\.exe$/;
const USER_AGENT = 'folia-together-updater';

const apiHeaders = { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT };

const shortOf = (commit) => String(commit || '').trim().toLowerCase();
const sameCommit = (a, b) => {
    const x = shortOf(a);
    const y = shortOf(b);
    return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x));
};

/** The commit a release was built from: its target when that is a commit, else the one in the installer's file name. */
function releaseCommitOf(release, installerName) {
    const target = shortOf(release.target_commitish);
    if (/^[0-9a-f]{40}$/.test(target)) return target;
    const fromName = /-([0-9a-f]{7,40})-(?:Setup|Portable)\.exe$/i.exec(installerName || '');
    return fromName ? fromName[1].toLowerCase() : '';
}

/**
 * @returns {Promise<{ status: 'up-to-date' | 'available' | 'none' | 'unknown', release?: object, error?: string }>}
 *   `unknown`: this build does not know its own commit (a development run), so there is nothing to compare.
 */
async function checkForUpdate({ fetchImpl = fetch, repo = DEFAULT_REPO, tag = DEFAULT_TAG, installedCommit, portable = false }) {
    const installed = shortOf(installedCommit);
    if (!installed || installed === 'dev') return { status: 'unknown' };

    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers: apiHeaders });
    if (response.status === 404) return { status: 'none' };
    if (!response.ok) return { status: 'unknown', error: `GitHub answered ${response.status}` };
    const data = await response.json();

    const asset = (data.assets || []).find((item) => (portable ? PORTABLE_PATTERN : INSTALLER_PATTERN).test(item.name));
    if (!asset) return { status: 'none' };
    const checksumAsset = (data.assets || []).find((item) => item.name === `${asset.name}.sha256`);
    const commit = releaseCommitOf(data, asset.name);
    const release = {
        name: asset.name,
        commit,
        size: asset.size,
        url: asset.browser_download_url,
        checksumUrl: checksumAsset ? checksumAsset.browser_download_url : null,
        publishedAt: data.published_at || data.created_at || null,
    };
    if (!commit || sameCommit(commit, installed)) return { status: 'up-to-date', release };

    // Which one is newer: asked of GitHub, since commit hashes do not order themselves.
    const compare = await fetchImpl(`https://api.github.com/repos/${repo}/compare/${installed}...${commit}`, { headers: apiHeaders });
    if (compare.status === 404 || compare.status === 422) return { status: 'available', release }; // not a commit this repository knows
    if (!compare.ok) return { status: 'unknown', release, error: `GitHub answered ${compare.status}` };
    const { status } = await compare.json();
    return { status: status === 'ahead' || status === 'diverged' ? 'available' : 'up-to-date', release };
}

const isOwnAsset = (url, repo) => typeof url === 'string' && url.startsWith(`https://github.com/${repo}/releases/download/`);

const sha256Of = (file) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

/**
 * Downloads the installer of `release`, verifies it and hands it to `launch`.
 * @param {{ release: { name: string, url: string, checksumUrl: string | null, size?: number }, directory: string, repo?: string,
 *   fetchImpl?: typeof fetch, onProgress?: (done: number, total: number) => void, launch: (file: string) => void }} options
 */
async function downloadAndInstall({ release, directory, repo = DEFAULT_REPO, fetchImpl = fetch, onProgress = () => {}, launch }) {
    if (!release || !(INSTALLER_PATTERN.test(release.name || '') || PORTABLE_PATTERN.test(release.name || '')) || !isOwnAsset(release.url, repo)) throw new Error('not-an-installer-of-this-project');
    if (release.checksumUrl && !isOwnAsset(release.checksumUrl, repo)) throw new Error('not-an-installer-of-this-project');
    await fs.promises.mkdir(directory, { recursive: true });
    const target = path.join(directory, release.name);
    const partial = `${target}.part`;

    const response = await fetchImpl(release.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok || !response.body) throw new Error(`download-failed:${response.status}`);
    const total = Number(response.headers.get('content-length')) || release.size || 0;
    let done = 0;
    const out = fs.createWriteStream(partial);
    const reader = response.body.getReader();
    try {
        for (;;) {
            const { done: finished, value } = await reader.read();
            if (finished) break;
            done += value.length;
            if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
            onProgress(done, total);
        }
    } finally {
        await new Promise((resolve) => out.end(resolve));
    }
    if (total && done !== total) {
        await fs.promises.unlink(partial).catch(() => {});
        throw new Error('download-incomplete');
    }

    if (release.checksumUrl) {
        const text = await (await fetchImpl(release.checksumUrl, { headers: { 'User-Agent': USER_AGENT } })).text();
        const expected = (text.trim().split(/\s+/)[0] || '').toLowerCase();
        const actual = await sha256Of(partial);
        if (!/^[0-9a-f]{64}$/.test(expected) || expected !== actual) {
            await fs.promises.unlink(partial).catch(() => {});
            throw new Error('checksum-mismatch');
        }
    }
    await fs.promises.rename(partial, target);
    launch(target);
    return target;
}

module.exports = { checkForUpdate, downloadAndInstall, sameCommit, releaseCommitOf, DEFAULT_REPO, DEFAULT_TAG };
