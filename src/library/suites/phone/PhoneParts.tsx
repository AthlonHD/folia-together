import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ListPlus, MoreHorizontal, Search, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { getSongArtistLabel, getSongCoverUrl, getSongDurationMs } from '../../../services/onlineMusic/songMetadata';
import { formatTime } from '../../../utils/appPlaybackHelpers';

// src/library/suites/phone/PhoneParts.tsx
// 手机版集合页 / 歌手页共用的零件:整页外框(顶栏 + 滚动区,底部给迷你播放条让位)、曲目行、小按钮。
// 点整行播放,右侧「+」入队;触控目标不小于 44px。颜色走全局文字变量,深浅色由 isDaylight 决定底色。

export const PhoneFrame: React.FC<{
    title: string;
    subtitle?: string;
    isDaylight: boolean;
    onBack: () => void;
    backLabel: string;
    children: React.ReactNode;
}> = ({ title, subtitle, isDaylight, onBack, backLabel, children }) => (
    <div
        className="fixed inset-0 z-50 flex flex-col"
        style={{
            background: isDaylight ? 'rgba(250,250,250,0.97)' : 'rgba(10,10,12,0.97)',
            color: 'var(--text-primary)',
            paddingTop: 'var(--safe-top, 0px)',
            paddingLeft: 'var(--safe-left, 0px)',
            paddingRight: 'var(--safe-right, 0px)',
        }}
        data-phone-surface
    >
        <div className="flex items-center gap-1 px-2 shrink-0" style={{ minHeight: 52 }}>
            <button
                type="button"
                onClick={onBack}
                aria-label={backLabel}
                className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/10"
            >
                <ChevronLeft size={24} />
            </button>
            <div className="min-w-0 flex-1">
                <div className="text-base font-semibold truncate">{title}</div>
                {subtitle ? <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{subtitle}</div> : null}
            </div>
        </div>
        <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3"
            style={{ paddingBottom: 'calc(var(--phone-dock-height, 64px) + var(--safe-bottom, 0px) + 24px)' }}
        >
            {children}
        </div>
    </div>
);

