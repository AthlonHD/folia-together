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
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';

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
    localPlaylists: LocalPlaylist[];
    /** 上游按当前平台给的歌单;本 Fork 改为跟着「这首歌」所属的平台算(见组件里的 playlistsFor),这个值不再使用。 */
    onlinePlaylists?: ProviderCollection[];
    /** 列表"+"选中的歌曲加入播放队列(选择框里的"播放队列"项)。 */
    onAddSongToPlayQueue: (song: SongResult) => void;
    // All six are handed the song the picker is about: the playback store's current song is
    // another one during a blend, and after any change of track under the open dialog.
    onAddCurrentSongToLocalPlaylist: (playlistId: string, song: SongResult) => Promise<void>;
    onCreateCurrentLocalPlaylist: (name: string, song: SongResult) => Promise<void>;
    onAddCurrentSongToOnlinePlaylist: (playlist: ProviderCollection, song: SongResult) => Promise<void>;
    onCreateCurrentOnlinePlaylist: (name: string, song: SongResult) => Promise<void>;
    onAddCurrentSongToNavidromePlaylist: (playlistId: string, song: SongResult) => Promise<void>;
    onCreateCurrentNavidromePlaylist: (name: string, song: SongResult) => Promise<void>;
};

type PlaylistEntry = { id: string; name: string; description?: string };

// 选择框里"播放队列"这一项的保留 id,不会与任何歌单 id 冲突
const PLAY_QUEUE_ENTRY_ID = '__play_queue__';

// What kind of song this is to the picker, and whether its source takes it into a playlist.
const describeSong = (song: SongResult | null, hasOnlinePlaylists: boolean) => {
    const isStage = Boolean(song && (song as any).isStage === true);
    const isNavidrome = Boolean(song && (song as any).isNavidrome === true);
    const isLocal = Boolean(song && !isNavidrome && (((song as any).isLocal === true) || Boolean((song as any).localRef?.songId)));
    const playbackSourceRef = song ? getPlaybackSourceRef(song) : null;
    const isOnline = playbackSourceRef?.kind === 'online';
    const canAddOnlineSong = Boolean(song && isOnline && omni.canAddSongToPlaylist(song));
    const canCreateOnline = Boolean(song && isOnline && omni.canCreatePlaylistForSong(song));
    return {
        isNavidrome, isLocal, isOnline, canAddOnlineSong, canCreateOnline,
        onlineProviderLabel: playbackSourceRef?.kind === 'online' ? omni.getProviderLabel(playbackSourceRef.providerId) : '',
        isApplicable: Boolean(song && !isStage && (isLocal || isOnline || isNavidrome)),
        // Local, Navidrome and some online providers can make a playlist on the spot, so having
        // none is not a refusal there.
        canAdd: isLocal || (isOnline && canAddOnlineSong && (hasOnlinePlaylists || canCreateOnline)) || isNavidrome,
    };
};

