#!/usr/bin/env node
// Build the Windows pass-through audio helper (WASAPI exclusive player used by the desktop client's pass-through mode).
//
// Builds the Rust crate in packaging/windows/audio-helper/ with `cargo build --release` and copies
// folia-audio-helper.exe into build/ so electron-builder's win extraResources packages it as
// resources/folia-audio-helper.exe. Its output doubles as the dev-path override for
// FOLIA_AUDIO_HELPER_PATH (see electron/audioHelper/audioHelperIpc.cjs). No-op on non-Windows hosts.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_DIR = path.join(ROOT, 'packaging', 'windows', 'audio-helper');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_BIN = path.join(OUT_DIR, 'folia-audio-helper.exe');

if (process.platform !== 'win32') {
  console.log('[audio-helper] non-Windows host, skipping build');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
execFileSync('cargo', ['build', '--release'], { stdio: 'inherit', cwd: SRC_DIR });
copyFileSync(path.join(SRC_DIR, 'target', 'release', 'folia-audio-helper.exe'), OUT_BIN);
console.log(`[audio-helper] built ${OUT_BIN}`);
