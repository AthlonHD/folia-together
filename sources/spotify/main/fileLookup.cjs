const { spotifyError } = require('./errors.cjs');

// electron/spotify/fileLookup.cjs
// Finding a track's audio file and its CDN address with the app's own requests to Spotify (the network session of the bridge, so with
// its proxy), for where the playback component cannot make these requests itself: its HTTPS (rustls) refused Spotify's certificate on
// one machine (UnknownIssuer) while the app's own requests worked. The key is then asked of the component alone, over its access-point
// connection (`requestAudioKeyAsync`, packaging/windows/librespot-proxy). What librespot does in `resolveAudioFileAsync`, done here:
// the track's metadata (following a relinked alternative), a file of the asked bitrate, and the CDN address of that file.

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A Spotify id (22 base62 characters) as the 32 hex characters the metadata service names it by. */
function base62ToHex(id) {
  let value = 0n;
  for (const char of String(id)) {
    const digit = BASE62.indexOf(char);
    if (digit < 0) throw spotifyError('invalid-response', 'Invalid Spotify id', String(id));
    value = value * 62n + BigInt(digit);
  }
  return value.toString(16).padStart(32, '0');
}

/** The other way: 32 hex characters as a Spotify id. */
function hexToBase62(hex) {
  let value = BigInt(`0x${hex}`);
  let id = '';
  while (value > 0n) {
    id = BASE62[Number(value % 62n)] + id;
    value /= 62n;
  }
  return id.padStart(22, '0');
}

// The formats librespot prefers for a bitrate (do_resolve_audio_file in node-librespot), in order.
const PREFERRED = Object.freeze({
  96: ['OGG_VORBIS_96', 'MP3_96'],
  160: ['OGG_VORBIS_160', 'MP3_160'],
  320: ['OGG_VORBIS_320', 'MP3_320', 'MP3_256'],
});
const PLAYABLE = /^(OGG_VORBIS|MP3)_/;

/** The file to play among a track's files, as librespot picks it: the preferred formats of the bitrate, else any it can play. */
function pickFile(files, bitrate) {
  const usable = (Array.isArray(files) ? files : []).filter(file => /^[0-9a-f]{40}$/i.test(String(file?.file_id)) && PLAYABLE.test(String(file?.format)));
  for (const format of PREFERRED[bitrate] ?? PREFERRED[320]) {
    const found = usable.find(file => file.format === format);
    if (found) return found;
  }
  return usable[0] ?? null;
}

/**
 * `call(url)` is the bridge's request as the account (JSON answer; `absent` for a 404). `find(trackId, bitrate)` resolves to
 * `{ playableId, fileId, format, cdnUrl }`: `playableId` is the track the key is asked for (the alternative when relinked).
 */
function createSpotifyFileLookup({ call, spclientUrl }) {
  const cdnOf = async (fileId) => {
    // The JSON form of the storage resolver (librespot asks the protobuf one at the same path).
    const answer = await call(`${spclientUrl}/storage-resolve/files/audio/interactive/${fileId}?alt=json`, { absent: null });
    const url = Array.isArray(answer?.cdnurl) ? answer.cdnurl.find(entry => typeof entry === 'string' && /^https:\/\//.test(entry)) : null;
    if (!url) throw spotifyError('not-playable', 'Spotify gave no address for the audio', `storage-resolve: ${answer?.result ?? 'no answer'}`);
    return url;
  };

  return {
    async find(trackId, bitrate) {
      const metadata = await call(`${spclientUrl}/metadata/4/track/${base62ToHex(trackId)}?market=from_token`, { absent: null });
      if (!metadata) throw spotifyError('not-playable', 'Spotify has no audio for this track', 'metadata: none');
      // The track itself first, then the alternatives it is relinked to where it has no file of its own.
      for (const item of [metadata, ...(Array.isArray(metadata.alternative) ? metadata.alternative : [])]) {
        const file = pickFile(item?.file, bitrate);
        if (!file) continue;
        const gid = /^[0-9a-f]{32}$/i.test(String(item?.gid)) ? String(item.gid).toLowerCase() : base62ToHex(trackId);
        return { playableId: hexToBase62(gid), fileId: file.file_id.toLowerCase(), format: file.format, cdnUrl: await cdnOf(file.file_id.toLowerCase()) };
      }
      throw spotifyError('not-playable', 'Spotify has no audio for this track', 'metadata: no playable file');
    },
  };
}

module.exports = { base62ToHex, createSpotifyFileLookup, hexToBase62, pickFile };
