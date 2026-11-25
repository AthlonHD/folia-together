// electron/spotify/images.cjs
// Spotify's pictures (covers, artist photos, the pictures of the lists it makes) come from its own image hosts. The page loads a picture
// with its own network, which does not follow the app's proxy setting for Spotify, so where Spotify can only be reached through a proxy
// the pictures stay empty while everything else works. The page asks for them here instead, as `folia-spotify://image/<host>/<path>`,
// and they are fetched with the network session Spotify's own requests use (so with its proxy). Only Spotify's image hosts are served.

const IMAGE_HOST = /(^|\.)(scdn\.co|spotifycdn\.com)$/i;
const IMAGE_ROUTE = 'image';

/** The address a page uses for a Spotify picture, or null where the address is not one of Spotify's image hosts. */
function imageRouteAddress(address, scheme) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' || !IMAGE_HOST.test(url.hostname) || url.port || url.username || url.password) return null;
  return `${scheme}://${IMAGE_ROUTE}/${url.hostname}${url.pathname}${url.search}`;
}

/** Whether the request is for a picture (`folia-spotify://image/...`) and not for audio. */
const isImageRequest = request => {
  try { return new URL(request.url).hostname === IMAGE_ROUTE; } catch { return false; }
};

/**
 * `fetch(url, init)` is the network that reaches Spotify. `handle(request)` answers a request for a picture.
 */
function createSpotifyImages({ fetch, warn = (...args) => console.warn(...args) }) {
  const refuse = status => new Response(null, { status, headers: { 'Access-Control-Allow-Origin': '*' } });
  return {
    async handle(request) {
      if (request.method !== 'GET') return refuse(405);
      let target;
      try {
        const asked = new URL(request.url);
        const [, host, ...rest] = asked.pathname.split('/');
        if (!host || !IMAGE_HOST.test(host)) return refuse(403);
        target = new URL(`https://${host}/${rest.join('/')}${asked.search}`);
        if (target.hostname !== host) return refuse(403);
      } catch {
        return refuse(400);
      }
      try {
        const answer = await fetch(target.href, { method: 'GET', signal: AbortSignal.timeout(20000) });
        const type = answer.headers.get('content-type') ?? '';
        // Only a picture is passed on: whatever else a host might answer is not for the page.
        if (!answer.ok || !/^image\//i.test(type)) return refuse(answer.ok ? 502 : answer.status);
        const headers = { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' };
        const cache = answer.headers.get('cache-control');
        if (cache) headers['Cache-Control'] = cache;
        return new Response(answer.body, { status: 200, headers });
      } catch (error) {
        warn(`[Spotify] A picture could not be fetched from ${target.hostname}: ${error?.name ?? ''} ${error?.message ?? ''}`.slice(0, 200));
        return refuse(502);
      }
    },
  };
}

module.exports = { IMAGE_HOST, IMAGE_ROUTE, createSpotifyImages, imageRouteAddress, isImageRequest };
