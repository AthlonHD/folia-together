import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { motion, useTransform } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, Pause, Play, SlidersHorizontal, SkipForward, X } from 'lucide-react';
import ProgressBar from '../ProgressBar';
import AudioQualityBadge from '../shared/AudioQualityBadge';
import SongPlatformBadge from '../shared/SongPlatformBadge';
import { resolvePlayerControlSlot, type PlayerControlSlotContext } from '../floating-player/playerControlSlotActions';
import type FloatingPlayerControls from '../FloatingPlayerControls';
import { PlayerState } from '../../types';
import { selectDisplayCoverUrl, selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { playerBottomBarLiveOffset } from '../../stores/motionSignals';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX } from '../../utils/playerBottomBarLayout';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { useDeviceOrientation } from '../../hooks/useLayoutMode';

// src/components/phone/PhoneChrome.tsx
// 手机布局的播放外壳,替换电脑那套悬停展开的底部胶囊(FloatingPlayerControls):
// - 资料库页面(首页、搜索、歌单……):底部一条迷你播放器,点它回到播放页;
// - 播放页:顶部一个返回键,底部是完整控制条(进度、上一首 / 播放 / 下一首、循环、队列、更多);
// 全部是点按操作,不依赖悬停,点击区域不小于 44px。数据与动作全部来自电脑那套同一份 props,不另起一套逻辑。
//
// 防遮挡:这一层是屏幕底部唯一的常驻元素。它把自己的高度折算成项目已有的全局"底部基线"信号
// (playerBottomBarLiveOffset,字幕、侧面板、账号切换器这些底部元素本来就跟着它走),
// 所以它们会自动抬到 dock 上面,不用各自去避让。

export type PhoneChromeProps = {
    controls: React.ComponentProps<typeof FloatingPlayerControls>;
    /** 播放页顶部的返回键动作。 */
    onBack: () => void;
};

const TAP_TARGET = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-60';
// dock 顶边与字幕之间留的空隙
const DOCK_TO_SUBTITLE_GAP_PX = 16;

const noop = () => undefined;

/** 迷你播放器顶边那条细进度线(只读,不可拖)。 */
const MiniProgressLine: React.FC<{ currentTime: PhoneChromeProps['controls']['currentTime']; duration: number }> = ({ currentTime, duration }) => {
    const width = useTransform(currentTime, time => `${duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0}%`);
    return (
        <div className="pointer-events-none absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full" style={{ width, backgroundColor: 'var(--text-primary)' }} />
        </div>
    );
};

