import React from 'react';
import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useLayoutMode, useLayoutPreference } from '../../../hooks/useLayoutMode';
import { setLayoutPreference, type LayoutPreference } from '../../../services/deviceProfile';

// src/components/modal/settings/LayoutModeSection.tsx
// 界面布局:自动(按设备判断)/ 始终手机 / 始终电脑。手机和电脑是两套独立的布局,
// 自动判断拿不准时按电脑;判断错了(比如平板想用手机版)在这里手动改。立即生效,不用刷新。

type LayoutModeSectionProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
};

const OPTIONS: LayoutPreference[] = ['auto', 'phone', 'desktop'];

const LayoutModeSection: React.FC<LayoutModeSectionProps> = ({ isDaylight, settingsCardClass, theme }) => {
    const { t } = useTranslation();
    const preference = useLayoutPreference();
    const effective = useLayoutMode();
    const accentColor = theme?.accentColor || (isDaylight ? '#3b82f6' : '#60a5fa');

    return (
        <SettingsAnchor anchorId="layoutMode" label={t('options.layoutMode')}>
            <SettingsSectionHeading icon={Smartphone} label={t('options.layoutMode')} />
            <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.layoutModeDesc')}
                </div>
                <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t('options.layoutMode')}>
                    {OPTIONS.map(option => {
                        const isSelected = option === preference;
                        const frameClass = isSelected
                            ? (isDaylight ? 'bg-white shadow-md' : 'bg-white/[0.07]')
                            : (isDaylight ? 'bg-zinc-50 hover:bg-white' : 'bg-white/[0.03] hover:bg-white/[0.06]');
                        return (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                data-layout-preference-option={option}
                                onClick={() => setLayoutPreference(option)}
                                className={`text-left rounded-2xl border px-3 py-2.5 text-sm font-medium transition-colors ${frameClass}`}
                                style={{
                                    color: 'var(--text-primary)',
                                    borderColor: isSelected
                                        ? accentColor
                                        : (isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'),
                                }}
                            >
                                {t(`options.layoutMode_${option}`)}
                            </button>
                        );
                    })}
                </div>
                <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.layoutModeCurrent', { layout: t(`options.layoutMode_${effective}`) })}
                </div>
            </div>
        </SettingsAnchor>
    );
};

export default LayoutModeSection;
