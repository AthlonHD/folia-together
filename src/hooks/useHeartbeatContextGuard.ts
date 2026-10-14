import { useEffect } from 'react';
import { registerHeartbeatAvailabilityResolver } from '../stores/useAudioSettingsStore';
import { getHeartbeatAvailable } from '../utils/heartbeatAvailability';

// src/hooks/useHeartbeatContextGuard.ts
// 把「此刻能不能用心动」告诉音频设置 store(循环按钮切到心动前要问它)。
// 放在 hook 里而不是 store 里:store 之间不互相依赖(见 storeContract)。
// 能不能用只看当前这首歌是不是「我喜欢的音乐」里的(见 usePlayQueueContextStore);点歌单里的歌是插队进现有队列,
// 队列里本来就有别的歌,所以不能要求队列全是它的歌。

export const useHeartbeatContextGuard = (): void => {
    useEffect(() => {
        registerHeartbeatAvailabilityResolver(getHeartbeatAvailable);
    }, []);
};
