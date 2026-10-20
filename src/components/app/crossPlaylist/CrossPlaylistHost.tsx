import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Cloud, Download, ListPlus, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult } from '../../../types';
import ThemedDialog from '../../shared/ThemedDialog';
import ConfirmDialog from '../../shared/ConfirmDialog';
import TextInputDialog from '../../shared/TextInputDialog';
import CrossPlaylistSyncDialog from './CrossPlaylistSyncDialog';
import { Button } from '../../modal/settings/kit';
import { ArrowLeft } from 'lucide-react';
import { omni } from '../../../services/onlineMusic/omni';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { canHoldInCrossPlaylist, countByProvider, visiblePlaylists, type CrossPlaylist } from './crossPlaylistModel';
import { useCrossPlaylistStore } from './crossPlaylistStore';

// src/components/app/crossPlaylist/CrossPlaylistHost.tsx
// The window of the cross-platform playlists: the list of them, and the songs of one. Opened from the queue panel and from the "+" picker
// (see useCrossPlaylistTargets.ts); mounted once in App.
//
// Playing is the app's own: a playlist is a list of songs the queue already knows how to play, whatever platform each is from. A song
// whose platform says it cannot be played now is shown as such and left out when the playlist is played or queued.

type CrossPlaylistHostProps = {
    isDaylight: boolean;
    /** Plays one song with the playable songs of its playlist as the queue. */
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    onPlayAll: (songs: SongResult[]) => void;
    onAddAllToQueue: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
};

const providerLabel = (providerId: string): string => omni.getProviderLabel(providerId);

const playableSongs = (playlist: CrossPlaylist): { songs: SongResult[]; skipped: number } => {
    const songs = playlist.entries.map(entry => entry.song).filter(song => !isSongUnavailable(song));
    return { songs, skipped: playlist.entries.length - songs.length };
};

