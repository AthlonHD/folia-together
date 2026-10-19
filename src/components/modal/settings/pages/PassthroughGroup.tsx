import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { chainDepartures, describeChain } from '../../../../services/passthrough/formatChain';
import { usePassthroughStatusStore } from '../../../../services/passthrough/passthroughStatusStore';
import type { PassthroughDevice, PassthroughFormatProbe } from '../../../../services/passthrough/types';
import {
    PASSTHROUGH_FIXED_RATES,
    usePassthroughSettingsStore,
} from '../../../../stores/usePassthroughSettingsStore';
import { runsOnWindows } from '../../../../utils/platform';
import { Button, Group, Reveal, Row, Segmented, Select, Status, Toggle, option, type SettingsGroupDef } from '../kit';

// src/components/modal/settings/pages/PassthroughGroup.tsx
// The 直通模式 group of the 播放控制 page (Windows desktop app): the switch, the output endpoint, how the output rate is chosen,
// a probe of what the endpoint accepts in exclusive mode, and the chain the current song really plays through.

export const PASSTHROUGH: SettingsGroupDef = {
    id: 'passthroughSettings',
    titleKey: 'passthrough.groupTitle',
    electronOnly: true,
    available: () => runsOnWindows(),
};

export const PASSTHROUGH_OPTIONS = {
    enable: option(PASSTHROUGH, 'passthroughEnable', 'passthrough.enable', { electronOnly: true, available: () => runsOnWindows() }),
    device: option(PASSTHROUGH, 'passthroughDevice', 'passthrough.device', { electronOnly: true, available: () => runsOnWindows() }),
    rate: option(PASSTHROUGH, 'passthroughRate', 'passthrough.rate', { electronOnly: true, available: () => runsOnWindows() }),
    fixedRate: option(PASSTHROUGH, 'passthroughFixedRate', 'passthrough.fixedRate', { electronOnly: true, available: () => runsOnWindows() }),
    probe: option(PASSTHROUGH, 'passthroughProbe', 'passthrough.probe', { electronOnly: true, available: () => runsOnWindows() }),
    chain: option(PASSTHROUGH, 'passthroughChain', 'passthrough.chain', { electronOnly: true, available: () => runsOnWindows() }),
};

const O = PASSTHROUGH_OPTIONS;

/** Groups the accepted formats by bit depth: `24-bit: 44.1 / 48 / ... kHz`. */
const summariseProbe = (formats: PassthroughFormatProbe[], line: (bits: number, rates: string) => string): string[] => {
    const byBits = new Map<number, number[]>();
    for (const format of formats) {
        if (!format.exclusive) continue;
        const rates = byBits.get(format.validBits) ?? [];
        if (!rates.includes(format.rate)) rates.push(format.rate);
        byBits.set(format.validBits, rates);
    }
    return [...byBits.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([bits, rates]) => line(bits, rates.sort((a, b) => a - b).map(rate => rate / 1000).join(' / ')));
};

