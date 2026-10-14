import React, { useMemo } from 'react';
import { ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LibraryCollectionSurfaceProps } from '../../core/contracts/suite';
import { collectionKey } from '../../core/model/collectionIdentity';
import { useCollectionResourceState } from '../../core/bindings/useCollectionResourceState';
import { useCollectionView } from '../../core/bindings/useCollectionView';
import { useCollectionActions } from '../../core/bindings/useCollectionActions';
import { useCommittedQuery } from '../../core/bindings/useCommittedQuery';
import { useLibrarySessionQuery } from '../../core/bindings/useLibrarySessionQuery';
import { resolveTrackArtistLinks } from '../../core/model/trackLinks';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { PhoneButton, PhoneFilterField, PhoneFrame, PhoneTrackRow } from './PhoneParts';

// src/library/suites/phone/PhoneCollectionSurface.tsx
// 手机版集合页:一页竖向列表。数据、筛选、播放范围全部来自 Library Core(与网格 / TUI 同一套资源、会话与动作),
// 这里只做触屏上的呈现:顶栏返回、播放全部 / 加入队列、筛选框、可滚动曲目列表、继续加载。
// 点整行播放,右侧「+」入队,歌手名可点开歌手页。

const PhoneCollectionSurface: React.FC<LibraryCollectionSurfaceProps> = ({
    collection,
    resource,
    playback,
    theme,
    isDaylight,
    onDone,
    onOpenArtist,
    declaredActions,
}) => {
    const { t } = useTranslation();
    const sessionKey = collectionKey(collection);
    const { snapshot } = useCollectionResourceState(resource);
    const tracks = useMemo(() => snapshot?.tracks ?? [], [snapshot?.tracks]);
    const { query, setQuery } = useLibrarySessionQuery(sessionKey);
    const committedQuery = useCommittedQuery(query);
    const view = useCollectionView({ tracks, committedQuery });
    const actions = useCollectionActions({ resource, snapshot, view, port: playback, collectionType: collection.type });
    const accent = theme.accentColor || '#3b82f6';
    const canOpenArtist = declaredActions.actions.includes('open-artist');

    const status = snapshot?.status ?? 'loading';
    const sync = snapshot?.sync;
    const matchSet = useMemo(() => (view.matchIndexes ? new Set(view.matchIndexes) : null), [view.matchIndexes]);
    const shownCount = matchSet ? matchSet.size : view.displayTracks.length;
    const playCount = view.contextTracks.length;

    return (
        <PhoneFrame
            title={collection.name}
            subtitle={snapshot ? t('libraryTui.phoneTrackCount', { count: tracks.length }) : undefined}
            isDaylight={isDaylight}
            onBack={onDone}
            backLabel={t('libraryTui.phoneBack')}
        >
            <div className="flex gap-2 pb-3 flex-wrap">
                <PhoneButton primary accent={accent} isDaylight={isDaylight} disabled={playCount === 0} onClick={actions.playScope}>
                    <Play size={16} />
                    {view.isFilterActive ? t('libraryTui.playFilteredTracks', { count: playCount }) : t('libraryTui.phonePlayAll')}
                </PhoneButton>
                <PhoneButton accent={accent} isDaylight={isDaylight} disabled={playCount === 0} onClick={actions.enqueueScope}>
                    <ListPlus size={16} />
                    {t('libraryTui.phoneEnqueueAll')}
                </PhoneButton>
            </div>
            <div className="pb-2">
                <PhoneFilterField value={query} onChange={setQuery} placeholder={t('libraryTui.phoneFilter')} isDaylight={isDaylight} />
            </div>

            {status === 'error' && view.displayTracks.length === 0 ? (
                <div className="py-10 text-center text-sm space-y-3" style={{ color: 'var(--text-secondary)' }}>
                    <div>{t('libraryTui.phoneLoadFailed')}</div>
                    <PhoneButton accent={accent} isDaylight={isDaylight} onClick={actions.reload}>{t('libraryTui.phoneRetry')}</PhoneButton>
                </div>
            ) : null}
            {(status === 'loading' || status === 'idle') && view.displayTracks.length === 0 ? (
                <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{t('libraryTui.phoneLoading')}</div>
            ) : null}
            {status === 'ready' && shownCount === 0 ? (
                <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{t('libraryTui.phoneEmpty')}</div>
            ) : null}

            {view.displayTracks.map((track, index) => {
                if (matchSet && !matchSet.has(index)) return null;
                const key = view.entryKeyAt(index) ?? `${track.id}:${index}`;
                const artistLink = canOpenArtist
                    ? resolveTrackArtistLinks(track, canResolveSongCatalogRef).find(link => link.targetId !== undefined)
                    : undefined;
                return (
                    <PhoneTrackRow
                        key={key}
                        track={track}
                        index={index}
                        isDaylight={isDaylight}
                        enqueueLabel={t('libraryTui.phoneAddToQueue')}
                        onPlay={() => actions.playTrack(track)}
                        onEnqueue={() => actions.enqueueTrack(track)}
                        onOpenArtist={artistLink
                            ? () => onOpenArtist(artistLink.targetId as string | number, { name: artistLink.artist.name }, track)
                            : undefined}
                    />
                );
            })}

            {sync?.status === 'interrupted' ? (
                <div className="py-4 flex justify-center">
                    <PhoneButton accent={accent} isDaylight={isDaylight} onClick={actions.resumeSync}>{t('libraryTui.phoneLoadMore')}</PhoneButton>
                </div>
            ) : null}
            {sync?.status === 'syncing' ? (
                <div className="py-4 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>{t('libraryTui.phoneLoading')}</div>
            ) : null}
        </PhoneFrame>
    );
};

export default PhoneCollectionSurface;
