'use strict';

// packaging/windows/librespot-proxy/patch.cjs
// The Spotify playback component (@lox-audioserver/node-librespot, which wraps librespot) opens its own connections to Spotify and has no
// way to be told to use a proxy: its `createSession` never sets librespot's `SessionConfig.proxy`. Many people cannot reach Spotify without
// one (Spotify's own apps have a proxy setting for the same reason).
//
// This adds one optional field, `proxy` (an `http://host:port` address), to the options of `createSession`, and sets it on the session
// config. librespot then sends its connection through the proxy (a CONNECT tunnel) and its HTTP requests too. Everything else is the
// package as it is; where the field is not given the behaviour is unchanged.
//
// The patch is text replacement on the package's sources and refuses to apply when what it expects is not there (a new version of the
// package), so a changed package breaks the build instead of silently not carrying the proxy.

const OPTIONS_ANCHOR = '    pub cache_size_limit_mb: Option<u32>,\n}\n\n/// Options for streaming a track.';
const OPTIONS_PATCHED = [
  '    pub cache_size_limit_mb: Option<u32>,',
  '    /// An HTTP proxy (`http://host:port`) the connection to Spotify goes through: the connection itself (a CONNECT tunnel) and the',
  '    /// requests it makes. Added by Folia (packaging/windows/librespot-proxy); not in the upstream binding.',
  '    pub proxy: Option<String>,',
  '}',
  '',
  '/// Options for streaming a track.',
].join('\n');

const SESSION_ANCHOR = [
  '    session_config.device_id = device_id.clone();',
  '    if let Some(client_id) = opts.client_id {',
  '        if !client_id.trim().is_empty() {',
  '            session_config.client_id = client_id;',
  '        }',
  '    }',
  '',
  '    let cache = build_audio_cache(opts.cache_dir.as_deref(), opts.cache_size_limit_mb);',
  '    let session = Session::new(session_config, cache);',
].join('\n');
const SESSION_PATCHED = [
  '    session_config.device_id = device_id.clone();',
  '    if let Some(client_id) = opts.client_id {',
  '        if !client_id.trim().is_empty() {',
  '            session_config.client_id = client_id;',
  '        }',
  '    }',
  '    if let Some(proxy) = opts.proxy.as_deref().map(str::trim).filter(|value| !value.is_empty()) {',
  '        session_config.proxy = Some(',
  '            proxy',
  '                .parse::<url::Url>()',
  '                .map_err(|e| Error::from_reason(format!("invalid proxy address: {e}")))?,',
  '        );',
  '    }',
  '',
  '    let cache = build_audio_cache(opts.cache_dir.as_deref(), opts.cache_size_limit_mb);',
  '    let session = Session::new(session_config, cache);',
].join('\n');

const countOf = (text, part) => text.split(part).length - 1;

function replaceOnce(text, anchor, replacement, what) {
  const found = countOf(text, anchor);
  if (found !== 1) {
    throw new Error(`librespot-proxy patch: expected ${what} once in the package's sources, found ${found} times (a new version of @lox-audioserver/node-librespot?)`);
  }
  return text.replace(anchor, () => replacement);
}

/** The package's src/lib.rs with the `proxy` option. */
function patchLibRs(text) {
  if (text.includes('pub proxy: Option<String>')) throw new Error('librespot-proxy patch: the sources already have a proxy option');
  return replaceOnce(replaceOnce(text, OPTIONS_ANCHOR, OPTIONS_PATCHED, 'the options of createSession'), SESSION_ANCHOR, SESSION_PATCHED, 'the creation of the session');
}

/** The package's Cargo.toml with the `url` crate the patched code names (already a dependency of librespot, so the lock file does not move). */
function patchCargoToml(text) {
  if (/^url\s*=/m.test(text)) return text;
  return replaceOnce(text, 'serde_json = "1"\n', 'serde_json = "1"\nurl = "2"\n', 'the serde_json dependency');
}

/** Whether a folder of prebuilds holds the build with the proxy (the build step puts this file next to the addon; the app reads it to say
 * in its log which build it plays with). No leading dot: packaging may leave dot files out. */
const PROXY_MARKER = 'folia-proxy.txt';

module.exports = { patchLibRs, patchCargoToml, PROXY_MARKER };
