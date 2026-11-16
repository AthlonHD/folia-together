const { z } = require('zod');

// Describes the public music tool arguments independently of any platform backend.
const provider = z.string().min(1).max(48);
const id = z.string().min(1).max(256);
const track = z.object({ provider, id });
const collection = z.object({ provider, id, kind: z.enum(['playlist', 'album', 'artist', 'cloud', 'listening_rank']) });
const page = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) };
const argumentMap = z.record(z.string(), z.json());
const tools = [
    ['list_sources', 'List Folia music platforms and their capabilities and account status.', {}],
    ['list_account_collections', 'Read the account collections that Folia has loaded, including platform rankings and other special collections.', { provider, ...page }],
    ['list_playlists', 'Refresh and list playlists for the signed-in platform account.', { provider }],
    ['list_liked_tracks', 'List liked track IDs for the signed-in platform account.', { provider, ...page }],
    ['list_listening_history', 'Read recent listens recorded by Folia for the signed-in platform account.', { provider, ...page }],
    ['search_music', 'Search a platform catalogue.', { provider, query: z.string().trim().min(1).max(300), kind: z.enum(['song', 'playlist', 'album']).default('song'), ...page }],
    ['get_track', 'Read track metadata.', track.shape],
    ['get_lyrics', 'Read lyrics and timing for a track.', track.shape],
    ['get_collection', 'Read playlist, album or artist details.', collection.shape],
    ['list_collection_tracks', 'Read tracks in a playlist or album, or tracks by an artist.', { ...collection.shape, ...page }],
    ['list_artist_albums', 'Read albums by an artist.', { provider, id, ...page }],
    ['get_platform_library', 'Read albums or the cloud library of the signed-in account.', { provider, kind: z.enum(['albums', 'cloud']), ...page }],
    ['get_recommendations', 'Read platform recommendations and recommendation history.', { provider, kind: z.enum(['daily', 'fm', 'history', 'history_tracks', 'explore', 'explore_items', 'preferences', 'styles', 'style_tracks', 'fm_catalog']), id: id.optional() }],
    ['list_platform_api', 'List available platform backend endpoints and the backend version.', { provider }],
    ['describe_platform_api', 'Read access classification for a platform-specific backend endpoint.', { provider, endpoint: id }],
    ['read_platform_api', 'Call an allowlisted read-only platform backend endpoint.', { provider, endpoint: id, params: argumentMap.default({}) }],
    ['match_playlist_tracks', 'Resolve source tracks on a destination platform before creating a native playlist.', { provider, tracks: z.array(track).min(1).max(50) }],
    ['create_playlist', 'Create a native playlist in the signed-in account on the specified platform. Pass target-platform IDs, and retain the request ID for retries.', {
        provider, name: z.string().trim().min(1).max(150), trackIds: z.array(id).min(1).max(100), requestId: id,
    }, true],
    ['create_folia_playlist', 'Create a cross-platform playlist in Folia itself when explicitly requested as the destination.', {
        name: z.string().trim().min(1).max(150), tracks: z.array(track).min(1).max(100), requestId: id,
    }, true],
    ['add_playlist_tracks', 'Append existing target-platform tracks to a native playlist.', { provider, id, trackIds: z.array(id).min(1).max(100), requestId: id }, true],
    ['remove_playlist_tracks', 'Remove specified target-platform tracks from a native playlist.', { provider, id, trackIds: z.array(id).min(1).max(100) }, true],
    ['set_track_like', 'Like or unlike a track on its original platform.', { ...track.shape, liked: z.boolean() }, true],
    ['set_subscription', 'Save or unsave an album or playlist on its platform.', { ...collection.shape, kind: z.enum(['playlist', 'album']), subscribed: z.boolean() }, true],
    ['set_recommendation_preferences', 'Update supported platform recommendation settings.', {
        provider, changes: z.record(z.string(), z.union([z.string().max(256), z.number()])),
    }, true],
    ['set_daily_style', 'Set the tags of a platform recommendation style.', { provider, groupId: id, tagIds: z.array(id).max(50) }, true],
    ['dislike_track', 'Submit negative recommendation feedback for a track where supported.', track.shape, true],
    ['get_playback', 'Read the current song, player state and a page of the Folia queue.', page],
    ['play_track', 'Play a platform track in Folia or append it to the current queue.', { ...track.shape, enqueue: z.boolean().default(false) }, true],
    ['control_playback', 'Control the current Folia player.', {
        action: z.enum(['pause', 'resume', 'next', 'prev', 'seek']),
        positionMs: z.number().int().min(0).max(86_400_000).optional(),
    }, true],
    ['write_platform_api', 'Call an allowlisted platform backend write endpoint.', { provider, endpoint: id, params: argumentMap.default({}) }, true],
];

function registerMusicTools(server, call, enabledWrites) {
    for (const [name, description, inputSchema, writes] of tools) {
        if (writes && !enabledWrites) continue;
        server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: !writes } }, async args => {
            const result = await call(name, args, writes === true);
            const serialized = JSON.stringify(result);
            return {
                content: [{ type: 'text', text: serialized }],
                structuredContent: result,
                isError: typeof result.error === 'string',
            };
        });
    }
}

module.exports = { registerMusicTools };