export const AddToPlaylistHost: React.FC<AddToPlaylistHostProps> = ({
    isDaylight,
    localPlaylists,
    onAddSongToPlayQueue,
    onAddCurrentSongToLocalPlaylist,
    onCreateCurrentLocalPlaylist,
    onAddCurrentSongToOnlinePlaylist,
    onCreateCurrentOnlinePlaylist,
    onAddCurrentSongToNavidromePlaylist,
    onCreateCurrentNavidromePlaylist,
}) => {
    const { t } = useTranslation();
    // The song as the listener sees it, so a blend shows the track that is on screen. It is what
    // the star button answers for.
    const shownSong = usePlaybackStore(selectDisplaySong);
    const { isOpen, close, setAvailability, targetSong } = useAddToPlaylistStore(useShallow(state => ({
        isOpen: state.isOpen,
        close: state.close,
        setAvailability: state.setAvailability,
        targetSong: state.targetSong,
    })));
    // The song the picker is about: the one that was shown when it came up. The track can change
    // under an open picker (a blend lands, the queue advances), and the picker does not say which
    // song it is for; what it adds is the song the listener asked about.
    const [askedSong, setAskedSong] = useState<SongResult | null>(null);
    // 列表里的"+"会指定一首歌(targetSong),这时问的是它而不是当前播放的歌。
    const songToAsk = targetSong ?? shownSong;
    if (isOpen && !askedSong && songToAsk) {
        setAskedSong(songToAsk);
    } else if (!isOpen && askedSong) {
        setAskedSong(null);
    }
    // The song the "new playlist" prompt is for: the one the picker it came from was about.
    const [createFor, setCreateFor] = useState<SongResult | null>(null);
    const [navidromePlaylists, setNavidromePlaylists] = useState<PlaylistEntry[]>([]);

    // The dialogs are about the song they were asked for, whatever is playing by now.
    const currentSong = createFor ?? (isOpen ? askedSong : null) ?? shownSong;
    // 歌单要跟着"这首歌"所属的平台走(QQ 的歌列 QQ 的歌单,网易云的歌列网易云的歌单),不是跟着当前浏览的平台;
    // 账户缓存变了(登录、歌单刷新)要重算。
    const providerAccounts = useOnlineProviderAccountStore(state => state.accounts);
    const playlistsFor = (song: SongResult | null): ProviderCollection[] => (
        song && getPlaybackSourceRef(song).kind === 'online' ? omni.getPlaylistsForSong(song) : []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const shownPlaylists = useMemo(() => playlistsFor(shownSong), [shownSong, providerAccounts]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const onlinePlaylists = useMemo(() => playlistsFor(currentSong), [currentSong, providerAccounts]);
    // 由列表"+"指定了歌曲时,选择框首位多一项"播放队列"
    const hasQueueEntry = Boolean(targetSong && isOpen);
    const shown = describeSong(shownSong, shownPlaylists.length > 0);
    const { isNavidrome, isLocal, isOnline, canCreateOnline, onlineProviderLabel, canAddOnlineSong, isApplicable: songApplicable, canAdd: songCanAdd } = describeSong(currentSong, onlinePlaylists.length > 0);
    const isApplicable = songApplicable || hasQueueEntry;
    const canAdd = songCanAdd || hasQueueEntry;
    const needsNavidromePlaylists = isNavidrome || shown.isNavidrome;

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
        if (!needsNavidromePlaylists) {
            setNavidromePlaylists([]);
            return;
        }

        void refreshNavidromePlaylists();
    }, [shownSong?.id, needsNavidromePlaylists, refreshNavidromePlaylists]);

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

    const disabledReason = shown.isOnline && !shown.canAddOnlineSong
        ? t('status.providerPlaylistMutationUnavailable', { provider: shown.onlineProviderLabel })
        : (!shown.canAdd ? t('localMusic.noPlaylistsFound') : undefined);

    // A picker asked for a song that has nowhere to go, or whose playlists went under it (the
    // account signed out): closing beats leaving a picker up that cannot pick.
    useEffect(() => {
        if (isOpen && !(isApplicable && canAdd)) {
            close();
        }
    }, [canAdd, close, isApplicable, isOpen]);

    // Published rather than recomputed by each consumer: the star button and the command both need
    // this answer, and only one of them can afford to be the thing that fetches it.
    useEffect(() => {
        setAvailability({ isApplicable: shown.isApplicable, canAdd: shown.isApplicable && shown.canAdd, disabledReason });
    }, [disabledReason, setAvailability, shown.canAdd, shown.isApplicable]);

    return (
        <div className="pointer-events-auto">
            <PlaylistSelectionDialog
                isOpen={isOpen}
                onClose={close}
                isDaylight={isDaylight}
                title={t('localMusic.addToPlaylist')}
                description={isOnline && !canAddOnlineSong
                    ? t('status.providerPlaylistMutationUnavailable', { provider: onlineProviderLabel })
                    : (isOnline && onlineProviderLabel ? `${onlineProviderLabel} · ${t('home.playlists') || 'Playlists'}` : (t('home.playlists') || 'Playlists'))}
                playlists={hasQueueEntry
                    ? [{ id: PLAY_QUEUE_ENTRY_ID, name: t('queue.title') }, ...availablePlaylists]
                    : availablePlaylists}
                onSelect={async (playlistId) => {
                    if (playlistId === PLAY_QUEUE_ENTRY_ID && targetSong) {
                        onAddSongToPlayQueue(targetSong);
                        close();
                        return;
                    }
                    if (!currentSong) throw new Error('Selected playlist is unavailable');
                    if (isLocal) {
                        await onAddCurrentSongToLocalPlaylist(String(playlistId), currentSong);
                        return;
                    }

                    if (isOnline) {
                        const playlist = onlinePlaylists.find(item => String(item.id) === String(playlistId));
                        if (!playlist) throw new Error('Selected playlist is unavailable');
                        await onAddCurrentSongToOnlinePlaylist(playlist, currentSong);
                        return;
                    }

                    if (isNavidrome) {
                        await onAddCurrentSongToNavidromePlaylist(String(playlistId), currentSong);
                        await refreshNavidromePlaylists();
                    }
                }}
                onCreate={(isLocal || isNavidrome || canCreateOnline) ? () => {
                    setCreateFor(currentSong);
                    close();
                } : undefined}
                createLabel={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
            />

            <TextInputDialog
                isOpen={createFor !== null}
                onClose={() => setCreateFor(null)}
                isDaylight={isDaylight}
                title={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
                description={t('localMusic.enterPlaylistName')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('options.save')}
                onConfirm={async (name) => {
                    if (!currentSong) return;
                    if (isLocal) {
                        await onCreateCurrentLocalPlaylist(name, currentSong);
                        return;
                    }

                    if (isOnline) {
                        await onCreateCurrentOnlinePlaylist(name, currentSong);
                        return;
                    }

                    if (isNavidrome) {
                        await onCreateCurrentNavidromePlaylist(name, currentSong);
                        await refreshNavidromePlaylists();
                    }
                }}
            />
        </div>
    );
};

export default AddToPlaylistHost;
