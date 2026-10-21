// src/services/onlineMusic/spotify/spotifyImageUrl.ts
// The address a page loads a Spotify picture from. In the desktop app the main process fetches it (electron/spotify/images.cjs), with the
// network and the proxy Spotify's other requests use; the page's own network does not follow the proxy setting. Elsewhere (a browser) the
// picture is loaded from its own address, as before.

const IMAGE_HOST = /(^|\.)(scdn\.co|spotifycdn\.com)$/i;
const IMAGE_SCHEME = 'folia-spotify';

const hasDesktopBridge = (): boolean => typeof window !== 'undefined' && typeof window.electron?.spotifyRequest === 'function';

export const spotifyImageUrl = (address: string): string => {
    if (!address || !hasDesktopBridge()) return address;
    try {
        const url = new URL(address);
        if (url.protocol !== 'https:' || !IMAGE_HOST.test(url.hostname) || url.port) return address;
        return `${IMAGE_SCHEME}://image/${url.hostname}${url.pathname}${url.search}`;
    } catch {
        return address;
    }
};
