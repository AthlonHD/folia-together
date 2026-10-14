import React from 'react';
import { ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LibraryArtistSurfaceProps } from '../../core/contracts/suite';
import { useArtistResourceState } from '../../core/bindings/useArtistResourceState';
import { useArtistView } from '../../core/bindings/useArtistView';
import { resolveTrackArtistLinks } from '../../core/model/trackLinks';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { PhoneButton, PhoneFilterField, PhoneFrame, PhoneTrackRow } from './PhoneParts';

// src/library/suites/phone/PhoneArtistSurface.tsx
// 手机版歌手页:头部(头像、简介)、热门歌曲列表、专辑网格(两列),全部来自与网格 / TUI 相同的歌手资源与视图。

const PhoneArtistSurface: React.FC<LibraryArtistSurfaceProps> = ({
    collection,
    resource,
    playback,
    theme,
    isDaylight,
    onDone,
    onOpenAlbum,
    onOpenArtist,
    onEditEntity,
    declaredActions,
}) => {
    const { t } = useTranslation();
    const { snapshot } = useArtistResourceState(resource);
    const view = useArtistView({
        collection,
        resource,
        snapshot,
        playback,
        declaredActions,
        onEditEntity,
        onOpenAlbum,
        setStatus: setStatusMessage,
    });
    const accent = theme.accentColor || '#3b82f6';
    const detail = snapshot?.detail;
    const status = snapshot?.status ?? 'loading';
    const canOpenArtist = declaredActions.actions.includes('open-artist');

    return (
        <PhoneFrame
            title={detail?.name ?? collection.name}
            isDaylight={isDaylight}
            onBack={onDone}
            backLabel={t('libraryTui.phoneBack')}
        >
            {detail ? (
                <div className="flex items-center gap-4 pb-3">
                    {detail.coverUrl ? <img src={detail.coverUrl} alt="" className="w-20 h-20 rounded-full object-cover shrink-0" /> : null}
                    <div className="min-w-0 text-xs line-clamp-4" style={{ color: 'var(--text-secondary)' }}>{detail.description}</div>
                </div>
            ) : null}

            <div className="flex gap-2 pb-3 flex-wrap">
                <PhoneButton primary accent={accent} isDaylight={isDaylight} disabled={!view.offers('play-scope')} onClick={view.actions.playScope}>
                    <Play size={16} />{t('libraryTui.phonePlayAll')}
                </PhoneButton>
                <PhoneButton accent={accent} isDaylight={isDaylight} disabled={!view.offers('enqueue-scope')} onClick={() => { view.actions.enqueueScope(); }}>
                    <ListPlus size={16} />{t('libraryTui.phoneEnqueueAll')}
                </PhoneButton>
            </div>

            {status === 'error' ? (
                <div className="py-8 text-center text-sm space-y-3" style={{ color: 'var(--text-secondary)' }}>
                    <div>{t('libraryTui.phoneLoadFailed')}</div>
                    <PhoneButton accent={accent} isDaylight={isDaylight} onClick={view.actions.reload}>{t('libraryTui.phoneRetry')}</PhoneButton>
                </div>
            ) : null}
            {status === 'loading' && !detail ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{t('libraryTui.phoneLoading')}</div>
            ) : null}

            {view.topSongs.length > 0 ? (
                <>
                    <div className="text-sm font-semibold pt-2 pb-1">{t('libraryTui.phoneTopSongs')}</div>
                    {view.topSongs.map((song, index) => {
                        const link = canOpenArtist
                            ? resolveTrackArtistLinks(song, canResolveSongCatalogRef).find(item => item.targetId !== undefined)
                            : undefined;
                        return (
                            <PhoneTrackRow
                                key={`${song.id}:${index}`}
                                track={song}
                                index={index}
                                isDaylight={isDaylight}
                                enqueueLabel={t('libraryTui.phoneAddToQueue')}
                                onPlay={() => view.actions.playSong(song)}
                                onEnqueue={() => view.actions.enqueueSong(song)}
                                onOpenArtist={link
                                    ? () => onOpenArtist(link.targetId as string | number, { name: link.artist.name }, song)
                                    : undefined}
                            />
                        );
                    })}
                </>
            ) : null}

            {view.albums.length > 0 ? (
                <>
                    <div className="text-sm font-semibold pt-4 pb-2">{t('libraryTui.phoneAlbums')}</div>
                    <div className="pb-3">
                        <PhoneFilterField value={view.query} onChange={view.setQuery} placeholder={t('libraryTui.phoneFilter')} isDaylight={isDaylight} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {view.shownAlbums.map(album => (
                            <button
                                key={String(album.id)}
                                type="button"
                                onClick={() => view.actions.openAlbum(album)}
                                className="text-left active:opacity-60"
                            >
                                {album.coverUrl ? (
                                    <img src={album.coverUrl} alt="" loading="lazy" className="w-full aspect-square rounded-xl object-cover" />
                                ) : (
                                    <div className="w-full aspect-square rounded-xl" style={{ background: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }} />
                                )}
                                <div className="text-sm font-medium truncate pt-1">{album.name}</div>
                            </button>
                        ))}
                    </div>
                    {snapshot?.albumSync.state === 'interrupted' ? (
                        <div className="py-4 flex justify-center">
                            <PhoneButton accent={accent} isDaylight={isDaylight} onClick={view.actions.retryAlbums}>{t('libraryTui.phoneLoadMore')}</PhoneButton>
                        </div>
                    ) : null}
                </>
            ) : null}
        </PhoneFrame>
    );
};

export default PhoneArtistSurface;
