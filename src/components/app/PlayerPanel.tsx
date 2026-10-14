import React from 'react';
import UnifiedPanel from '../UnifiedPanel';
import type { PlayerPanelViewModel } from './player-panel/buildPlayerPanelModel';
import { countRender } from '../../dev/renderCount';
import { useIsPhoneLayout } from '../../hooks/useLayoutMode';

// App-level entry for the player side panel backed by a view model.
type PlayerPanelProps = {
    model: PlayerPanelViewModel;
};

const PlayerPanel: React.FC<PlayerPanelProps> = ({ model }) => {
    countRender('PlayerPanel');
    // 手机上没有右缘手柄:面板由底部控制条的"更多"按钮打开
    const isPhoneLayout = useIsPhoneLayout();
    const panelProps = isPhoneLayout
        ? { ...model.panelProps, playback: { ...model.panelProps.playback, hideToggleButton: true } }
        : model.panelProps;
    return <UnifiedPanel {...panelProps} />;
};

// Memoised: see the note in Home.tsx. `playerPanelModel` is the only prop, so this holds exactly
// as long as that memo does.
export default React.memo(PlayerPanel);