export const PhoneButton: React.FC<{
    onClick: () => void;
    children: React.ReactNode;
    primary?: boolean;
    disabled?: boolean;
    isDaylight: boolean;
    /** 保留给以后按主题强调色染色用;主按钮现在用与底色反差最大的前景 / 背景。 */
    accent?: string;
    /** 只有图标的按钮用:无障碍名字。 */
    label?: string;
}> = ({ onClick, children, primary, disabled, isDaylight, label }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="h-11 px-4 rounded-full text-sm font-medium flex items-center gap-2 disabled:opacity-40"
        style={primary
            ? { background: isDaylight ? '#18181b' : '#f4f4f5', color: isDaylight ? '#fafafa' : '#18181b' }
            : { background: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)', color: 'var(--text-primary)' }}
    >
        {children}
    </button>
);

export const PhoneFilterField: React.FC<{
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    isDaylight: boolean;
}> = ({ value, onChange, placeholder, isDaylight }) => (
    <div
        className="flex items-center gap-2 h-11 px-3 rounded-full"
        style={{ background: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}
    >
        <Search size={16} className="opacity-60 shrink-0" />
        <input
            value={value}
            onChange={event => onChange(event.target.value)}
            placeholder={placeholder}
            enterKeyHint="search"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm"
            style={{ color: 'var(--text-primary)' }}
        />
        {value ? (
            <button type="button" onClick={() => onChange('')} className="w-8 h-8 flex items-center justify-center opacity-60" aria-label="clear">
                <X size={16} />
            </button>
        ) : null}
    </div>
);

export const PhoneTrackRow: React.FC<{
    track: SongResult;
    index: number;
    isDaylight: boolean;
    enqueueLabel: string;
    onPlay: () => void;
    onEnqueue: () => void;
    /** 能解析出歌手目录时,歌手名可点(打开歌手页)。 */
    onOpenArtist?: () => void;
    /** 有更多操作(删除条目、打开专辑……)时给,点「⋯」打开操作面板。 */
    onMore?: () => void;
    moreLabel?: string;
    /** 删除请求还没回来:整行变淡。 */
    pending?: boolean;
}> = ({ track, index, isDaylight, enqueueLabel, onPlay, onEnqueue, onOpenArtist, onMore, moreLabel, pending }) => {
    const unavailable = isSongUnavailable(track);
    const cover = getSongCoverUrl(track) || track.album?.coverUrl;
    const durationMs = getSongDurationMs(track);
    const play = unavailable ? undefined : onPlay;
    const artistLabel = getSongArtistLabel(track);
    return (
        <div
            className="flex items-center gap-3"
            style={{ minHeight: 60, contentVisibility: 'auto', containIntrinsicSize: 'auto 60px', opacity: unavailable ? 0.4 : pending ? 0.5 : 1 }}
        >
            <button type="button" onClick={play} className="shrink-0 active:opacity-60" aria-label={track.name}>
                {cover ? (
                    <img src={cover} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover" />
                ) : (
                    <div
                        className="w-11 h-11 rounded-lg flex items-center justify-center text-xs"
                        style={{ background: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
                    >
                        {index + 1}
                    </div>
                )}
            </button>
            <div className="min-w-0 flex-1">
                <button type="button" onClick={play} className="block w-full text-left text-sm font-medium truncate py-0.5 active:opacity-60">
                    {track.name}
                </button>
                <div className="flex items-center text-xs min-w-0" style={{ color: 'var(--text-secondary)' }}>
                    {onOpenArtist ? (
                        <button type="button" onClick={onOpenArtist} className="truncate text-left py-0.5 underline-offset-2 active:underline">
                            {artistLabel}
                        </button>
                    ) : (
                        <span className="truncate py-0.5">{artistLabel}</span>
                    )}
                    {durationMs ? <span className="shrink-0">{` · ${formatTime(durationMs / 1000)}`}</span> : null}
                </div>
            </div>
            <button
                type="button"
                onClick={unavailable ? undefined : onEnqueue}
                aria-label={enqueueLabel}
                className="w-11 h-11 flex items-center justify-center rounded-full shrink-0 active:bg-white/10"
                style={{ color: 'var(--text-secondary)' }}
            >
                <ListPlus size={20} />
            </button>
            {onMore ? (
                <button
                    type="button"
                    onClick={onMore}
                    aria-label={moreLabel}
                    className="w-9 h-11 -ml-2 flex items-center justify-center rounded-full shrink-0 active:bg-white/10"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    <MoreHorizontal size={20} />
                </button>
            ) : null}
        </div>
    );
};

export type PhoneSheetAction = { key: string; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

/** 底部操作面板:点遮罩或「取消」关闭;选项高度 ≥ 48px,底部让开安全区。 */
export const PhoneSheet: React.FC<{
    title?: string;
    actions: readonly PhoneSheetAction[];
    cancelLabel: string;
    isDaylight: boolean;
    onClose: () => void;
}> = ({ title, actions, cancelLabel, isDaylight, onClose }) => createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" onClick={onClose} data-phone-sheet>
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} />
        <div
            className="relative rounded-t-2xl px-3 pt-3"
            style={{
                background: isDaylight ? '#ffffff' : '#18181b',
                color: 'var(--text-primary)',
                paddingBottom: 'calc(var(--safe-bottom, 0px) + 12px)',
            }}
            onClick={event => event.stopPropagation()}
        >
            {title ? <div className="px-2 pb-2 text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{title}</div> : null}
            {actions.map(action => (
                <button
                    key={action.key}
                    type="button"
                    disabled={action.disabled}
                    onClick={() => { onClose(); action.onSelect(); }}
                    className="w-full h-12 px-2 text-left text-sm rounded-lg active:bg-white/10 disabled:opacity-40"
                    style={action.danger ? { color: '#ef4444' } : undefined}
                >
                    {action.label}
                </button>
            ))}
            <button
                type="button"
                onClick={onClose}
                className="w-full h-12 mt-1 text-sm rounded-lg font-medium"
                style={{ background: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}
            >
                {cancelLabel}
            </button>
        </div>
    </div>,
    document.body,
);