const PhoneChrome: React.FC<PhoneChromeProps> = ({ controls, onBack }) => {
    const { t } = useTranslation();
    const orientation = useDeviceOrientation();
    const dockRef = useRef<HTMLDivElement>(null);
    const coverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const displaySong = usePlaybackStore(selectDisplaySong);
    const isPanelOpen = useAppViewStore(state => state.isPanelOpen);
    const setIsPanelOpen = useAppViewStore(state => state.setIsPanelOpen);
    const {
        currentSong,
        playerState,
        currentTime,
        duration,
        loopMode,
        currentView,
        canTogglePlay = false,
        controlsDisabled = false,
        isDaylight,
        isHidden = false,
        onSeek,
        onTogglePlay,
        onToggleLoop,
        onNavigateToPlayer,
        trackNavigation,
        slotContext,
        lyrics,
        primaryColor = 'var(--text-primary)',
        secondaryColor = 'var(--text-secondary)',
    } = controls;

    const isPlayerView = currentView === 'player';
    const isPlaying = playerState === PlayerState.PLAYING;
    const playDisabled = controlsDisabled || !canTogglePlay;
    const artist = useMemo(() => (displaySong ? getSongArtistLabel(displaySong) : ''), [displaySong]);
    const compactPlayer = isPlayerView && orientation === 'landscape';

    // 槽位动作沿用电脑那套(图标、可用性、高亮都来自同一处)。手机上没有歌词时间轴弹窗,给个空操作。
    const slotCtx: PlayerControlSlotContext = useMemo(() => ({
        ...slotContext,
        loopMode,
        onToggleLoop,
        onPrev: trackNavigation?.onPrev ?? noop,
        onNext: trackNavigation?.onNext ?? noop,
        canPrev: Boolean(trackNavigation?.canPrev),
        canNext: Boolean(trackNavigation?.canNext),
        onToggleTimeline: noop,
        hasLyrics: Boolean(lyrics),
    }), [loopMode, lyrics, onToggleLoop, slotContext, trackNavigation]);
    const loop = resolvePlayerControlSlot('loop', slotCtx);
    const prev = resolvePlayerControlSlot('prev', slotCtx);
    const next = resolvePlayerControlSlot('next', slotCtx);
    const queue = resolvePlayerControlSlot('queue', slotCtx);

    // 把 dock 的高度折算成全局底部基线,底部元素据此抬到 dock 上面。两类元素对基线的算法不同:
    // - 播放页:字幕在基线之上还会再留 80px 净空,所以基线 = dock 顶边 + 间隙 - 80;
    // - 资料库页:右下角的账号切换器等直接贴基线(它们自己的底距是 16px),所以基线 = dock 高度 + 间隙 + 16。
    // 同时把 dock 高度发布成 CSS 变量 --phone-dock-height,整屏的浮层(搜索页等)用它给列表底部留出空位。
    useLayoutEffect(() => {
        const element = dockRef.current;
        const root = document.documentElement;
        if (!element || isHidden) {
            root.style.removeProperty('--phone-dock-height');
            return undefined;
        }
        const apply = () => {
            const dockHeight = Math.ceil(element.getBoundingClientRect().height);
            root.style.setProperty('--phone-dock-height', `${dockHeight}px`);
            const baseline = isPlayerView
                ? dockHeight + DOCK_TO_SUBTITLE_GAP_PX - PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX
                : dockHeight + DOCK_TO_SUBTITLE_GAP_PX + 16;
            playerBottomBarLiveOffset.set(Math.max(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, baseline));
        };
        apply();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
        observer?.observe(element);
        return () => observer?.disconnect();
    }, [isHidden, isPlayerView, compactPlayer]);
    // 手机外壳卸载(切回电脑布局、没有歌曲)时把基线和变量还回去
    useEffect(() => () => {
        playerBottomBarLiveOffset.set(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
        document.documentElement.style.removeProperty('--phone-dock-height');
    }, []);

    const glass = isDaylight
        ? 'bg-white/75 border border-black/5 shadow-lg'
        : 'bg-black/55 border border-white/10 shadow-xl';
    const iconButton = (disabled: boolean) => `${TAP_TARGET} ${disabled ? 'opacity-25' : ''}`;
    const slotButton = (slot: ReturnType<typeof resolvePlayerControlSlot>, disabled = false) => {
        const Icon = slot.icon;
        const off = slot.disabled || disabled || controlsDisabled;
        return (
            <button
                type="button"
                key={slot.labelKey}
                aria-label={t(slot.labelKey)}
                disabled={off}
                onClick={(event) => {
                    event.stopPropagation();
                    slot.onActivate();
                }}
                className={`${iconButton(off)} ${slot.active ? 'bg-white/15' : ''}`}
                style={{ color: primaryColor }}
            >
                <Icon size={20} fill={slot.filled ? 'currentColor' : 'none'} />
            </button>
        );
    };
    const playButton = (size: 'mini' | 'big') => {
        const dimension = size === 'big' ? 'h-14 w-14' : 'h-11 w-11';
        return (
            <button
                type="button"
                aria-label={isPlaying ? t('ui.pause') : t('ui.play')}
                disabled={playDisabled}
                onClick={(event) => {
                    event.stopPropagation();
                    onTogglePlay();
                }}
                className={`${dimension} flex shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 ${playDisabled ? 'opacity-40' : ''}`}
                style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color, #000)' }}
            >
                {isPlaying
                    ? <Pause size={size === 'big' ? 26 : 20} fill="currentColor" />
                    : <Play size={size === 'big' ? 26 : 20} fill="currentColor" className="ml-0.5" />}
            </button>
        );
    };

    if (!currentSong) return null;

    return (
        <>
            {/* 面板打开时它自带返回箭头,这里不再画一个叠在上面 */}
            {isPlayerView && !isPanelOpen && (
                <motion.button
                    type="button"
                    aria-label={t('ui.backToHome')}
                    onClick={onBack}
                    initial={false}
                    animate={{ opacity: isHidden ? 0 : 1, y: isHidden ? -12 : 0 }}
                    className={`fixed z-[55] ${TAP_TARGET} ${glass}`}
                    style={{
                        top: 'calc(var(--safe-top) + 10px)',
                        left: 'calc(var(--safe-left) + 12px)',
                        color: primaryColor,
                        pointerEvents: isHidden ? 'none' : 'auto',
                    }}
                >
                    <ChevronLeft size={22} />
                </motion.button>
            )}

            <motion.div
                ref={dockRef}
                data-phone-dock={isPlayerView ? 'player' : 'mini'}
                initial={false}
                animate={{ opacity: isHidden ? 0 : 1, y: isHidden ? 24 : 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                className="fixed inset-x-0 bottom-0 z-[55] px-3"
                style={{
                    paddingBottom: 'calc(var(--safe-bottom) + 10px)',
                    paddingLeft: 'calc(var(--safe-left) + 12px)',
                    paddingRight: 'calc(var(--safe-right) + 12px)',
                    pointerEvents: isHidden ? 'none' : 'auto',
                }}
            >
                {isPlayerView ? (
                    <div className={`${glass} rounded-3xl backdrop-blur-xl ${compactPlayer ? 'px-3 py-2' : 'px-4 pb-3 pt-3'}`}>
                        {!compactPlayer && (
                            <div className="mb-2 flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold" style={{ color: primaryColor }}>{currentSong.name}</div>
                                    {artist && <div className="truncate text-xs" style={{ color: secondaryColor }}>{artist}</div>}
                                    <div className="mt-0.5 flex min-w-0 items-center gap-1"><SongPlatformBadge color={secondaryColor} className="shrink-0" /><AudioQualityBadge color={secondaryColor} /></div>
                                </div>
                                <button
                                    type="button"
                                    aria-label={isPanelOpen ? t('ui.close') : t('ui.phoneMore')}
                                    onClick={() => setIsPanelOpen(!isPanelOpen)}
                                    className={TAP_TARGET}
                                    style={{ color: primaryColor }}
                                >
                                    {isPanelOpen ? <X size={20} /> : <SlidersHorizontal size={20} />}
                                </button>
                            </div>
                        )}
                        <ProgressBar
                            currentTime={currentTime}
                            duration={duration}
                            onSeek={onSeek}
                            primaryColor={primaryColor}
                            secondaryColor={secondaryColor}
                            disabled={controlsDisabled}
                        />
                        <div className="mt-1 flex items-center justify-between">
                            {slotButton(loop)}
                            {slotButton(prev, !trackNavigation?.canPrev)}
                            {playButton(compactPlayer ? 'mini' : 'big')}
                            {slotButton(next, !trackNavigation?.canNext)}
                            {slotButton(queue)}
                            {compactPlayer && (
                                <button
                                    type="button"
                                    aria-label={isPanelOpen ? t('ui.close') : t('ui.phoneMore')}
                                    onClick={() => setIsPanelOpen(!isPanelOpen)}
                                    className={TAP_TARGET}
                                    style={{ color: primaryColor }}
                                >
                                    {isPanelOpen ? <X size={20} /> : <ChevronDown size={20} className="rotate-180" />}
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label={t('ui.backToPlayer')}
                        onClick={onNavigateToPlayer}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') onNavigateToPlayer();
                        }}
                        className={`${glass} relative flex items-center gap-3 rounded-3xl py-2 pl-2 pr-1 backdrop-blur-xl`}
                    >
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-white/10">
                            {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold" style={{ color: primaryColor }}>{currentSong.name}</div>
                            {artist && <div className="truncate text-xs" style={{ color: secondaryColor }}>{artist}</div>}
                        </div>
                        {playButton('mini')}
                        <button
                            type="button"
                            aria-label={t(next.labelKey)}
                            disabled={!trackNavigation?.canNext || controlsDisabled}
                            onClick={(event) => {
                                event.stopPropagation();
                                next.onActivate();
                            }}
                            className={iconButton(!trackNavigation?.canNext || controlsDisabled)}
                            style={{ color: primaryColor }}
                        >
                            <SkipForward size={20} fill="currentColor" />
                        </button>
                        <MiniProgressLine currentTime={currentTime} duration={duration} />
                    </div>
                )}
            </motion.div>
        </>
    );
};

export default PhoneChrome;
