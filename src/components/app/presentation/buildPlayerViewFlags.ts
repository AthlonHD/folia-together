// src/components/app/presentation/buildPlayerViewFlags.ts
import { isStageRemoteMode } from '../../../services/stageRemote';

// Builds top-level player-view booleans used by the shell, overlays, and floating controls.
export const buildPlayerViewFlags = ({
    currentView,
    disableHomeDynamicBackground,
    hidePlayerProgressBar,
    hidePlayerTranslationSubtitle,
    hidePlayerRightPanelButton,
    isNowPlayingControlDisabled,
    activePlaybackContext,
    stageActiveEntryKind,
    audioSrc,
    duration,
}: {
    currentView: string;
    disableHomeDynamicBackground: boolean;
    hidePlayerProgressBar: boolean;
    hidePlayerTranslationSubtitle: boolean;
    hidePlayerRightPanelButton: boolean;
    isNowPlayingControlDisabled: boolean;
    activePlaybackContext: 'main' | 'stage';
    stageActiveEntryKind: string | null;
    audioSrc: string | null;
    duration: number;
}) => {
    const isPlayerView = currentView === 'player';
    return {
        isPlayerView,
        shouldPauseVisualizerBackground: currentView !== 'player' && disableHomeDynamicBackground,
        shouldHidePlayerProgressBar: isPlayerView && hidePlayerProgressBar,
        shouldHidePlayerTranslationSubtitle: isPlayerView && hidePlayerTranslationSubtitle,
        shouldHidePlayerRightPanelButton: isPlayerView && hidePlayerRightPanelButton,
        // 遥控模式本页没有音频源,播放/暂停交给服务器 Host:有曲目在播(镜像来的时长大于 0)就可以点
        canToggleCurrentPlayback: !isNowPlayingControlDisabled && (isStageRemoteMode()
            ? duration > 0
            : Boolean(audioSrc || (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && duration > 0))),
    };
};
