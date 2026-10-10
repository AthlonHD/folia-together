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

// ── 自动播放兜底 ─────────────────────────────────────────────────────────────
// 点"下一首"后,新歌的自动播放意图(shouldAutoPlay)要等歌词加载完、各种前置条件都满足才会兑现。
// 歌词请求慢或卡住、某个条件的重渲染没有到来时,新歌的音频早就缓冲好了,却一直没人按下播放:
// 进度不动,按钮停在"暂停",手动点一下才开始。
// 这里盯住这种局面:意图一直挂着、没被谁拦着(没有暂停抑制、没有自动混音的等待),而播放元素已经能播了,
// 持续一小会儿还没播,就主动开始播放(歌词之后到了照常对上时间)。

export const AUTOPLAY_WATCHDOG_AFTER_MS = 3000;

export type AutoplayWatchdogInput = {
    audio: (AudioSample & { error: unknown }) | null;
    /** 播放元素上的 src 就是当前要播的这个源(不是自动混音换牌过程中的另一张牌)。 */
    srcMatches: boolean;
    /** 播放意图还挂着,并且没有被"暂停抑制"或自动混音的等待拦着。 */
    intentPending: boolean;
    source: unknown;
    now: number;
};

export const createAutoplayWatchdog = () => {
    let since: number | null = null;
    let lastSource: unknown = null;

    /** 每个采样周期调用一次;返回 true 表示应主动 play()。 */
    const sample = ({ audio, srcMatches, intentPending, source, now }: AutoplayWatchdogInput): boolean => {
        const stuck = Boolean(
            intentPending
            && audio
            && srcMatches
            && !audio.error
            && audio.paused
            && !audio.ended
            && audio.readyState >= 3,
        );
        if (!stuck || source !== lastSource) {
            lastSource = source;
            since = stuck ? now : null;
            return false;
        }
        since ??= now;
        if (now - since < AUTOPLAY_WATCHDOG_AFTER_MS) return false;
        since = null;
        return true;
    };

    return { sample };
};
