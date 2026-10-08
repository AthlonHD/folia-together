import React, { useEffect, useMemo, useRef } from 'react';
import { List, useListRef } from 'react-window';
import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import SearchResultRow from './SearchResultRow';

// src/components/app/search/SearchResultsList.tsx

type SearchResultsListProps = {
    tracks: UnifiedSong[];
    scrollTop: number;
    isDaylight: boolean;
    onScrollTopChange: (scrollTop: number) => void;
    /** 还能自动加载下一页(有更多、没在加载、没报错)。滚动接近底部或列表不满一屏时触发 onLoadMore。 */
    canAutoLoadMore: boolean;
    onLoadMore: () => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
};

type RowProps = Omit<SearchResultsListProps, 'scrollTop' | 'onScrollTopChange' | 'canAutoLoadMore' | 'onLoadMore'>;

const ROW_HEIGHT_PX = 76;
// 距离底部不足这么多行时提前加载下一页,滚动不会撞到底
const LOAD_MORE_THRESHOLD_ROWS = 5;

const Row = ({ index, style, tracks, ...props }: { index: number; style: React.CSSProperties } & RowProps) => (
    <SearchResultRow track={tracks[index]} style={style} {...props} />
);

const SearchResultsList: React.FC<SearchResultsListProps> = ({
    tracks,
    scrollTop,
    onScrollTopChange,
    canAutoLoadMore,
    onLoadMore,
    ...rowProps
}) => {
    const listRef = useListRef(null);
    const latestScrollTopRef = useRef(scrollTop);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const stableRowProps = useMemo(() => ({ tracks, ...rowProps }), [rowProps, tracks]);

    useEffect(() => {
        const element = listRef.current?.element;
        if (element && Math.abs(element.scrollTop - scrollTop) > 1) {
            element.scrollTop = scrollTop;
        }
        latestScrollTopRef.current = scrollTop;
    }, [listRef, scrollTop, tracks]);

    // 一页结果装不满视口时没有滚动条可滚,这里补一次加载,否则永远到不了触发点
    useEffect(() => {
        const element = listRef.current?.element;
        if (!canAutoLoadMore || !element) return;
        if (element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT_PX * LOAD_MORE_THRESHOLD_ROWS) {
            onLoadMore();
        }
    }, [canAutoLoadMore, listRef, onLoadMore, tracks.length]);

    useEffect(() => () => {
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
        }
        onScrollTopChange(latestScrollTopRef.current);
    }, [onScrollTopChange]);

    return (
        <List
            listRef={listRef}
            rowCount={tracks.length}
            rowHeight={ROW_HEIGHT_PX}
            rowComponent={Row as any}
            rowProps={stableRowProps}
            overscanCount={6}
            className="custom-scrollbar"
            style={{ height: '100%', width: '100%' }}
            onScroll={(event) => {
                latestScrollTopRef.current = event.currentTarget.scrollTop;
                const target = event.currentTarget;
                if (canAutoLoadMore && target.scrollHeight - target.scrollTop - target.clientHeight < ROW_HEIGHT_PX * LOAD_MORE_THRESHOLD_ROWS) {
                    onLoadMore();
                }
                if (commitTimerRef.current) {
                    clearTimeout(commitTimerRef.current);
                }
                commitTimerRef.current = setTimeout(() => {
                    onScrollTopChange(latestScrollTopRef.current);
                }, 120);
            }}
        />
    );
};

export default SearchResultsList;
