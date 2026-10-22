import React from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { songPlatformLabel, useQueueMixesPlatforms } from './songPlatform';

// src/components/shared/SongPlatformBadge.tsx
// 本 Fork:正在播的歌来自哪个平台,和音质标记(AudioQualityBadge)并排。只在队列里混了多个平台(跨平台歌单)时显示。

const SongPlatformBadge: React.FC<{ color?: string; className?: string }> = ({ color, className = '' }) => {
    const song = usePlaybackStore(state => state.currentSong);
    const mixed = useQueueMixesPlatforms();
    const label = mixed ? songPlatformLabel(song) : null;
    if (!label) return null;
    return (
        <span
            data-testid="song-platform-badge"
            className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-px text-[10px] font-medium leading-4 select-none ${className}`}
            style={{ color, borderColor: 'currentColor', opacity: 0.65 }}
        >
            {label}
        </span>
    );
};

export default SongPlatformBadge;
