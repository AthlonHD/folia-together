import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/electron/audioHelperProcess.test.ts
// The main-process half of pass-through: files staged for the helper, and the helper's line protocol (against a stand-in script).

const require = createRequire(import.meta.url);
const { createAudioHelperProcess } = require('../../../electron/audioHelper/helperProcess.cjs') as typeof import('../../../electron/audioHelper/helperProcess.cjs');
const { stageSource } = require('../../../electron/audioHelper/stageSource.cjs') as typeof import('../../../electron/audioHelper/stageSource.cjs');

const directories: string[] = [];
const scratch = () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'folia-passthrough-'));
    directories.push(directory);
    return directory;
};

afterEach(() => {
    while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('stageSource', () => {
    it('writes bytes once and returns the same file for the same content', async () => {
        const directory = scratch();
        const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
        const first = await stageSource({ directory, source: { kind: 'bytes', bytes, ext: 'flac' } });
        const second = await stageSource({ directory, source: { kind: 'bytes', bytes, ext: 'flac' } });
        expect(second).toBe(first);
        expect(first.endsWith('.flac')).toBe(true);
        expect([...readFileSync(first)]).toEqual([1, 2, 3, 4]);
    });

    it('hands a file URL back as the path itself, without copying', async () => {
        const directory = scratch();
        const file = path.join(scratch(), 'song.flac');
        writeFileSync(file, 'x');
        expect(await stageSource({ directory, source: { kind: 'url', url: pathToFileURL(file).href } })).toBe(file);
    });

    it('refuses schemes the helper cannot read', async () => {
        await expect(stageSource({ directory: scratch(), source: { kind: 'url', url: 'ftp://example.com/a.flac' } })).rejects.toThrow(/unsupported/);
    });

    it('keeps only the most recent staged files', async () => {
        const directory = scratch();
        for (let i = 0; i < 9; i += 1) {
            await stageSource({ directory, source: { kind: 'bytes', bytes: new Uint8Array([i, i + 1]).buffer } });
        }
        expect(readdirSync(directory).length).toBeLessThanOrEqual(6);
    });
});

describe('createAudioHelperProcess', () => {
    // A stand-in helper: answers `devices` and `probe`, reports a position for `load`, exits on `quit`.
    const fakeHelperScript = () => {
        const script = path.join(scratch(), 'fake-helper.cjs');
        writeFileSync(script, [
            "const readline = require('readline');",
            "const emit = (e) => process.stdout.write(JSON.stringify(e) + '\\n');",
            "emit({ event: 'ready', version: 'fake' });",
            "readline.createInterface({ input: process.stdin }).on('line', (line) => {",
            '    const c = JSON.parse(line);',
            "    if (c.cmd === 'devices') emit({ event: 'devices', devices: [{ id: 'a', name: 'A', isDefault: true, mixRate: 48000, mixBits: 24 }] });",
            "    if (c.cmd === 'probe') emit({ event: 'probe', deviceId: c.deviceId, formats: [{ rate: 96000, bits: 32, validBits: 24, exclusive: true }] });",
            "    if (c.cmd === 'load') emit({ event: 'position', sec: 1.5, durationSec: 4, token: c.token });",
            "    if (c.cmd === 'quit') process.exit(0);",
            '});',
        ].join('\n'));
        return script;
    };

    const start = () => {
        const events: Array<Record<string, unknown>> = [];
        const helper = createAudioHelperProcess({
            resolveExecutable: () => process.execPath,
            args: [fakeHelperScript()],
            onEvent: (event: object) => events.push(event as Record<string, unknown>),
        });
        return { helper, events };
    };

    it('answers a device request with the helper\'s device list', async () => {
        const { helper } = start();
        try {
            expect(await helper.devices()).toEqual([{ id: 'a', name: 'A', isDefault: true, mixRate: 48000, mixBits: 24 }]);
        } finally {
            await helper.stop();
        }
    });

    it('answers two device requests made at once', async () => {
        const { helper } = start();
        try {
            const [first, second] = await Promise.all([helper.devices(), helper.devices()]);
            expect(first).toHaveLength(1);
            expect(second).toEqual(first);
        } finally {
            await helper.stop();
        }
    });

    it('matches a probe reply to the device it was asked about', async () => {
        const { helper } = start();
        try {
            expect(await helper.probe('a')).toEqual([{ rate: 96000, bits: 32, validBits: 24, exclusive: true }]);
        } finally {
            await helper.stop();
        }
    });

    it('forwards events and carries the token of a load through', async () => {
        const { helper, events } = start();
        try {
            await helper.devices();
            helper.send({ cmd: 'load', path: 'x', startSec: 0, autoplay: false, token: 42 });
            for (let i = 0; i < 50 && !events.some((event) => event.event === 'position'); i += 1) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(events.find((event) => event.event === 'position')).toMatchObject({ sec: 1.5, token: 42 });
        } finally {
            await helper.stop();
        }
    });

    it('does not start the helper just to say stop', () => {
        const { helper } = start();
        expect(helper.sendIfRunning({ cmd: 'stop' })).toBe(false);
        expect(helper.isRunning()).toBe(false);
    });

    it('rejects a request when there is no helper to run', async () => {
        const helper = createAudioHelperProcess({ resolveExecutable: () => null, onEvent: () => {} });
        expect(helper.isAvailable()).toBe(false);
        await expect(helper.devices()).rejects.toThrow(/not available/);
    });
});
