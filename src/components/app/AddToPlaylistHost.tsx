import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { LocalPlaylist, SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import PlaylistSelectionDialog from '../shared/PlaylistSelectionDialog';
import TextInputDialog from '../shared/TextInputDialog';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { omni } from '../../services/onlineMusic/omni';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAddToPlaylistStore } from '../../stores/useAddToPlaylistStore';

// src/components/app/AddToPlaylistHost.tsx
// The playlist picker for the current song, and the "new playlist" prompt behind it.
//
// Lifted out of UnifiedPanel so it is not tied to the player panel being on screen: it answers a
// question about the song, not about the panel, and a command bound to a global shortcut has to be
// able to ask it from anywhere. The star button in the panel now only requests it.
//
// Everything the three sources need to be told apart stays here, in one place, because the answer
// depends on a Navidrome fetch — see the note in useAddToPlaylistStore.

type AddToPlaylistHostProps = {
    isDaylight: boolean;
    /** 列表"+"选中的歌曲加入播放队列(选择框里的"播放队列"项)。 */
    onAddSongToPlayQueue: (song: SongResult) => void;
    localPlaylists: LocalPlaylist[];
    onlinePlaylists: ProviderCollection[];
    onAddCurrentSongToLocalPlaylist: (playlistId: string) => Promise<void>;
    onCreateCurrentLocalPlaylist: (name: string) => Promise<void>;
    onAddCurrentSongToOnlinePlaylist: (playlist: ProviderCollection) => Promise<void>;
    onAddCurrentSongToNavidromePlaylist: (playlistId: string) => Promise<void>;
    onCreateCurrentNavidromePlaylist: (name: string) => Promise<void>;
};

type PlaylistEntry = { id: string; name: string; description?: string };

// 选择框里"播放队列"这一项的保留 id,不会与任何歌单 id 冲突
const PLAY_QUEUE_ENTRY_ID = '__play_queue__';

