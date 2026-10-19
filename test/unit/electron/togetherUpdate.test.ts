import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/electron/togetherUpdate.test.ts
// The fork's own update check and installer download, against a stand-in for GitHub.

const require = createRequire(import.meta.url);
const { checkForUpdate, downloadAndInstall, sameCommit, releaseCommitOf } = require('../../../electron/togetherUpdate/togetherUpdate.cjs') as typeof import('../../../electron/togetherUpdate/togetherUpdate.cjs');

const REPO = 'AthlonHD/folia-together';
const NEW_COMMIT = 'b'.repeat(40);
const directories: string[] = [];
afterEach(() => {
    while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});
const scratch = () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'folia-update-'));
    directories.push(directory);
    return directory;
};

const releaseJson = (overrides: Record<string, unknown> = {}) => ({
    target_commitish: NEW_COMMIT,
    published_at: '2026-10-19T13:00:00Z',
    assets: [
        { name: `Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe`, size: 5, browser_download_url: `https://github.com/${REPO}/releases/download/together-latest/Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe` },
        { name: `Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe.sha256`, size: 90, browser_download_url: `https://github.com/${REPO}/releases/download/together-latest/Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe.sha256` },
    ],
    ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A GitHub that answers the release and the compare. */
const github = (release: unknown, compareStatus: string | number) => (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/releases/tags/')) return release === null ? new Response('{}', { status: 404 }) : json(release);
    if (url.includes('/compare/')) return typeof compareStatus === 'number' ? new Response('{}', { status: compareStatus }) : json({ status: compareStatus });
    return new Response('?', { status: 500 });
}) as typeof fetch;

describe('commit helpers', () => {
    it('treats a short commit and its full form as the same one', () => {
        expect(sameCommit('abc1234', `abc1234${'0'.repeat(33)}`)).toBe(true);
        expect(sameCommit('abc1234', 'abd1234')).toBe(false);
        expect(sameCommit('', 'abc1234')).toBe(false);
    });

    it('reads the commit from the release target, or from the installer name when the target is a branch', () => {
        expect(releaseCommitOf({ target_commitish: NEW_COMMIT }, 'x')).toBe(NEW_COMMIT);
        expect(releaseCommitOf({ target_commitish: 'stage-remote' }, 'Folia-Together-v1.1.0-abc1234-Setup.exe')).toBe('abc1234');
    });
});

describe('checkForUpdate', () => {
    it('says unknown for a build that does not know its commit', async () => {
        expect((await checkForUpdate({ fetchImpl: github(releaseJson(), 'ahead'), installedCommit: 'dev' })).status).toBe('unknown');
        expect((await checkForUpdate({ fetchImpl: github(releaseJson(), 'ahead'), installedCommit: '' })).status).toBe('unknown');
    });

    it('is up to date when the release is the commit the app was built from', async () => {
        const result = await checkForUpdate({ fetchImpl: github(releaseJson(), 'ahead'), installedCommit: NEW_COMMIT.slice(0, 7) });
        expect(result.status).toBe('up-to-date');
    });

    it('offers the installer when the release is ahead of the installed commit', async () => {
        const result = await checkForUpdate({ fetchImpl: github(releaseJson(), 'ahead'), installedCommit: 'aaaaaaa' });
        expect(result.status).toBe('available');
        expect(result.release).toMatchObject({ commit: NEW_COMMIT, name: expect.stringMatching(/Setup\.exe$/), checksumUrl: expect.stringMatching(/\.sha256$/) });
    });

    it('does not offer a release that is behind the installed build', async () => {
        expect((await checkForUpdate({ fetchImpl: github(releaseJson(), 'behind'), installedCommit: 'aaaaaaa' })).status).toBe('up-to-date');
    });

    it('offers it when the installed commit is not one GitHub knows', async () => {
        expect((await checkForUpdate({ fetchImpl: github(releaseJson(), 404), installedCommit: 'aaaaaaa' })).status).toBe('available');
    });

    it('says none when there is no release or no installer in it yet', async () => {
        expect((await checkForUpdate({ fetchImpl: github(null, 'ahead'), installedCommit: 'aaaaaaa' })).status).toBe('none');
        expect((await checkForUpdate({ fetchImpl: github(releaseJson({ assets: [] }), 'ahead'), installedCommit: 'aaaaaaa' })).status).toBe('none');
    });

    it('reports a GitHub failure as unknown instead of guessing', async () => {
        const failing = (async () => new Response('{}', { status: 403 })) as typeof fetch;
        const result = await checkForUpdate({ fetchImpl: failing, installedCommit: 'aaaaaaa' });
        expect(result.status).toBe('unknown');
        expect(result.error).toMatch(/403/);
    });
});

describe('downloadAndInstall', () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const digest = createHash('sha256').update(body).digest('hex');
    const release = (overrides: Record<string, unknown> = {}) => ({
        name: `Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe`,
        url: `https://github.com/${REPO}/releases/download/together-latest/Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe`,
        checksumUrl: `https://github.com/${REPO}/releases/download/together-latest/Folia-Together-v1.1.0-${NEW_COMMIT.slice(0, 7)}-Setup.exe.sha256`,
        size: 5,
        ...overrides,
    });
    const files = (checksum: string) => (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('.sha256')) return new Response(`${checksum}  installer.exe\n`);
        return new Response(body, { headers: { 'content-length': String(body.length) } });
    }) as typeof fetch;

    it('downloads, verifies the checksum, and hands the file to the launcher', async () => {
        const directory = scratch();
        const launched: string[] = [];
        const progress: number[] = [];
        const file = await downloadAndInstall({
            release: release(), directory, repo: REPO, fetchImpl: files(digest),
            onProgress: (done) => progress.push(done), launch: (f: string) => launched.push(f),
        });
        expect(launched).toEqual([file]);
        expect([...readFileSync(file)]).toEqual([...body]);
        expect(progress.at(-1)).toBe(5);
    });

    it('refuses a file whose checksum does not match, and keeps nothing', async () => {
        const directory = scratch();
        const launched: string[] = [];
        await expect(downloadAndInstall({ release: release(), directory, repo: REPO, fetchImpl: files('0'.repeat(64)), launch: (f: string) => launched.push(f) })).rejects.toThrow('checksum-mismatch');
        expect(launched).toEqual([]);
        expect(existsSync(path.join(directory, release().name))).toBe(false);
        expect(existsSync(path.join(directory, `${release().name}.part`))).toBe(false);
    });

    it('refuses an address that is not an installer of this project', async () => {
        const run = (overrides: Record<string, unknown>) => downloadAndInstall({ release: release(overrides), directory: scratch(), repo: REPO, fetchImpl: files(digest), launch: () => {} });
        await expect(run({ url: 'https://evil.example.com/Folia-Together-v1-abc1234-Setup.exe' })).rejects.toThrow('not-an-installer-of-this-project');
        await expect(run({ name: 'payload.exe' })).rejects.toThrow('not-an-installer-of-this-project');
        await expect(run({ checksumUrl: 'https://evil.example.com/x.sha256' })).rejects.toThrow('not-an-installer-of-this-project');
    });

    it('refuses a download that ends short', async () => {
        const short = (async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '5' } })) as typeof fetch;
        await expect(downloadAndInstall({ release: release({ checksumUrl: null }), directory: scratch(), repo: REPO, fetchImpl: short, launch: () => {} })).rejects.toThrow('download-incomplete');
    });
});
