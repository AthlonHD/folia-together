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

// The audio key alone. librespot's `resolveAudioFileAsync` finds the file and its CDN address over HTTPS (its own TLS, rustls) and asks
// the key over the access-point connection. Where that HTTPS fails while the app's own requests to Spotify work (one machine refused
// Spotify's certificate there: UnknownIssuer), the app finds the file and the address itself and asks only the key here.
const TASK_ANCHOR = '/// Session tokens for first-party API access (pathfinder etc.): the login5';
const TASK_ADDED = [
  '/// libuv-threadpool task for `request_audio_key_async` (added by Folia, packaging/windows/librespot-proxy): only the audio key of',
  '/// a file, asked over the access-point connection; the app found the file and its CDN address itself.',
  'pub struct AudioKeyTask {',
  '    session: Session,',
  '    track_id: SpotifyId,',
  '    file_id: FileId,',
  '}',
  '',
  'impl Task for AudioKeyTask {',
  '    type Output = String;',
  '    type JsValue = String;',
  '',
  '    fn compute(&mut self) -> Result<Self::Output> {',
  '        let key = runtime()',
  '            .block_on(self.session.audio_key().request(self.track_id, self.file_id))',
  '            .map_err(|e| Error::from_reason(format!("audio key unavailable: {e:?}")))?;',
  '        Ok(key.0.iter().map(|b| format!("{:02x}", b)).collect::<String>())',
  '    }',
  '',
  '    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {',
  '        Ok(output)',
  '    }',
  '}',
  '',
  TASK_ANCHOR,
].join('\n');

const METHOD_ANCHOR = '    /// Mint the first-party session tokens (login5 bearer + client-token) for';
const METHOD_ADDED = [
  '    /// Only the audio key of a file (added by Folia): `uri` names the playable track (the alternative when relinked), `file_id_hex`',
  '    /// its file (40 hex characters). Asked over the access-point connection.',
  '    #[napi(ts_return_type = "Promise<string>")]',
  '    pub fn request_audio_key_async(&self, uri: String, file_id_hex: String) -> Result<AsyncTask<AudioKeyTask>> {',
  '        let (_, track_id) = parse_resolve_target(&uri)?;',
  '        let hex = file_id_hex.trim();',
  '        if hex.len() != 40 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {',
  '            return Err(Error::from_reason("file id must be 40 hex characters"));',
  '        }',
  '        let raw: Vec<u8> = (0..hex.len())',
  '            .step_by(2)',
  '            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0))',
  '            .collect();',
  '        Ok(AsyncTask::new(AudioKeyTask {',
  '            session: self.session.clone(),',
  '            track_id,',
  '            file_id: FileId::from_raw(&raw),',
  '        }))',
  '    }',
  '',
  METHOD_ANCHOR,
].join('\n');

const countOf = (text, part) => text.split(part).length - 1;

function replaceOnce(text, anchor, replacement, what) {
  const found = countOf(text, anchor);
  if (found !== 1) {
    throw new Error(`librespot-proxy patch: expected ${what} once in the package's sources, found ${found} times (a new version of @lox-audioserver/node-librespot?)`);
  }
  return text.replace(anchor, () => replacement);
}

/** The package's src/lib.rs with the `proxy` option and `requestAudioKeyAsync`. */
function patchLibRs(text) {
  if (text.includes('pub proxy: Option<String>')) throw new Error('librespot-proxy patch: the sources already have a proxy option');
  let patched = replaceOnce(text, OPTIONS_ANCHOR, OPTIONS_PATCHED, 'the options of createSession');
  patched = replaceOnce(patched, SESSION_ANCHOR, SESSION_PATCHED, 'the creation of the session');
  patched = replaceOnce(patched, TASK_ANCHOR, TASK_ADDED, 'the doc line of the session-token task');
  return replaceOnce(patched, METHOD_ANCHOR, METHOD_ADDED, 'the doc line of getTokens');
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
