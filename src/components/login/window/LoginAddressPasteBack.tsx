import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

// src/components/login/window/LoginAddressPasteBack.tsx
// 在浏览器里确认的登录,授权之后浏览器被送回的地址只有服务器接得住(网页版、登录不在服务器上做,例如在手机上):
// 授权页会打不开——把地址栏里的网址粘贴到这里,交给等着的登录。provider 声明了这个能力才会画(canPasteLoginAddress)。

type LoginAddressPasteBackProps = {
    /** 把粘贴的网址交出去;resolve 为 true 表示交给了登录。 */
    onSubmit: (address: string) => Promise<boolean>;
};

const LoginAddressPasteBack: React.FC<LoginAddressPasteBackProps> = ({ onSubmit }) => {
    const { t } = useTranslation();
    const [address, setAddress] = useState('');
    const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

    const submit = async () => {
        const text = address.trim();
        if (!text || state === 'sending') return;
        setState('sending');
        setState(await onSubmit(text).catch(() => false) ? 'sent' : 'failed');
    };

    return (
        <form
            className="mx-6 mb-5 mt-1 space-y-2"
            data-testid="login-address-paste-back"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <div className="text-[11px] opacity-60">{t('login.pasteBackHint')}</div>
            <div className="flex gap-2">
                <input
                    value={address}
                    onChange={(event) => {
                        setAddress(event.target.value);
                        if (state !== 'idle') setState('idle');
                    }}
                    placeholder="http://127.0.0.1:…/login?code=…"
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono outline-none focus:border-white/30"
                    style={{ color: 'var(--text-primary)' }}
                />
                <button
                    type="submit"
                    disabled={!address.trim() || state === 'sending'}
                    className="rounded-lg border border-white/15 px-3 py-2 text-xs transition-colors hover:bg-white/10 disabled:opacity-40"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {t('login.pasteBackConfirm')}
                </button>
            </div>
            {state === 'sent' && <div className="text-[11px] opacity-70">{t('login.pasteBackSent')}</div>}
            {state === 'failed' && <div className="text-[11px]" style={{ color: '#ef4444' }}>{t('login.pasteBackFailed')}</div>}
        </form>
    );
};

export default LoginAddressPasteBack;
