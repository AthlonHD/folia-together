import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutMode, useLayoutPreference } from '../../../hooks/useLayoutMode';
import { setLayoutPreference, type LayoutPreference } from '../../../services/deviceProfile';
import { Group, Row, Segmented, option, type SettingsGroupDef, type SettingsOptionDef } from './kit';

// src/components/modal/settings/LayoutModeSection.tsx
// 界面布局(本 Fork):自动(按设备判断)/ 始终手机 / 始终电脑。手机和电脑是两套独立的布局,
// 自动判断拿不准时按电脑;判断错了(比如平板想用手机版)在这里手动改。立即生效,不用刷新。
// 用设置页的 kit(Group / Row)画,放在「通用」页。

export const LAYOUT_MODE_GROUP: SettingsGroupDef = { id: 'layoutMode', titleKey: 'options.layoutMode' };

const LAYOUT_OPTION = option(LAYOUT_MODE_GROUP, 'layoutModeChoice', 'options.layoutMode');

/** 页面声明的选项(设置搜索与锚点覆盖测试读它)。 */
export const LAYOUT_MODE_OPTIONS: SettingsOptionDef[] = [LAYOUT_OPTION];

const CHOICES: LayoutPreference[] = ['auto', 'phone', 'desktop'];

const LayoutModeSection: React.FC = () => {
    const { t } = useTranslation();
    const preference = useLayoutPreference();
    const effective = useLayoutMode();

    return (
        <Group
            def={LAYOUT_MODE_GROUP}
            foot={t('options.layoutModeCurrent', { layout: t(`options.layoutMode_${effective}`) })}
        >
            <Row option={LAYOUT_OPTION} hint={t('options.layoutModeDesc')}>
                <Segmented
                    value={preference}
                    options={CHOICES.map(choice => ({ value: choice, label: t(`options.layoutMode_${choice}`) }))}
                    onChange={setLayoutPreference}
                />
            </Row>
        </Group>
    );
};

export default LayoutModeSection;
