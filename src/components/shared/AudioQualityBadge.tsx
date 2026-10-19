import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { describeDeliveredAudio, isDowngraded, useDeliveredAudio } from '../../services/onlineMusic/deliveredAudio';

// src/components/shared/AudioQualityBadge.tsx
// 本 Fork:正在播的歌,平台实际给的音质(见 services/onlineMusic/deliveredAudio.ts)。
// 平台没说实际音质、或是从缓存里放出来的旧副本时不显示;比你选的低时带 ↓ 并用警示色,提示被降级了。

const AudioQualityBadge: React.FC<{ color?: string; className?: string }> = ({ color, className = '' }) => {
    const { t } = useTranslation();
    const song = usePlaybackStore(state => state.currentSong);
    const delivered = useDeliveredAudio(song);
    if (!delivered) return null;
    const label = describeDeliveredAudio(delivered);
    if (!label) return null;
    const downgraded = isDowngraded(delivered);
    return (
        <span
            data-testid="audio-quality-badge"
            title={t(downgraded ? 'ui.audioQualityDowngraded' : 'ui.audioQualityActual', { actual: label, requested: delivered.requested })}
            className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-px text-[10px] font-medium leading-4 select-none ${className}`}
            style={{ color: downgraded ? '#f59e0b' : color, borderColor: 'currentColor', opacity: downgraded ? 0.95 : 0.65 }}
        >
            {downgraded && <span aria-hidden>↓</span>}
            {label}
        </span>
    );
};

export default AudioQualityBadge;
