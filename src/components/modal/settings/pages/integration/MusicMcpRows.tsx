import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, CopyValue, Reveal, Row, Status, Toggle } from '../../kit';
import { O } from './options';

// Displays and configures the desktop's live Music MCP endpoint.
const MusicMcpRows: React.FC = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<MusicMcpStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);

    useEffect(() => {
        let current = true;
        const desktop = window.electron;
        if (desktop) {
            void desktop.getMusicMcpStatus().then(value => {
                if (current) setStatus(value);
            }).catch(() => {
                if (current) setFeedback('failed');
            });
        }
        return () => { current = false; };
    }, []);

    const update = async (setting: 'enabled' | 'write', checked: boolean) => {
        const desktop = window.electron;
        if (!desktop) return;
        setBusy(true);
        setFeedback(null);
        try {
            setStatus(await (setting === 'enabled'
                ? desktop.setMusicMcpEnabled(checked)
                : desktop.setMusicMcpWriteEnabled(checked)));
        } catch {
            setFeedback('failed');
        } finally {
            setBusy(false);
        }
    };
    const copy = async () => {
        try {
            const copied = await window.electron?.copyMusicMcpConfig();
            setFeedback(copied ? 'copied' : 'failed');
        } catch {
            setFeedback('failed');
        }
    };
    const statusKey = status?.running ? 'musicMcpRunning' : status?.error === 'port-in-use'
        ? 'musicMcpPortInUse' : status?.error ? 'musicMcpUnavailable' : 'musicMcpOff';

    return (
        <>
            <Row option={O.musicMcp} hint={t('options.musicMcpHint')}>
                {status && <Status tone={status.running ? 'ok' : status.error ? 'error' : undefined}>{t('options.' + statusKey)}</Status>}
                <Toggle checked={status?.enabled === true} disabled={busy || !status} onChange={checked => void update('enabled', checked)} />
            </Row>
            <Reveal when={status?.enabled === true}>
                <Row sub option={O.musicMcpWrite} hint={t('options.musicMcpWriteHint')}>
                    <Toggle checked={status?.writeEnabled === true} disabled={busy || !status?.running} onChange={checked => void update('write', checked)} />
                </Row>
                {status?.address && (
                    <Row sub label={t('options.musicMcpAddress')}>
                        <CopyValue value={status.address} />
                    </Row>
                )}
                {status?.running && !status.tokenPersistent && (
                    <Row sub notice={<Status tone="warn">{t('options.musicMcpTemporaryToken')}</Status>} />
                )}
                <Row sub label={t('options.musicMcpAgent')} hint={t('options.musicMcpCopyHint')}>
                    <Button icon={Copy} disabled={busy || !status?.running} onClick={() => void copy()}>
                        {t('options.musicMcpCopyConfig')}
                    </Button>
                </Row>
            </Reveal>
            {feedback && (
                <Row sub notice={(
                    <span role="status">
                        <Status tone={feedback === 'copied' ? 'ok' : 'error'}>
                            {t(feedback === 'copied' ? 'options.musicMcpCopied' : 'options.musicMcpActionFailed')}
                        </Status>
                    </span>
                )} />
            )}
        </>
    );
};

export default MusicMcpRows;