const PassthroughGroup: React.FC = () => {
    const { t } = useTranslation();
    const api = window.electron?.audioHelper;
    const enabled = usePassthroughSettingsStore(state => state.passthroughEnabled);
    const deviceId = usePassthroughSettingsStore(state => state.passthroughDeviceId);
    const strategy = usePassthroughSettingsStore(state => state.passthroughRateStrategy);
    const fixedRate = usePassthroughSettingsStore(state => state.passthroughFixedRate);
    const setEnabled = usePassthroughSettingsStore(state => state.handleTogglePassthrough);
    const setDevice = usePassthroughSettingsStore(state => state.handleSetPassthroughDevice);
    const setStrategy = usePassthroughSettingsStore(state => state.handleSetPassthroughRateStrategy);
    const setFixedRate = usePassthroughSettingsStore(state => state.handleSetPassthroughFixedRate);
    const chain = usePassthroughStatusStore(state => state.chain);
    const engaged = usePassthroughStatusStore(state => state.engaged);
    const fallbackReason = usePassthroughStatusStore(state => state.fallbackReason);

    const [available, setAvailable] = useState<boolean | null>(null);
    const [devices, setDevices] = useState<PassthroughDevice[]>([]);
    const [devicesError, setDevicesError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [probing, setProbing] = useState(false);
    const [probeLines, setProbeLines] = useState<string[] | null>(null);
    const [probeError, setProbeError] = useState<string | null>(null);

    const refreshDevices = useCallback(async () => {
        if (!api) return;
        setLoading(true);
        setDevicesError(null);
        const result = await api.listDevices();
        if (result.ok) setDevices(result.devices);
        else setDevicesError(result.error);
        setLoading(false);
    }, [api]);

    useEffect(() => {
        if (!api) return;
        void api.getStatus().then(status => {
            setAvailable(status.available);
            if (status.available) void refreshDevices();
        });
    }, [api, refreshDevices]);

    // The result of a probe belongs to the device it was run on.
    useEffect(() => {
        setProbeLines(null);
        setProbeError(null);
    }, [deviceId]);

    if (!api || !runsOnWindows()) return null;

    const targetDevice = devices.find(device => device.id === deviceId) ?? devices.find(device => device.isDefault);

    const runProbe = async () => {
        if (!targetDevice) return;
        setProbing(true);
        setProbeError(null);
        const result = await api.probeDevice(targetDevice.id);
        if (result.ok) {
            setProbeLines(summariseProbe(result.formats, (bits, rates) => t('passthrough.probeLine', { bits, rates })));
        } else {
            setProbeLines(null);
            setProbeError(result.error);
        }
        setProbing(false);
    };

    const deviceOptions = [
        { value: '', label: t('passthrough.deviceDefault') },
        ...devices.map(device => ({ value: device.id, label: device.name })),
    ];
    // A device saved earlier but not in the list right now (unplugged, helper not asked yet) keeps an entry so the choice stays visible.
    if (deviceId && !devices.some(device => device.id === deviceId)) {
        deviceOptions.push({ value: deviceId, label: deviceId });
    }

    const chainTone = chain ? (chain.bitPerfect ? 'ok' : 'warn') : fallbackReason ? 'error' : undefined;
    const chainText = chain && engaged
        ? <>
            {describeChain(chain)}
            {' · '}
            {chain.bitPerfect
                ? t('passthrough.chainBitPerfect')
                : chainDepartures(chain).map(key => t(`passthrough.chain${key}`)).join(' / ')}
        </>
        : fallbackReason
            ? t(`passthrough.fallback.${fallbackReason}`)
            : t('passthrough.chainIdle');

    return (
        <Group def={PASSTHROUGH}>
            <Row option={O.enable} hint={t('passthrough.enableDesc')} note={t('passthrough.enableNote')} disabled={available === false}>
                <Toggle checked={enabled} onChange={setEnabled} />
            </Row>
            {available === false && (
                <Row label={<Status tone="error">{t('passthrough.helperMissing')}</Status>} />
            )}
            <Reveal when={enabled && available !== false}>
                <Row option={O.device} hint={devicesError ? t('passthrough.deviceError', { error: devicesError }) : loading ? t('passthrough.deviceLoading') : undefined}>
                    <Button icon={RefreshCw} tip={t('passthrough.deviceRefresh')} onClick={() => void refreshDevices()} disabled={loading} />
                    <Select value={deviceId} options={deviceOptions} onChange={setDevice} onOpen={() => void refreshDevices()} />
                </Row>
                <Row option={O.rate} hint={t('passthrough.rateDesc')} note={t('passthrough.rateNote')}>
                    <Segmented
                        value={strategy}
                        options={[
                            { value: 'native', label: t('passthrough.rateNative') },
                            { value: 'fixed', label: t('passthrough.rateFixed') },
                        ]}
                        onChange={setStrategy}
                    />
                </Row>
                <Reveal when={strategy === 'fixed'}>
                    <Row option={O.fixedRate} sub>
                        <Select
                            value={String(fixedRate)}
                            options={PASSTHROUGH_FIXED_RATES.map(rate => ({ value: String(rate), label: `${rate / 1000} kHz` }))}
                            onChange={value => setFixedRate(Number(value))}
                        />
                    </Row>
                </Reveal>
                <Row
                    option={O.probe}
                    hint={probeError ? t('passthrough.probeFailed', { error: probeError }) : t('passthrough.probeDesc')}
                    below={probeLines
                        ? <div className="text-xs leading-5 text-[color:var(--st-t2)]">
                            {probeLines.length === 0 ? t('passthrough.probeNone') : probeLines.map(line => <div key={line}>{line}</div>)}
                        </div>
                        : undefined}
                >
                    <Button onClick={() => void runProbe()} disabled={probing || !targetDevice}>
                        {probing ? t('passthrough.probeRunning') : t('passthrough.probe')}
                    </Button>
                </Row>
                <Row option={O.chain} below={<Status tone={chainTone}>{chainText}</Status>} />
            </Reveal>
        </Group>
    );
};

export default PassthroughGroup;
