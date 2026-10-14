import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import {
    type SearchSource,
    useSearchNavigationStore,
} from '../../../stores/useSearchNavigationStore';
import SearchResultsList from './SearchResultsList';
import { useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { omni } from '../../../services/onlineMusic/omni';
import { useIsBravaisLibraryActive } from '../../../library/app/bravaisLibraryActive';
import { useIsPhoneLayout } from '../../../hooks/useLayoutMode';
import { isStageRemoteMode, REMOTE_PLAYABLE_PROVIDER_IDS } from '../../../services/stageMode';

// src/components/app/search/SearchWorkspace.tsx

type SearchWorkspaceProps = {
    theme: Theme;
    isDaylight: boolean;
    onClose: () => void;
    onSubmitSearch: (source?: SearchSource) => void;
    onLoadMore: () => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
    /**
     * 渲染前把结果重新套上当前的展示数据（本地曲目的歌手 / 专辑实体）。store 里的结果是提交那一刻的快照，
     * 本地曲库的实体目录在导入后要晚一拍才加载完，那之前搜到的行没有专辑、歌手链接是灰的；
     * 不在这里按当前目录重算，它们会一直停在那个状态，直到重新搜索。
     */
    resolveTrackDisplay?: (track: UnifiedSong) => UnifiedSong;
};

const SearchWorkspace: React.FC<SearchWorkspaceProps> = ({
    theme,
    isDaylight,
    onClose,
    onSubmitSearch,
    onLoadMore,
    onPlayTrack,
    onAddTrackToQueue,
    onOpenArtist,
    onOpenAlbum,
    resolveTrackDisplay,
}) => {
    const { t } = useTranslation();
    const {
        searchQuery,
        searchSourceTab,
        searchResults,
        isSearchOpen,
        isSearching,
        isLoadingMore,
        searchError,
        hasMore,
        scrollTop,
        setSearchQuery,
        setSearchScrollTop,
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        searchSourceTab: state.searchSourceTab,
        searchResults: state.searchResults,
        isSearchOpen: state.isSearchOpen,
        isSearching: state.isSearching,
        isLoadingMore: state.isLoadingMore,
        searchError: state.searchError,
        hasMore: state.hasMore,
        scrollTop: state.scrollTop,
        setSearchQuery: state.setSearchQuery,
        setSearchScrollTop: state.setSearchScrollTop,
    })));
    const results = useMemo(() => {
        const raw = searchResults || [];
        return resolveTrackDisplay ? raw.map(resolveTrackDisplay) : raw;
    }, [resolveTrackDisplay, searchResults]);
    const activeOnlineProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    // 每个可用的在线平台各一个搜索标签(当前平台排第一),而不是只有当前平台:
    // 队列可以跨平台混排,搜歌当然也要能直接在网易云、QQ 音乐之间切换,不必先去切平台。
    const providerRegistryVersion = useSyncExternalStore(omni.subscribeProviders, omni.getProviderRegistryVersion);
    const sources = useMemo<SearchSource[]>(() => {
        const remote = isStageRemoteMode();
        const available = omni.getProviderSummaries()
            .filter(provider => provider.availability.configured !== false)
            .map(provider => provider.providerId)
            .filter(providerId => !remote || REMOTE_PLAYABLE_PROVIDER_IDS.has(providerId));
        const online = [activeOnlineProviderId, ...available.filter(providerId => providerId !== activeOnlineProviderId)];
        return [...online, 'local', 'navidrome'];
        // providerRegistryVersion 只用来在平台列表变化(mod 源增减)时重算
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeOnlineProviderId, providerRegistryVersion]);
    const hasCollection = useCollectionNavigationStore(state => Boolean(state.snapshot?.stack.length));
    // Bravais 的歌手 / 专辑页是半透明的墙,搜索页留在它后面会透出来;Grid 的集合页要靠搜索页做展开动画,不动。
    // 只是看不见、点不到,仍然挂着,所以返回时搜索词、结果和滚动位置都在。
    const isBravais = useIsBravaisLibraryActive();
    const hideBehindCollection = hasCollection && isBravais;
    // 手机上底部有常驻的迷你播放器 / 控制条(PhoneChrome),搜索列表要给它留出位置,免得最后几行被盖住
    const isPhoneLayout = useIsPhoneLayout();

    // 有搜索词却没有结果、也没在搜:补发一次搜索。
    // Bravais 首页的搜索框提交时只是跳到搜索页,不像 Grid 首页那样先发起搜索,
    // 搜索页拿到的就是缓存未命中的空状态——结果一直是空,要切换搜索源再切回来才会真的去搜。
    const submitRef = useRef(onSubmitSearch);
    submitRef.current = onSubmitSearch;
    const autoSubmittedKeyRef = useRef('');
    useEffect(() => {
        if (!isSearchOpen || searchResults !== null) {
            autoSubmittedKeyRef.current = '';
            return;
        }
        const query = searchQuery.trim();
        if (!query || isSearching || searchError) return;
        const key = `${searchSourceTab}:${query}`;
        if (autoSubmittedKeyRef.current === key) return;
        autoSubmittedKeyRef.current = key;
        submitRef.current(searchSourceTab);
    }, [isSearchOpen, isSearching, searchError, searchQuery, searchResults, searchSourceTab]);
    const getSourceLabel = (source: SearchSource) => {
        if (source === 'local') return t('search.sourceLocal');
        if (source === 'navidrome') return t('search.sourceNavidrome');
        return omni.getProviderLabel(source);
    };

    useEffect(() => {
        if (!isSearchOpen || hasCollection) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasCollection, isSearchOpen, onClose]);

    return (
        <AnimatePresence>
            {isSearchOpen && (
                <motion.section
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 28 }}
                    className={`fixed inset-0 flex flex-col overflow-hidden px-3 py-4 sm:px-6 sm:py-6 ${
                        hasCollection ? 'z-[5]' : 'z-50'
                    }${hideBehindCollection ? ' invisible pointer-events-none' : ''}`}
                    style={{
                        color: theme.primaryColor,
                        backgroundColor: isDaylight ? 'rgba(250,250,250,0.96)' : 'rgba(8,8,10,0.94)',
                        backdropFilter: 'blur(24px)',
                        ...(isPhoneLayout ? { paddingBottom: 'calc(max(var(--phone-dock-height, 0px), var(--safe-bottom)) + 12px)', paddingTop: 'calc(var(--safe-top) + 12px)' } : {}),
                    }}
                >
                    <header className="mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-3">
                        <div className="flex items-center gap-3">
                            <form
                                className={`relative flex-1 rounded-2xl border ${
                                    isDaylight ? 'border-black/10 bg-black/[0.04]' : 'border-white/10 bg-white/[0.05]'
                                }`}
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    onSubmitSearch();
                                }}
                            >
                                {isSearching ? (
                                    <Loader2 className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin opacity-50" />
                                ) : (
                                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 opacity-45" />
                                )}
                                <input
                                    value={searchQuery}
                                    onChange={event => setSearchQuery(event.target.value)}
                                    placeholder={t('search.placeholder')}
                                    className="w-full bg-transparent py-3.5 pl-11 pr-4 text-sm outline-none"
                                    autoFocus
                                />
                            </form>
                            <button
                                type="button"
                                onClick={onClose}
                                className={`rounded-full p-3 ${
                                    isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/10 hover:bg-white/15'
                                }`}
                                aria-label={t('ui.backToHome')}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <nav className="flex gap-2 overflow-x-auto pb-1">
                            {sources.map(source => (
                                <button
                                    type="button"
                                    key={source}
                                    onClick={() => {
                                        if (source !== searchSourceTab) {
                                            onSubmitSearch(source);
                                        }
                                    }}
                                    className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                                        source === searchSourceTab
                                            ? 'shadow-sm'
                                            : isDaylight
                                                ? 'bg-black/5 text-black/60 hover:bg-black/10'
                                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                                    }`}
                                    style={source === searchSourceTab ? {
                                        backgroundColor: theme.accentColor,
                                        color: theme.backgroundColor,
                                    } : undefined}
                                >
                                    {getSourceLabel(source)}
                                </button>
                            ))}
                        </nav>
                    </header>

                    <div className="mx-auto mt-3 min-h-0 w-full max-w-5xl flex-1">
                        {isSearching ? (
                            <div className="flex h-full items-center justify-center">
                                <Loader2 className="h-9 w-9 animate-spin opacity-45" />
                            </div>
                        ) : searchError && results.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-3 text-center opacity-65">
                                <AlertCircle size={32} />
                                <p>{t('search.error')}</p>
                                <button
                                    type="button"
                                    onClick={() => onSubmitSearch()}
                                    className="rounded-full border border-current/15 px-4 py-2 text-sm"
                                >
                                    {t('search.retry')}
                                </button>
                            </div>
                        ) : results.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-sm opacity-50">
                                {t('home.noResults')}
                            </div>
                        ) : (
                            // 底部留出悬浮播放条的高度,"加载更多"/重试按钮才不会被它盖住
                            <div className="flex h-full flex-col pb-20">
                                <div className="min-h-0 flex-1">
                                    <SearchResultsList
                                        tracks={results}
                                        canAutoLoadMore={hasMore && !isLoadingMore && !searchError}
                                        onLoadMore={onLoadMore}
                                        scrollTop={scrollTop}
                                        isDaylight={isDaylight}
                                        onScrollTopChange={setSearchScrollTop}
                                        onPlayTrack={onPlayTrack}
                                        onAddTrackToQueue={onAddTrackToQueue}
                                        onOpenArtist={onOpenArtist}
                                        onOpenAlbum={onOpenAlbum}
                                    />
                                </div>
                                {searchError ? (
                                    <div className="flex shrink-0 items-center justify-center gap-3 py-3 text-sm">
                                        <span className="opacity-60">{t('search.error')}</span>
                                        <button
                                            type="button"
                                            disabled={isLoadingMore}
                                            onClick={onLoadMore}
                                            className="rounded-full border border-current/15 px-4 py-2 disabled:opacity-50"
                                        >
                                            {t('search.retry')}
                                        </button>
                                    </div>
                                ) : hasMore && (
                                    <div className="flex shrink-0 justify-center py-3">
                                        <button
                                            type="button"
                                            disabled={isLoadingMore}
                                            onClick={onLoadMore}
                                            className={`rounded-full border px-5 py-2 text-sm disabled:opacity-50 ${
                                                isDaylight
                                                    ? 'border-black/10 bg-black/5 hover:bg-black/10'
                                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                            }`}
                                        >
                                            {isLoadingMore ? t('localMusic.searching') : t('home.loadMore')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </motion.section>
            )}
        </AnimatePresence>
    );
};

export default SearchWorkspace;
