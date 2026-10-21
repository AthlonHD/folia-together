import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Row, Segmented, Status, TextField, option, type SettingsGroupDef } from '../../kit';

// src/components/modal/settings/pages/integration/NetworkProxyGroup.tsx
// The 代理服务器 group of the 连接与集成 page (desktop app): the proxy Spotify and YouTube Music go through, which a good part of the
// world cannot reach directly. System / direct / custom address; the setting lives in the main process (electron/networkProxy).

export const NETWORK_PROXY: SettingsGroupDef = {
    id: 'networkProxy',
    titleKey: 'networkProxy.groupTitle',
    electronOnly: true,
};

export const NETWORK_PROXY_OPTIONS = {
    mode: option(NETWORK_PROXY, 'networkProxyMode', 'networkProxy.mode', { electronOnly: true }),
    address: option(NETWORK_PROXY, 'networkProxyAddress', 'networkProxy.address', { electronOnly: true }),
    test: option(NETWORK_PROXY, 'networkProxyTest', 'networkProxy.test', { electronOnly: true }),
};

const O = NETWORK_PROXY_OPTIONS;

type Mode = 'system' | 'direct' | 'custom';
type Notice = { tone: 'ok' | 'error'; text: string } | null;
type Probe = Awaited<ReturnType<NonNullable<NonNullable<typeof window.electron>['testNetworkProxy']>>>;

const NetworkProxyGroup: React.FC = () => {
    const { t } = useTranslation();
    const electron = window.electron;
    const [mode, setMode] = useState<Mode>('system');
    const [url, setUrl] = useState('');
    const [notice, setNotice] = useState<Notice>(null);
    const [probe, setProbe] = useState<Probe | 'testing' | null>(null);

    useEffect(() => {
        void electron?.getNetworkProxy?.().then(config => {
            if (!config) return;
            setMode(config.mode);
            setUrl(config.url);
        });
    }, [electron]);

    const errorText = useCallback((error: string) => t(({
        empty: 'networkProxy.errorEmpty',
        scheme: 'networkProxy.errorScheme',
        credentials: 'networkProxy.errorCredentials',
    } as Record<string, string>)[error] ?? 'networkProxy.errorInvalid'), [t]);

    const save = useCallback(async () => {
        const result = await electron?.saveNetworkProxy?.({ mode, url });
        if (!result) return;
        if (!result.ok) {
            setNotice({ tone: 'error', text: errorText(result.error) });
            return;
        }
        setUrl(result.config.url);
        setNotice({ tone: 'ok', text: t('networkProxy.saved') });
    }, [electron, errorText, mode, t, url]);

    const test = useCallback(async () => {
        setProbe('testing');
        // The setting on the page is tried as it stands, saved or not.
        setProbe(await electron?.testNetworkProxy?.({ mode, url }) ?? null);
    }, [electron, mode, url]);

    if (!electron?.getNetworkProxy) return null;

    return (
        <Group def={NETWORK_PROXY} foot={t('networkProxy.foot')}>
            <Row option={O.mode}>
                <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: 'system', label: t('networkProxy.modeSystem') },
                        { value: 'direct', label: t('networkProxy.modeDirect') },
                        { value: 'custom', label: t('networkProxy.modeCustom') },
                    ]}
                />
            </Row>
            {mode === 'custom' && (
                <Row sub option={O.address} hint={t('networkProxy.addressHint')}>
                    <TextField value={url} onChange={setUrl} placeholder="http://127.0.0.1:7890" />
                </Row>
            )}
            <Row
                option={O.test}
                below={(
                    <>
                        {notice && <Status tone={notice.tone}>{notice.text}</Status>}
                        {Array.isArray(probe) && probe.map(item => {
                            const service = t(item.id === 'spotify' ? 'networkProxy.serviceSpotify' : 'networkProxy.serviceYoutubeMusic');
                            return (
                                <Status key={item.id} tone={item.ok ? 'ok' : 'error'}>
                                    {`${item.ok ? t('networkProxy.reachable', { service, ms: item.ms }) : t('networkProxy.unreachable', { service, error: item.error ?? '' })}${item.via ? ` · ${t('networkProxy.route', { route: item.via })}` : ''}`}
                                </Status>
                            );
                        })}
                    </>
                )}
            >
                <Button onClick={() => void save()}>{t('networkProxy.save')}</Button>
                <Button onClick={() => void test()} disabled={probe === 'testing'}>{t(probe === 'testing' ? 'networkProxy.testing' : 'networkProxy.test')}</Button>
            </Row>
        </Group>
    );
};

export default NetworkProxyGroup;
