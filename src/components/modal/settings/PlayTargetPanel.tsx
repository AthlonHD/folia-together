import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getStageToken,
    isStageHostMode,
    isStageRemoteMode,
    saveStageToken,
    switchPlayTarget,
    type PlayTarget,
} from '../../../services/stageMode';

// src/components/modal/settings/PlayTargetPanel.tsx
// "播放位置"设置的内容:
// - 普通页面:选择声音从哪里出(遥控服务器 / 本机播放)。选遥控要先填 Host 的令牌,中继验证通过才切换;
// - Host 页:显示这台服务器的访问令牌和带令牌的访问地址,给要遥控它的人用。

type PlayTargetPanelProps = {
    settingsCardClass: string;
    getAccentOptionStyle: (selected: boolean) => React.CSSProperties;
};

const checkToken = async (token: string): Promise<'ok' | 'invalid' | 'limited' | 'unreachable'> => {
    try {
        const response = await fetch('/stage/auth/check', { headers: { 'X-Stage-Token': token } });
        if (response.ok) return 'ok';
        return response.status === 429 ? 'limited' : 'invalid';
    } catch {
        return 'unreachable';
    }
};

const copyText = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};

const HostTokenCard: React.FC<{ settingsCardClass: string }> = ({ settingsCardClass }) => {
    const { t } = useTranslation();
    const token = getStageToken();
    const [copied, setCopied] = useState<'token' | 'link' | null>(null);
    const link = token ? `${window.location.origin}/?token=${token}` : '';
    const copy = async (kind: 'token' | 'link', text: string) => {
        if (await copyText(text)) {
            setCopied(kind);
            window.setTimeout(() => setCopied(null), 1500);
        }
    };
    const buttonClass = 'rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-white/10';
    return (
        <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
            <div className="text-[11px] opacity-50 max-w-[460px]" style={{ color: 'var(--text-secondary)' }}>
                {t('options.hostTokenDesc')}
            </div>
            {token ? (
                <>
                    <div className="font-mono text-xs break-all select-all rounded-lg px-3 py-2 bg-black/20" style={{ color: 'var(--text-primary)' }}>
                        {token}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={buttonClass} style={{ color: 'var(--text-primary)' }} onClick={() => void copy('token', token)}>
                            {copied === 'token' ? t('options.copied') : t('options.hostTokenCopy')}
                        </button>
                        <button type="button" className={buttonClass} style={{ color: 'var(--text-primary)' }} onClick={() => void copy('link', link)}>
                            {copied === 'link' ? t('options.copied') : t('options.hostTokenCopyLink')}
                        </button>
                    </div>
                    <div className="text-[11px] opacity-50 max-w-[460px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.hostTokenLinkHint')}
                    </div>
                </>
            ) : (
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.hostTokenMissing')}
                </div>
            )}
        </div>
    );
};

const PlayTargetPanel: React.FC<PlayTargetPanelProps> = ({ settingsCardClass, getAccentOptionStyle }) => {
    const { t } = useTranslation();
    const [askingToken, setAskingToken] = useState(false);
    const [tokenDraft, setTokenDraft] = useState(() => getStageToken());
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    if (isStageHostMode()) return <HostTokenCard settingsCardClass={settingsCardClass} />;

    const current: PlayTarget = isStageRemoteMode() ? 'remote' : 'local';

    const chooseTarget = (target: PlayTarget) => {
        if (target === current) return;
        if (target === 'local') {
            switchPlayTarget('local');
            return;
        }
        // 遥控服务器:先填 Host 的令牌
        setAskingToken(true);
        setTokenError(null);
    };

    const confirmToken = async () => {
        const token = tokenDraft.trim();
        if (!token) {
            setTokenError(t('options.playTargetTokenEmpty'));
            return;
        }
        setIsChecking(true);
        setTokenError(null);
        const result = await checkToken(token);
        setIsChecking(false);
        if (result === 'ok') {
            saveStageToken(token);
            switchPlayTarget('remote');
            return;
        }
        setTokenError(t(
            result === 'limited' ? 'options.playTargetTokenLimited'
                : result === 'unreachable' ? 'options.playTargetTokenUnreachable'
                    : 'options.playTargetTokenInvalid',
        ));
    };

    return (
        <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                {t('options.playTargetDesc')}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {([
                    { value: 'remote', label: t('options.playTargetRemote'), desc: t('options.playTargetRemoteDesc') },
                    { value: 'local', label: t('options.playTargetLocal'), desc: t('options.playTargetLocalDesc') },
                ] as Array<{ value: PlayTarget; label: string; desc: string }>).map((option) => {
                    const selected = current === option.value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => chooseTarget(option.value)}
                            className="rounded-xl border px-3 py-3 text-left transition-colors"
                            style={getAccentOptionStyle(selected)}
                        >
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {option.label}
                            </div>
                            <div className="mt-1 text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {option.desc}
                            </div>
                        </button>
                    );
                })}
            </div>
            {askingToken && current === 'local' && (
                <form
                    className="space-y-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void confirmToken();
                    }}
                >
                    <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.playTargetTokenTitle')}
                    </div>
                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.playTargetTokenDesc')}
                    </div>
                    <div className="flex gap-2">
                        <input
                            value={tokenDraft}
                            onChange={(event) => setTokenDraft(event.target.value)}
                            placeholder={t('options.playTargetTokenPlaceholder')}
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                            className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-xs font-mono bg-transparent outline-none"
                            style={{ color: 'var(--text-primary)' }}
                        />
                        <button
                            type="submit"
                            disabled={isChecking}
                            className="rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-white/10 disabled:opacity-50"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {isChecking ? t('options.playTargetTokenChecking') : t('options.playTargetTokenConfirm')}
                        </button>
                    </div>
                    {tokenError && (
                        <div className="text-[11px]" style={{ color: '#ef4444' }}>
                            {tokenError}
                        </div>
                    )}
                </form>
            )}
        </div>
    );
};

export default PlayTargetPanel;
