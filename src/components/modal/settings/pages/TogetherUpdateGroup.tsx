import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBuildCommit } from '../../../app/togetherUpdate/buildCommit';
import { getForkVersion } from '../../../../utils/forkVersion';
import { useTogetherUpdateSettingsStore } from '../../../../stores/useTogetherUpdateSettingsStore';
import { Button, Group, Progress, Row, Status, Toggle, Value, option, type SettingsGroupDef } from '../kit';

// src/components/modal/settings/pages/TogetherUpdateGroup.tsx
// The 本 Fork 更新 group of the 通用 page (desktop app): which build this is, a check against the fork's own release page, and the
// download-and-install of a newer one. The fork's builds do not use the upstream updater (see package.json foliaReleaseChannel).

export const TOGETHER_UPDATE: SettingsGroupDef = {
    id: 'togetherUpdate',
    titleKey: 'togetherUpdate.groupTitle',
    electronOnly: true,
};

export const TOGETHER_UPDATE_OPTIONS = {
    version: option(TOGETHER_UPDATE, 'togetherUpdateVersion', 'togetherUpdate.version', { electronOnly: true }),
    check: option(TOGETHER_UPDATE, 'togetherUpdateCheck', 'togetherUpdate.check', { electronOnly: true }),
    auto: option(TOGETHER_UPDATE, 'togetherUpdateAuto', 'togetherUpdate.autoCheck', { electronOnly: true }),
};

const O = TOGETHER_UPDATE_OPTIONS;

type Phase = 'idle' | 'checking' | 'upToDate' | 'available' | 'none' | 'unknown' | 'downloading' | 'failed';

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

const TogetherUpdateGroup: React.FC = () => {
    const { t } = useTranslation();
    const api = window.electron?.togetherUpdate;
    const autoCheck = useTogetherUpdateSettingsStore(state => state.togetherUpdateAutoCheck);
    const setAutoCheck = useTogetherUpdateSettingsStore(state => state.handleToggleTogetherUpdateAutoCheck);
    const [phase, setPhase] = useState<Phase>('idle');
    const [releaseName, setReleaseName] = useState('');
    const [releaseSize, setReleaseSize] = useState(0);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [error, setError] = useState('');

    useEffect(() => api?.onProgress(setProgress), [api]);

    const check = useCallback(async () => {
        if (!api) return;
        setPhase('checking');
        setError('');
        const result = await api.check(getBuildCommit());
        setReleaseName(result.release?.name ?? '');
        setReleaseSize(result.release?.size ?? 0);
        if (result.error) setError(result.error);
        setPhase(result.status === 'available' ? 'available'
            : result.status === 'up-to-date' ? 'upToDate'
                : result.status === 'none' ? 'none' : 'unknown');
    }, [api]);

    const install = useCallback(async () => {
        if (!api) return;
        setPhase('downloading');
        setProgress({ done: 0, total: releaseSize });
        const result = await api.install();
        // On success the app quits to let the installer run, so this only returns for a failure.
        if (!result.ok) {
            setError(result.error);
            setPhase('failed');
        }
    }, [api, releaseSize]);

    if (!api) return null;

    const forkVersion = getForkVersion();
    const commit = getBuildCommit();
    const total = progress.total || releaseSize;
    const statusLine = {
        idle: null,
        checking: <Status>{t('togetherUpdate.checking')}</Status>,
        upToDate: <Status tone="ok">{t('togetherUpdate.upToDate')}</Status>,
        available: <Status tone="warn">{t('togetherUpdate.available', { name: releaseName })}</Status>,
        none: <Status>{t('togetherUpdate.none')}</Status>,
        unknown: <Status tone="error">{t(commit === 'dev' ? 'togetherUpdate.devBuild' : 'togetherUpdate.unknown', { error })}</Status>,
        downloading: null,
        failed: <Status tone="error">{t('togetherUpdate.failed', { error })}</Status>,
    }[phase];

    return (
        <Group def={TOGETHER_UPDATE} foot={t('togetherUpdate.foot')}>
            <Row option={O.version}>
                <Value>{`${forkVersion ? `v${forkVersion}` : ''} · ${commit}`}</Value>
            </Row>
            <Row
                option={O.check}
                hint={t('togetherUpdate.checkHint')}
                below={phase === 'downloading'
                    ? <Progress value={total ? progress.done / total : 0}>{total ? `${megabytes(progress.done)} / ${megabytes(total)}` : megabytes(progress.done)}</Progress>
                    : statusLine ?? undefined}
            >
                <Button onClick={() => void check()} disabled={phase === 'checking' || phase === 'downloading'}>{t('togetherUpdate.check')}</Button>
                {phase === 'available' && <Button variant="primary" onClick={() => void install()}>{t('togetherUpdate.install')}</Button>}
            </Row>
            <Row option={O.auto} hint={t('togetherUpdate.autoCheckHint')}>
                <Toggle checked={autoCheck} onChange={setAutoCheck} />
            </Row>
        </Group>
    );
};

export default TogetherUpdateGroup;
