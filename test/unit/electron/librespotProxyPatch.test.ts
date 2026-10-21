import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/electron/librespotProxyPatch.test.ts
// The patch that gives the Spotify playback component a proxy option, applied to the real sources of the installed package: a new version
// of the package that no longer matches must fail here, not in the installer build.

const require = createRequire(import.meta.url);
const { patchLibRs, patchCargoToml } = require('../../../packaging/windows/librespot-proxy/patch.cjs');

const packageDir = (() => {
    try {
        return path.dirname(require.resolve('@lox-audioserver/node-librespot/package.json'));
    } catch {
        return null;
    }
})();

describe.skipIf(!packageDir)('librespot proxy patch', () => {
    const read = (name: string) => fs.readFileSync(path.join(packageDir!, name), 'utf8');

    it('applies to the package\'s sources and sets the session proxy', () => {
        const patched = patchLibRs(read('src/lib.rs'));
        expect(patched).toContain('pub proxy: Option<String>');
        expect(patched).toContain('session_config.proxy = Some(');
    });

    it('refuses sources that already have the option, and sources that do not match', () => {
        expect(() => patchLibRs(patchLibRs(read('src/lib.rs')))).toThrow(/already have a proxy option/);
        expect(() => patchLibRs('fn main() {}')).toThrow(/expected/);
    });

    it('adds the url crate to the manifest once', () => {
        const cargo = read('Cargo.toml');
        const patched = patchCargoToml(cargo);
        expect(patched).toMatch(/^url\s*=/m);
        expect(patchCargoToml(patched)).toBe(patched);
    });
});
