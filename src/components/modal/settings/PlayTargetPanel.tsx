import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getStageToken,
    isStageHostMode,
    isStageRelayAvailable,
    isStageRemoteMode,
    saveStageToken,
    switchPlayTarget,
    type PlayTarget,
} from '../../../services/stageMode';
import { Button, CopyButton, CopyValue, Group, Reveal, Row, Segmented, TextField, option, type SettingsGroupDef, type SettingsOptionDef } from './kit';

// src/components/modal/settings/PlayTargetPanel.tsx
// 「播放位置」设置(本 Fork):
// - 普通页面:选择声音从哪里出(遥控服务器 / 本机播放)。选遥控要先填 Host 的令牌,中继验证通过才切换;
// - Host 页:显示这台服务器的访问令牌和带令牌的访问地址,给要遥控它的人用。
// 只在配置了 Stage 中继时出现(isStageRelayAvailable)。用设置页的 kit(Group / Row)画,与别的页一致。

export const PLAY_TARGET_GROUP: SettingsGroupDef = {
    id: 'playTarget',
    titleKey: 'options.playTarget',
    available: () => isStageRelayAvailable(),
};

const O = {
    target: option(PLAY_TARGET_GROUP, 'playTargetChoice', 'options.playTarget'),
    hostToken: option(PLAY_TARGET_GROUP, 'hostToken', 'options.hostToken'),
};

/** 页面声明的选项(设置搜索与锚点覆盖测试读它);只给出本机能画出的那一种。 */
export const PLAY_TARGET_OPTIONS: SettingsOptionDef[] = [O.target, O.hostToken];

const checkToken = async (token: string): Promise<'ok' | 'invalid' | 'limited' | 'unreachable'> => {
    try {
        const response = await fetch('/stage/auth/check', { headers: { 'X-Stage-Token': token } });
        if (response.ok) return 'ok';
        return response.status === 429 ? 'limited' : 'invalid';
    } catch {
        return 'unreachable';
    }
};

const HostTokenRows: React.FC = () => {
    const { t } = useTranslation();
    const token = getStageToken();
    const link = token ? `${window.location.origin}/?token=${token}` : '';
    return (
        <>
            <Row option={O.hostToken} hint={t('options.hostTokenDesc')}>
                {token ? <CopyValue value={token} /> : <span className="text-[13px] text-[color:var(--st-t2)]">{t('options.hostTokenMissing')}</span>}
            </Row>
            {token && (
                <Row label={t('options.hostTokenCopyLink')} hint={t('options.hostTokenLinkHint')}>
                    <CopyButton text={link} />
                </Row>
            )}
        </>
    );
};

const PlayTargetRows: React.FC = () => {
    const { t } = useTranslation();
    const [askingToken, setAskingToken] = useState(false);
    const [tokenDraft, setTokenDraft] = useState(() => getStageToken());
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);
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
        if (isChecking) return;
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
        <>
            <Row option={O.target} note={`${t('options.playTargetRemoteDesc')} ${t('options.playTargetLocalDesc')}`} hint={t('options.playTargetDesc')}>
                <Segmented
                    value={current}
                    options={[
                        { value: 'remote', label: t('options.playTargetRemote') },
                        { value: 'local', label: t('options.playTargetLocal') },
                    ]}
                    onChange={chooseTarget}
                />
            </Row>
            <Reveal when={askingToken && current === 'local'}>
                <Row sub label={t('options.playTargetTokenTitle')} hint={tokenError ?? t('options.playTargetTokenDesc')}>
                    <TextField
                        value={tokenDraft}
                        onChange={setTokenDraft}
                        placeholder={t('options.playTargetTokenPlaceholder')}
                        onCommit={() => void confirmToken()}
                    />
                    <Button variant="primary" disabled={isChecking} onClick={() => void confirmToken()}>
                        {isChecking ? t('options.playTargetTokenChecking') : t('options.playTargetTokenConfirm')}
                    </Button>
                </Row>
            </Reveal>
        </>
    );
};

/** 播放页里的「播放位置」组:没有中继的部署不画。 */
const PlayTargetGroup: React.FC = () => {
    if (!isStageRelayAvailable()) return null;
    return (
        <Group def={PLAY_TARGET_GROUP}>
            {isStageHostMode() ? <HostTokenRows /> : <PlayTargetRows />}
        </Group>
    );
};

export default PlayTargetGroup;