const downloadText = (filename: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const ROW_HEIGHT = 'min-h-14';

export const CrossPlaylistHost: React.FC<CrossPlaylistHostProps> = ({ isDaylight, onPlaySong, onPlayAll, onAddAllToQueue }) => {
    const { t } = useTranslation();
    const store = useCrossPlaylistStore(useShallow(state => ({
        isOpen: state.isOpen,
        playlists: state.playlists,
        openPlaylistId: state.openPlaylistId,
        close: state.close,
        openPlaylist: state.openPlaylist,
        create: state.create,
        rename: state.rename,
        remove: state.remove,
        removeEntry: state.removeEntry,
        moveEntry: state.moveEntry,
        exportText: state.exportText,
        importText: state.importText,
    })));
    const playQueue = usePlaybackStore(state => state.playQueue);
    const lists = useMemo(() => visiblePlaylists(store.playlists), [store.playlists]);
    const current = store.openPlaylistId ? lists.find(playlist => playlist.id === store.openPlaylistId) ?? null : null;

    const [creating, setCreating] = useState<null | { songs: SongResult[] }>(null);
    const [renaming, setRenaming] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [syncOpen, setSyncOpen] = useState(false);
    const syncConfig = useCrossPlaylistStore(state => state.syncConfig);
    const syncState = useCrossPlaylistStore(state => state.syncState);

    // A device that has joined a group syncs when the page starts, now and then while the window is open, and when the page is back in view.
    useEffect(() => {
        if (!syncConfig) return;
        const sync = () => { void useCrossPlaylistStore.getState().syncNow().catch(() => {}); };
        void useCrossPlaylistStore.getState().load();
        const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', sync);
        const timer = store.isOpen ? setInterval(sync, 60_000) : null;
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', sync);
            if (timer) clearInterval(timer);
        };
    }, [syncConfig, store.isOpen]);

    // The playlist being shown was deleted somewhere else, or never existed: back to the list.
    useEffect(() => {
        if (store.isOpen && store.openPlaylistId && !current) store.openPlaylist(null);
    }, [store, current]);

    if (!store.isOpen) return null;

    const handlePlayAll = (playlist: CrossPlaylist) => {
        const { songs, skipped } = playableSongs(playlist);
        if (songs.length === 0) {
            setStatusMessage({ type: 'info', text: t('crossPlaylist.nothingPlayable') });
            return;
        }
        if (skipped > 0) setStatusMessage({ type: 'info', text: t('crossPlaylist.queuedSome', { count: songs.length, skipped }) });
        onPlayAll(songs);
    };

    const handleAddToQueue = (playlist: CrossPlaylist) => {
        const { songs, skipped } = playableSongs(playlist);
        if (songs.length === 0) {
            setStatusMessage({ type: 'info', text: t('crossPlaylist.nothingPlayable') });
            return;
        }
        onAddAllToQueue(songs, skipped > 0 ? { suppressToast: true } : undefined);
        if (skipped > 0) setStatusMessage({ type: 'info', text: t('crossPlaylist.queuedSome', { count: songs.length, skipped }) });
    };

    const handleImport = async (file: File | undefined) => {
        if (!file) return;
        const result = await store.importText(await file.text());
        setStatusMessage(result.ok
            ? { type: 'success', text: t('crossPlaylist.importDone', { added: result.added, updated: result.updated }) }
            : { type: 'error', text: t('crossPlaylist.importFailed') });
    };

    const handleExport = () => {
        downloadText(`folia-cross-playlists-${new Date().toISOString().slice(0, 10)}.json`, store.exportText());
        setStatusMessage({ type: 'success', text: t('crossPlaylist.exported') });
    };

    const rowButton = 'st-t-fast flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--st-t2)] enabled:hover:bg-[var(--st-fill)] enabled:hover:text-[color:var(--st-t1)] disabled:opacity-30';

    const body = current ? (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
                <Button icon={ArrowLeft} variant="quiet" onClick={() => store.openPlaylist(null)}>{t('crossPlaylist.back')}</Button>
                <Button icon={Play} onClick={() => handlePlayAll(current)} disabled={current.entries.length === 0}>{t('crossPlaylist.playAll')}</Button>
                <Button icon={ListPlus} variant="quiet" onClick={() => handleAddToQueue(current)} disabled={current.entries.length === 0}>{t('crossPlaylist.addToQueue')}</Button>
                <Button variant="quiet" onClick={() => setRenaming(true)}>{t('crossPlaylist.rename')}</Button>
                <Button icon={Trash2} variant="quiet" onClick={() => setConfirmDelete(true)}>{t('crossPlaylist.delete')}</Button>
            </div>
            {current.entries.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[color:var(--st-t3)]">{t('crossPlaylist.listEmpty')}</div>
            ) : (
                <div className="st-card st-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                    {current.entries.map((entry, index) => {
                        const unavailable = isSongUnavailable(entry.song);
                        return (
                            <div key={entry.id} className={`st-row flex ${ROW_HEIGHT} items-center gap-1 pl-4 pr-2 ${unavailable ? 'opacity-55' : ''}`}>
                                <span className="w-7 shrink-0 text-xs tabular-nums text-[color:var(--st-t3)]">{index + 1}</span>
                                <button
                                    type="button"
                                    disabled={unavailable}
                                    onClick={() => onPlaySong(entry.song, playableSongs(current).songs)}
                                    className="st-t-fast min-w-0 flex-1 py-2 text-left enabled:hover:text-[color:var(--st-t1)] disabled:cursor-not-allowed"
                                >
                                    <div className="truncate text-sm leading-5">{entry.song.name}</div>
                                    <div className="truncate text-xs leading-[18px] text-[color:var(--st-t2)]">
                                        {getSongArtistLabel(entry.song, entry.providerId)}
                                        <span className="ml-2 rounded-full border border-current/20 px-1.5 text-[10px] text-[color:var(--st-t3)]">{providerLabel(entry.providerId)}</span>
                                        {unavailable && <span className="ml-2 text-[color:var(--st-t3)]">{t('crossPlaylist.unavailable')}</span>}
                                    </div>
                                </button>
                                <button type="button" className={rowButton} title={t('crossPlaylist.moveUp')} aria-label={t('crossPlaylist.moveUp')} disabled={index === 0} onClick={() => void store.moveEntry(current.id, entry.id, index - 1)}><ChevronUp size={16} /></button>
                                <button type="button" className={rowButton} title={t('crossPlaylist.moveDown')} aria-label={t('crossPlaylist.moveDown')} disabled={index === current.entries.length - 1} onClick={() => void store.moveEntry(current.id, entry.id, index + 1)}><ChevronDown size={16} /></button>
                                <button type="button" className={rowButton} title={t('crossPlaylist.remove')} aria-label={t('crossPlaylist.remove')} onClick={() => void store.removeEntry(current.id, entry.id)}><X size={16} /></button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    ) : (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
                <Button icon={Plus} onClick={() => setCreating({ songs: [] })}>{t('crossPlaylist.create')}</Button>
                <Button
                    variant="quiet"
                    onClick={() => {
                        const songs = playQueue.filter(canHoldInCrossPlaylist);
                        if (songs.length === 0) {
                            setStatusMessage({ type: 'info', text: t('crossPlaylist.queueEmpty') });
                            return;
                        }
                        setCreating({ songs });
                    }}
                >
                    {t('crossPlaylist.saveQueue')}
                </Button>
                <span className="flex-1" />
                <Button icon={Cloud} variant="quiet" onClick={() => setSyncOpen(true)}>
                    {syncConfig ? (syncState === 'error' ? `${t('crossPlaylist.sync')} ⚠` : `${t('crossPlaylist.sync')} ✓`) : t('crossPlaylist.sync')}
                </Button>
                <Button icon={Download} variant="quiet" onClick={handleExport} disabled={lists.length === 0}>{t('crossPlaylist.export')}</Button>
                <Button icon={Upload} variant="quiet" onClick={() => importInputRef.current?.click()}>{t('crossPlaylist.import')}</Button>
                <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={event => { void handleImport(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
            {lists.length === 0 ? (
                <div className="py-10 text-center">
                    <div className="text-[13px] text-[color:var(--st-t2)]">{t('crossPlaylist.empty')}</div>
                    <div className="mt-1 text-xs text-[color:var(--st-t3)]">{t('crossPlaylist.emptyHint')}</div>
                </div>
            ) : (
                <div className="st-card st-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                    {lists.map(playlist => (
                        <button
                            key={playlist.id}
                            type="button"
                            onClick={() => store.openPlaylist(playlist.id)}
                            className="st-row st-focus-inside st-t-fast flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--st-fill)]"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm leading-5">{playlist.name}</div>
                                <div className="truncate text-xs leading-[18px] text-[color:var(--st-t2)]">
                                    {t('crossPlaylist.songCount', { count: playlist.entries.length })}
                                    {countByProvider(playlist).map(([providerId, count]) => ` · ${providerLabel(providerId)} ${count}`).join('')}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <>
            <ThemedDialog
                isOpen
                onClose={store.close}
                isDaylight={isDaylight}
                title={current ? current.name : t('crossPlaylist.title')}
                description={current ? undefined : t('crossPlaylist.intro')}
                size="l"
                fill
                footerNote={current ? undefined : t('crossPlaylist.storageNote')}
            >
                {body}
            </ThemedDialog>

            <CrossPlaylistSyncDialog isOpen={syncOpen} onClose={() => setSyncOpen(false)} isDaylight={isDaylight} />

            <TextInputDialog
                isOpen={creating !== null}
                onClose={() => setCreating(null)}
                isDaylight={isDaylight}
                title={t('crossPlaylist.createTitle')}
                placeholder={t('crossPlaylist.namePlaceholder')}
                confirmLabel={t('options.save')}
                onConfirm={async (name) => {
                    if (!name.trim()) return;
                    const playlist = await store.create(name, creating?.songs ?? []);
                    setStatusMessage({ type: 'success', text: t('crossPlaylist.created', { name: playlist.name }) });
                    store.openPlaylist(playlist.id);
                }}
            />

            <TextInputDialog
                isOpen={renaming && current !== null}
                onClose={() => setRenaming(false)}
                isDaylight={isDaylight}
                title={t('crossPlaylist.renameTitle')}
                placeholder={t('crossPlaylist.namePlaceholder')}
                initialValue={current?.name ?? ''}
                confirmLabel={t('options.save')}
                onConfirm={async (name) => {
                    if (current) await store.rename(current.id, name);
                }}
            />

            <ConfirmDialog
                isOpen={confirmDelete && current !== null}
                title={t('crossPlaylist.deleteTitle')}
                description={t('crossPlaylist.deleteMessage', { name: current?.name ?? '' })}
                confirmVariant="danger"
                isDaylight={isDaylight}
                onConfirm={() => {
                    setConfirmDelete(false);
                    if (current) void store.remove(current.id);
                }}
                onClose={() => setConfirmDelete(false)}
            />
        </>
    );
};

export default CrossPlaylistHost;
