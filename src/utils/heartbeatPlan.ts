// src/utils/heartbeatPlan.ts
// 心动模式多久插一首推荐:每播放 interval 首「我喜欢的音乐」里的歌,插一首网易云的推荐;
// interval 为 0 时每次切歌都取推荐(推荐歌之后也继续取)。推荐歌播放结束后一定回到歌单里的下一首,
// 不会连续推荐(interval ≥ 1 时)。纯规则,状态由调用方保存。

export const HEARTBEAT_INTERVAL_OPTIONS = [0, 1, 2, 3] as const;
export type HeartbeatInterval = typeof HEARTBEAT_INTERVAL_OPTIONS[number];
export const DEFAULT_HEARTBEAT_INTERVAL: HeartbeatInterval = 1;

export const isHeartbeatInterval = (value: unknown): value is HeartbeatInterval => (
    typeof value === 'number' && (HEARTBEAT_INTERVAL_OPTIONS as readonly number[]).includes(value)
);

export type HeartbeatStep = {
    /** 这次切歌要不要向网易云要一首推荐。 */
    fetchRecommendation: boolean;
    /** 切歌后「自上一首推荐以来播放过的歌单歌曲数」。取到推荐后调用方会把它清零。 */
    songsSinceRecommendation: number;
};

export const planHeartbeatStep = ({
    interval,
    currentIsRecommended,
    songsSinceRecommendation,
}: {
    interval: HeartbeatInterval;
    /** 正在播放的这首是不是心动插进来的推荐歌。 */
    currentIsRecommended: boolean;
    songsSinceRecommendation: number;
}): HeartbeatStep => {
    if (interval === 0) return { fetchRecommendation: true, songsSinceRecommendation };
    // 推荐歌播完就回到歌单里的下一首,它自己不计入「歌单歌曲数」
    if (currentIsRecommended) return { fetchRecommendation: false, songsSinceRecommendation };
    const played = songsSinceRecommendation + 1;
    return { fetchRecommendation: played >= interval, songsSinceRecommendation: played };
};
