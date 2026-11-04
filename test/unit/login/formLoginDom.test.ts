// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import FormLogin from '@/components/login/window/FormLogin';

// Failed form submissions must show an error and allow retry after StrictMode replays mount effects.

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getLoginForm: () => ({ fields: [] }) } }));

describe('FormLogin in StrictMode', () => {
    it('shows a failed submission and enables retry', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const container = document.createElement('div');
        const root = createRoot(container);
        const submit = vi.fn().mockRejectedValue(new Error('test failure'));
        try {
            await act(async () => root.render(React.createElement(StrictMode, null,
                React.createElement(FormLogin, { providerId: 'fnmusic', onSubmitForm: submit }))));
            const button = container.querySelector('button')!;
            await act(async () => button.click());
            expect(submit).toHaveBeenCalledTimes(1);
            expect(container.textContent).toContain('login.formErrorUnknown');
            expect(button.disabled).toBe(false);
            await act(async () => button.click());
            expect(submit).toHaveBeenCalledTimes(2);
        } finally {
            await act(async () => root.unmount());
            warning.mockRestore();
            vi.unstubAllGlobals();
        }
    });
});