export const AddToPlaylistHost: React.FC<AddToPlaylistHostProps> = ({
    isDaylight,
    onAddSongToPlayQueue,
    localPlaylists,
    onlinePlaylists,
    onAddCurrentSongToLocalPlaylist,
    onCreateCurrentLocalPlaylist,
    onAddCurrentSongToOnlinePlaylist,
    onAddCurrentSongToNavidromePlaylist,
    onCreateCurrentNavidromePlaylist,
}) => {
    const { t } = useTranslation();
    // The song as the listener sees it, so a blend shows the track that is on screen.
    const displaySong = usePlaybackStore(selectDisplaySong);
    const { isOpen, close, setAvailability, targetSong } = useAddToPlaylistStore(useShallow(state => ({
        isOpen: state.isOpen,
        close: state.close,
        setAvailability: state.setAvailability,
        targetSong: state.targetSong,
    })));
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    // 列表里的"+"会指定一首歌;只在对话框开着(含新建歌单提示)时生效,其余时候仍以当前歌曲为准
    const currentSong = (isOpen || isCreateOpen) && targetSong ? targetSong : displaySong;
    const [navidromePlaylists, setNavidromePlaylists] = useState<PlaylistEntry[]>([]);

    const isStage = Boolean(currentSong && (currentSong as any).isStage === true);
    const isNavidrome = Boolean(currentSong && (currentSong as any).isNavidrome === true);
    const isLocal = Boolean(currentSong && !isNavidrome && (((currentSong as any).isLocal === true) || Boolean((currentSong as any).localRef?.songId)));
    const playbackSourceRef = currentSong ? getPlaybackSourceRef(currentSong) : null;
    const isOnline = playbackSourceRef?.kind === 'online';
    const onlineProviderLabel = playbackSourceRef?.kind === 'online'
        ? omni.getProviderLabel(playbackSourceRef.providerId)
        : '';
    const canAddOnlineSong = Boolean(currentSong && isOnline && omni.canAddSongToPlaylist(currentSong));

    const refreshNavidromePlaylists = useCallback(async () => {
        const { getNavidromeConfig, navidromeApi } = await import('../../services/navidromeService');
        const config = getNavidromeConfig();
        if (!config) {
            setNavidromePlaylists([]);
            return;
        }

        const playlists = await navidromeApi.getPlaylists(config);
        setNavidromePlaylists(playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            description: `${playlist.songCount} ${t('playlist.tracks')}`,
        })));
    }, [t]);

    useEffect(() => {
        if (!isNavidrome) {
            setNavidromePlaylists([]);
            return;
        }

        void refreshNavidromePlaylists();
    }, [currentSong?.id, isNavidrome, refreshNavidromePlaylists]);

    // 由列表"+"指定了歌曲时,选择框首位多一项"播放队列"
    const hasQueueEntry = Boolean(targetSong);

    const availablePlaylists = useMemo<PlaylistEntry[]>(() => {
        if (isLocal) {
            return localPlaylists.map((playlist) => ({
                id: playlist.id,
                name: playlist.name,
                description: `${playlist.songIds.length} ${t('playlist.tracks')}`,
            }));
        }

        if (isOnline) {
            return onlinePlaylists.map((playlist) => ({
                id: String(playlist.id),
                name: playlist.name,
                description: `${playlist.trackCount || 0} ${t('playlist.tracks')}`,
            }));
        }

        if (isNavidrome) {
            return navidromePlaylists;
        }

        return [];
    }, [isLocal, isOnline, isNavidrome, localPlaylists, navidromePlaylists, onlinePlaylists, t]);

    const isApplicable = Boolean(currentSong && !isStage && (isLocal || isOnline || isNavidrome)) || hasQueueEntry;
    // Local and Navidrome can make a playlist on the spot, so having none is not a refusal there.
    const canAdd = (isLocal)
        || (isOnline && canAddOnlineSong && onlinePlaylists.length > 0)
        || (isNavidrome)
        || hasQueueEntry;
    const disabledReason = isOnline && !canAddOnlineSong
        ? t('status.providerPlaylistMutationUnavailable', { provider: onlineProviderLabel })
        : (!canAdd ? t('localMusic.noPlaylistsFound') : undefined);

    // The track can change under an open dialog — a blend lands, the queue advances — and the new
    // one may have nowhere to go. Closing beats leaving a picker up that cannot pick.
    useEffect(() => {
        if (isOpen && !(isApplicable && canAdd)) {
            close();
        }
    }, [canAdd, close, isApplicable, isOpen]);

    // Published rather than recomputed by each consumer: the star button and the command both need
    // this answer, and only one of them can afford to be the thing that fetches it.
    useEffect(() => {
        setAvailability({ isApplicable, canAdd: isApplicable && canAdd, disabledReason });
    }, [canAdd, disabledReason, isApplicable, setAvailability]);

    return (
        <div className="pointer-events-auto">
            <PlaylistSelectionDialog
                isOpen={isOpen}
                onClose={close}
                isDaylight={isDaylight}
                title={t('localMusic.addToPlaylist')}
                description={t('home.playlists') || 'Playlists'}
                playlists={hasQueueEntry
                    ? [{ id: PLAY_QUEUE_ENTRY_ID, name: t('queue.title') }, ...availablePlaylists]
                    : availablePlaylists}
                onSelect={async (playlistId) => {
                    if (playlistId === PLAY_QUEUE_ENTRY_ID && targetSong) {
                        onAddSongToPlayQueue(targetSong);
                        close();
                        return;
                    }

                    if (isLocal) {
                        await onAddCurrentSongToLocalPlaylist(String(playlistId));
                        return;
                    }

                    if (isOnline) {
                        const playlist = onlinePlaylists.find(item => String(item.id) === String(playlistId));
                        if (!playlist) throw new Error('Selected playlist is unavailable');
                        await onAddCurrentSongToOnlinePlaylist(playlist);
                        return;
                    }

                    if (isNavidrome) {
                        await onAddCurrentSongToNavidromePlaylist(String(playlistId));
                        await refreshNavidromePlaylists();
                    }
                }}
                onCreate={(isLocal || isNavidrome) ? () => {
                    close();
                    setIsCreateOpen(true);
                } : undefined}
                createLabel={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
            />

            <TextInputDialog
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                isDaylight={isDaylight}
                title={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
                description={t('localMusic.enterPlaylistName')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('options.save')}
                onConfirm={async (name) => {
                    if (isLocal) {
                        await onCreateCurrentLocalPlaylist(name);
                        return;
                    }

                    if (isNavidrome) {
                        await onCreateCurrentNavidromePlaylist(name);
                        await refreshNavidromePlaylists();
                    }
                }}
            />
        </div>
    );
};

export default AddToPlaylistHost;
