import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTogetherUpdateSettingsStore } from '../../../stores/useTogetherUpdateSettingsStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getBuildCommit } from './buildCommit';

// src/components/app/togetherUpdate/useTogetherUpdateCheck.ts
// Once after the desktop app starts: asks the fork's release page whether there is a newer build, and says so in a status message.
// Installing is the user's call (Settings > General); this only tells.

const STARTUP_DELAY_MS = 20_000;

export function useTogetherUpdateCheck() {
    const { t } = useTranslation();
    const enabled = useTogetherUpdateSettingsStore(state => state.togetherUpdateAutoCheck);

    useEffect(() => {
        const api = window.electron?.togetherUpdate;
        if (!api || !enabled) return;
        const timer = window.setTimeout(() => {
            void api.check(getBuildCommit()).then(result => {
                if (result.status === 'available') {
                    console.info('[TogetherUpdate] a newer build is available', result.release?.name);
                    setStatusMessage({ type: 'info', text: t('togetherUpdate.availableToast') });
                }
            }).catch(error => console.warn('[TogetherUpdate] the startup check failed', error));
        }, STARTUP_DELAY_MS);
        return () => window.clearTimeout(timer);
        // The check is made once per start: a change of the language or of the setting later must not repeat it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
