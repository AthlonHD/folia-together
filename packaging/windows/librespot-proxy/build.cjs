'use strict';

// packaging/windows/librespot-proxy/build.cjs
// Builds the Spotify playback component with the proxy option (see patch.cjs) and puts it where the package's own build is, so the app
// (and the installer that packs node_modules) carries it. Windows x64 only: that is the build this Fork ships. Needs Rust with the MSVC
// toolchain; the first build compiles librespot (a minute or two), later ones reuse ./work.
//   npm run build:librespot-proxy

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { patchLibRs, patchCargoToml, PROXY_MARKER } = require('./patch.cjs');

const root = path.resolve(__dirname, '..', '..', '..');
const work = path.join(__dirname, 'work');

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.log('[librespot-proxy] Skipped: the patched build is for Windows x64 only.');
    return 0;
  }
  const packageDir = path.dirname(require.resolve('@lox-audioserver/node-librespot/package.json', { paths: [root] }));
  const prebuilds = path.join(packageDir, 'prebuilds', 'win32-x64-msvc');
  if (!fs.existsSync(prebuilds)) throw new Error(`[librespot-proxy] ${prebuilds} is not there; run npm install first`);

  fs.mkdirSync(path.join(work, 'src'), { recursive: true });
  fs.writeFileSync(path.join(work, 'Cargo.toml'), patchCargoToml(fs.readFileSync(path.join(packageDir, 'Cargo.toml'), 'utf8')));
  fs.copyFileSync(path.join(packageDir, 'Cargo.lock'), path.join(work, 'Cargo.lock'));
  fs.writeFileSync(path.join(work, 'src', 'lib.rs'), patchLibRs(fs.readFileSync(path.join(packageDir, 'src', 'lib.rs'), 'utf8')));
  for (const name of fs.readdirSync(path.join(packageDir, 'src'))) {
    if (name !== 'lib.rs') fs.copyFileSync(path.join(packageDir, 'src', name), path.join(work, 'src', name));
  }

  console.log('[librespot-proxy] Building the Spotify playback component with the proxy option…');
  const build = spawnSync('cargo', ['build', '--release'], { cwd: work, stdio: 'inherit', shell: false });
  if (build.status !== 0) throw new Error(`[librespot-proxy] cargo build failed (${build.status ?? build.error?.message})`);

  const built = path.join(work, 'target', 'release', 'librespot_addon.dll');
  if (!fs.existsSync(built)) throw new Error(`[librespot-proxy] ${built} was not produced`);
  fs.copyFileSync(built, path.join(prebuilds, 'librespot_addon.node'));
  fs.writeFileSync(path.join(prebuilds, PROXY_MARKER), `built from ${require(path.join(packageDir, 'package.json')).version} with a proxy option\n`);
  console.log(`[librespot-proxy] Done: ${path.join(prebuilds, 'librespot_addon.node')}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
