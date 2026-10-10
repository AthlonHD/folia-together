import { useEffect, useState } from 'react';
import { isStageHostMode } from '../services/stageMode';

// src/hooks/useHostRenderIdle.ts
// Host 页(服务器上真正出声的那一页)通常没人盯着看:画面是遥控端各自显示的。
// 窗口失焦或被遮挡时 Chrome 会降低这个页面的优先级,而可视化器还在满负荷渲染,抢走 CPU,
// 音频解码就会被饿到"卡一秒、卡一秒"。窗口没有焦点时让 Host 页停止渲染画面,只管出声;
// 点一下窗口(或用 RustDesk 点进去)就立刻恢复。网址带 ?hostrender=1 可以让它始终渲染。

const readIdle = (): boolean => (
    typeof document !== 'undefined' && (document.hidden || !document.hasFocus())
);

export const useHostRenderIdle = (): boolean => {
    const enabled = isStageHostMode() && new URLSearchParams(window.location.search).get('hostrender') !== '1';
    const [idle, setIdle] = useState(() => enabled && readIdle());

    useEffect(() => {
        if (!enabled) return;
        const update = () => setIdle(readIdle());
        update();
        window.addEventListener('focus', update);
        window.addEventListener('blur', update);
        document.addEventListener('visibilitychange', update);
        return () => {
            window.removeEventListener('focus', update);
            window.removeEventListener('blur', update);
            document.removeEventListener('visibilitychange', update);
        };
    }, [enabled]);

    return enabled && idle;
};
