import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePassthroughStatusStore } from '../../services/passthrough/passthroughStatusStore';
import { chainDepartures, describeFormats } from '../../services/passthrough/formatChain';

// src/components/shared/PassthroughChainBadge.tsx
// 本 Fork:直通模式下,正在播的歌实际走的链路——输入 → 输出的采样率/位深、独占还是共享、是否逐位一致。
// 悬停提示的文字必须在歌曲不变时保持不变:输出电平约每 0.1 秒更新一次,放进提示会让浏览器的原生气泡不停重置、一闪一闪,所以电平只在设置页「当前链路」里显示。
// 数字来自播放器自己的报告(不是设置里的期望);逐位一致用绿点,有转换/截断/混音用琥珀色点并写明转换用的算法。

const PassthroughChainBadge: React.FC<{ color?: string; className?: string }> = ({ color, className = '' }) => {
    const { t } = useTranslation();
    const chain = usePassthroughStatusStore(state => state.chain);
    const engaged = usePassthroughStatusStore(state => state.engaged);
    if (!chain || !engaged) return null;

    const departures = chainDepartures(chain);
    const engine = chain.resampled && chain.resampler ? t(`passthrough.chainResampler${chain.resampler === 'soxr' ? 'Soxr' : 'Rubato'}`) : '';
    const verdict = chain.bitPerfect
        ? t('passthrough.chainBitPerfect')
        : departures.map(key => t(`passthrough.chain${key}`)).join(' / ') + (engine ? ` ${engine}` : '');
    const mode = t(chain.exclusive ? 'passthrough.modeExclusive' : 'passthrough.modeSharedShort');
    const title = `${describeFormats(chain)} · ${chain.deviceName} · ${mode} · ${verdict}`;

    return (
        <span
            data-testid="passthrough-chain-badge"
            title={title}
            className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-px text-[10px] font-medium leading-4 tabular-nums select-none ${className}`}
            style={{ color, borderColor: 'currentColor', opacity: 0.8 }}
        >
            <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: chain.bitPerfect ? '#22c55e' : '#f59e0b' }} />
            <span className="truncate">{describeFormats(chain, false).replace(' → ', '→')} · {mode} · {verdict}</span>
        </span>
    );
};

export default PassthroughChainBadge;
