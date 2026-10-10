import { PlayerState } from '../types';

// src/utils/playerStateReconciler.ts
// 界面上的播放/暂停状态偶尔会和真实的 <audio> 脱节:播放其实已经开始(声音在走、进度在前进),
// 但状态一直停在 PAUSED/IDLE,按钮还显示"暂停中"。常见成因是 play() 返回前播放源被换过
// (缓存换成 blob、过期链接刷新),恢复播放的那条路径发现"已经不是同一个源"就放弃设置状态,
// 而 audio 的 play 事件又因为不是当前这一组播放元素被忽略。
// 这里做最后一道校正:连续几次采样都确认播放元素在持续前进,而界面状态不是播放中,就把状态纠正为播放中。
// 状态是 PLAYING 但没在出声(缓冲、被拦截)不动:那种情况显示"播放中"是各自路径自己的决定。

export const RECONCILE_INTERVAL_MS = 500;
// 连续这么多次采样都在前进才校正:暂停淡出(几百毫秒)期间声音还在走,不能被当成脱节
const REQUIRED_ADVANCING_SAMPLES = 3;
const MIN_ADVANCE_SEC = 0.2;

export type AudioSample = Pick<HTMLMediaElement, 'paused' | 'ended' | 'readyState' | 'currentTime'>;

export const createPlayerStateReconciler = () => {
    let lastTime = -1;
    let lastSource: unknown = null;
    let advancingSamples = 0;

    /** 每个采样周期调用一次;返回 true 表示应把状态纠正为播放中。 */
    const sample = (audio: AudioSample | null, source: unknown, state: PlayerState): boolean => {
        const advancing = Boolean(
            audio
            && !audio.paused
            && !audio.ended
            && audio.readyState >= 3
            && source === lastSource
            && audio.currentTime > lastTime + MIN_ADVANCE_SEC,
        );
        lastSource = source;
        lastTime = audio ? audio.currentTime : -1;
        advancingSamples = advancing ? advancingSamples + 1 : 0;

        if (state === PlayerState.PLAYING) {
            advancingSamples = 0;
            return false;
        }
        if (advancingSamples < REQUIRED_ADVANCING_SAMPLES) return false;
        advancingSamples = 0;
        return true;
    };

    return { sample };
};
