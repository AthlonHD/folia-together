import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBuildCommit } from '../../../app/togetherUpdate/buildCommit';
import { Button, Group, Row, Status, TextField, option, type SettingsGroupDef } from '../kit';

// src/components/modal/settings/pages/RemoteServerGroup.tsx
// The 遥控服务器 group of the 播放控制 page (desktop app): the address and access token of a Stage server, and a button that opens that
// server's controller page in a window of its own. The app is only the controller here: it opens no port and cannot be controlled.
// The token stays in the main process; this page only learns whether one is saved.

export const REMOTE_SERVER: SettingsGroupDef = {
    id: 'remoteServer',
    titleKey: 'stageRemote.groupTitle',
    electronOnly: true,
};

export const REMOTE_SERVER_OPTIONS = {
    url: option(REMOTE_SERVER, 'remoteServerUrl', 'stageRemote.url', { electronOnly: true }),
    token: option(REMOTE_SERVER, 'remoteServerToken', 'stageRemote.token', { electronOnly: true }),
    serverVersion: option(REMOTE_SERVER, 'remoteServerVersion', 'stageRemote.serverVersion', { electronOnly: true }),
    open: option(REMOTE_SERVER, 'remoteServerOpen', 'stageRemote.open', { electronOnly: true }),
};

const O = REMOTE_SERVER_OPTIONS;

type Notice = { tone: 'ok' | 'error'; text: string } | null;
type ServerVersion = { state: 'unknown' } | { state: 'known'; commit: string; forkVersion: string } | { state: 'failed' };

const RemoteServerGroup: React.FC = () => {
    const { t } = useTranslation();
    const api = window.electron?.stageRemote;
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [hasToken, setHasToken] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [serverVersion, setServerVersion] = useState<ServerVersion>({ state: 'unknown' });

    const loadServerVersion = useCallback(async () => {
        if (!api) return;
        const result = await api.getServerVersion();
        setServerVersion(result.ok ? { state: 'known', commit: result.commit, forkVersion: result.forkVersion } : { state: 'failed' });
    }, [api]);

    useEffect(() => {
        if (!api) return;
        void api.getConfig().then(config => {
            setUrl(config.url);
            setHasToken(config.hasToken);
            if (config.url) void loadServerVersion();
        });
    }, [api, loadServerVersion]);

    const save = useCallback(async (): Promise<boolean> => {
        if (!api) return false;
        const result = await api.saveConfig({ url, token: token ? token : undefined });
        if (!result.ok) {
            setNotice({ tone: 'error', text: t(result.error === 'empty-url' ? 'stageRemote.emptyUrl' : 'stageRemote.invalidUrl') });
            return false;
        }
        setUrl(result.url);
        setHasToken(result.hasToken);
        setToken('');
        setNotice({ tone: 'ok', text: t('stageRemote.saved') });
        void loadServerVersion();
        return true;
    }, [api, loadServerVersion, t, token, url]);

    const openWindow = useCallback(async () => {
        if (!api) return;
        // What was typed is saved first: opening should not need a separate save click.
        if ((url || token) && !(await save())) return;
        const result = await api.open();
        if (!result.ok) setNotice({ tone: 'error', text: t('stageRemote.notConfigured') });
    }, [api, save, t, token, url]);

    const clearToken = useCallback(async () => {
        if (!api) return;
        const result = await api.saveConfig({ url, token: '' });
        if (result.ok) {
            setHasToken(false);
            setNotice({ tone: 'ok', text: t('stageRemote.tokenCleared') });
        }
    }, [api, t, url]);

    if (!api) return null;

    return (
        <Group def={REMOTE_SERVER} foot={t('stageRemote.foot')}>
            <Row option={O.url} hint={t('stageRemote.urlHint')}>
                <TextField value={url} onChange={setUrl} type="url" placeholder="http://192.168.1.10:3000" />
            </Row>
            <Row option={O.token} hint={hasToken ? t('stageRemote.tokenSaved') : t('stageRemote.tokenHint')}>
                <TextField value={token} onChange={setToken} type="password" placeholder={hasToken ? '••••••••' : ''} />
                {hasToken && <Button onClick={() => void clearToken()}>{t('stageRemote.clearToken')}</Button>}
            </Row>
            {url && (
                <Row option={O.serverVersion} hint={t('stageRemote.serverVersionHint')}>
                    {serverVersion.state === 'known' && (() => {
                        const local = getBuildCommit();
                        const same = serverVersion.commit !== '' && local !== 'dev' && serverVersion.commit === local.slice(0, serverVersion.commit.length);
                        const label = `${serverVersion.forkVersion ? `v${serverVersion.forkVersion} · ` : ''}${serverVersion.commit || '?'}`;
                        return <Status tone={same ? 'ok' : 'warn'}>{same ? t('stageRemote.versionSame', { version: label }) : t('stageRemote.versionDiffers', { server: label, client: local })}</Status>;
                    })()}
                    {serverVersion.state === 'failed' && <Status tone="error">{t('stageRemote.versionFailed')}</Status>}
                    {serverVersion.state === 'unknown' && <Status>{t('stageRemote.versionChecking')}</Status>}
                    <Button onClick={() => void loadServerVersion()}>{t('stageRemote.versionRefresh')}</Button>
                </Row>
            )}
            <Row
                option={O.open}
                hint={t('stageRemote.openHint')}
                below={notice ? <Status tone={notice.tone}>{notice.text}</Status> : undefined}
            >
                <Button onClick={() => void save()} disabled={!url && !token}>{t('stageRemote.save')}</Button>
                <Button variant="primary" onClick={() => void openWindow()}>{t('stageRemote.open')}</Button>
            </Row>
        </Group>
    );
};

export default RemoteServerGroup;
