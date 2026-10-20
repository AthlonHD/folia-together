import React, { useEffect, useState } from 'react';
import { Link2, LogOut, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ThemedDialog from '../../shared/ThemedDialog';
import ConfirmDialog from '../../shared/ConfirmDialog';
import { Button, TextField } from '../../modal/settings/kit';
import { CrossSyncError, pingSyncServer, syncBaseOf, type CrossSyncErrorKind } from './crossPlaylistSyncClient';
import { useCrossPlaylistStore } from './crossPlaylistStore';

// src/components/app/crossPlaylist/CrossPlaylistSyncDialog.tsx
// Syncing the cross-platform playlists between devices, the way an input method does it: one device makes a code, the other types it.
// The page served by the Stage server reaches it on its own address; the desktop app is told the address (taken from its remote-server
// setting when there is one).

type Props = { isOpen: boolean; onClose: () => void; isDaylight: boolean };

const errorKeyOf = (kind: CrossSyncErrorKind | null): string => `crossPlaylist.syncError.${kind ?? 'server'}`;

export const CrossPlaylistSyncDialog: React.FC<Props> = ({ isOpen, onClose, isDaylight }) => {
    const { t } = useTranslation();
    const sync = useCrossPlaylistStore(useShallow(state => ({
        config: state.syncConfig,
        state: state.syncState,
        error: state.syncError,
        lastSyncedAt: state.lastSyncedAt,
        startSync: state.startSync,
        newSyncCode: state.newSyncCode,
        joinSync: state.joinSync,
        syncNow: state.syncNow,
        leaveSync: state.leaveSync,
    })));
    const desktopApi = typeof window !== 'undefined' ? window.electron?.stageRemote : undefined;
    // The desktop app is not served by the server, so it needs the address; a page the server serves does not.
    const needsAddress = Boolean(desktopApi);
    const [address, setAddress] = useState('');
    const [available, setAvailable] = useState<boolean | null>(null);
    const [codeInput, setCodeInput] = useState('');
    const [issued, setIssued] = useState<{ code: string; expiresAt: number } | null>(null);
    const [now, setNow] = useState(Date.now());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [confirmLeave, setConfirmLeave] = useState(false);

    // The address the desktop app already knows for the remote controller is the likely one.
    useEffect(() => {
        if (!isOpen) return;
        const saved = sync.config?.serverUrl;
        if (saved) {
            setAddress(saved);
        } else if (desktopApi) {
            void desktopApi.getConfig().then(config => setAddress(current => current || config.url || ''));
        }
        setMessage(null);
    }, [isOpen, desktopApi, sync.config?.serverUrl]);

    // Is there a sync service there? Asked when the dialog opens and when the address is finished.
    useEffect(() => {
        if (!isOpen) return;
        if (needsAddress && !address.trim()) {
            setAvailable(null);
            return;
        }
        let cancelled = false;
        void pingSyncServer(needsAddress ? address : '').then(ok => {
            if (!cancelled) setAvailable(ok);
        });
        return () => { cancelled = true; };
    }, [isOpen, needsAddress, address]);

    useEffect(() => {
        if (!issued) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [issued]);
    useEffect(() => {
        if (!isOpen) setIssued(null);
    }, [isOpen]);

    const serverUrl = sync.config ? sync.config.serverUrl : (needsAddress ? syncBaseOf(address) : '');
    const secondsLeft = issued ? Math.max(0, Math.round((issued.expiresAt - now) / 1000)) : 0;

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        setMessage(null);
        try {
            await work();
        } catch (error) {
            setMessage(t(errorKeyOf(error instanceof CrossSyncError ? error.kind : 'server')));
        } finally {
            setBusy(false);
        }
    };

    const makeCode = () => run(async () => {
        const result = sync.config ? await sync.newSyncCode() : await sync.startSync(serverUrl);
        setIssued({ code: result.code, expiresAt: Date.now() + result.expiresInSec * 1000 });
        setNow(Date.now());
    });

    const join = () => run(async () => {
        await sync.joinSync(serverUrl, codeInput);
        setCodeInput('');
        setMessage(t('crossPlaylist.syncJoined'));
    });

    const formatCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;
    const blocked = available === false || (needsAddress && !address.trim() && !sync.config);

    return (
        <>
            <ThemedDialog isOpen={isOpen} onClose={onClose} isDaylight={isDaylight} title={t('crossPlaylist.syncTitle')} description={t('crossPlaylist.syncIntro')} size="m">
                <div className="flex flex-col gap-4 pb-1">
                    {needsAddress && !sync.config && (
                        <div>
                            <div className="mb-1.5 text-xs text-[color:var(--st-t2)]">{t('crossPlaylist.syncServer')}</div>
                            <TextField value={address} onChange={setAddress} type="url" placeholder="http://192.168.1.10:3000" />
                        </div>
                    )}

                    {available === false && (
                        <div className="rounded-lg bg-[var(--st-fill)] px-3 py-2 text-[13px] text-[color:var(--st-t2)]">
                            {t(needsAddress ? 'crossPlaylist.syncUnreachableDesktop' : 'crossPlaylist.syncUnavailable')}
                        </div>
                    )}

                    {sync.config ? (
                        <div className="flex flex-col gap-3">
                            <div className="text-[13px]">
                                <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: sync.state === 'error' ? '#ef4444' : '#22c55e' }} />
                                {sync.state === 'syncing'
                                    ? t('crossPlaylist.syncSyncing')
                                    : sync.state === 'error'
                                        ? t(errorKeyOf(sync.error))
                                        : sync.lastSyncedAt
                                            ? t('crossPlaylist.syncDone', { time: new Date(sync.lastSyncedAt).toLocaleTimeString() })
                                            : t('crossPlaylist.syncOn')}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button icon={RefreshCw} onClick={() => void run(() => sync.syncNow())} disabled={busy || sync.state === 'syncing'}>{t('crossPlaylist.syncNow')}</Button>
                                <Button icon={Link2} variant="quiet" onClick={() => void makeCode()} disabled={busy}>{t('crossPlaylist.syncMakeCode')}</Button>
                                <Button icon={LogOut} variant="quiet" onClick={() => setConfirmLeave(true)} disabled={busy}>{t('crossPlaylist.syncLeave')}</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <div>
                                <div className="mb-1.5 text-xs text-[color:var(--st-t2)]">{t('crossPlaylist.syncFirstDevice')}</div>
                                <Button icon={Link2} onClick={() => void makeCode()} disabled={busy || blocked}>{t('crossPlaylist.syncMakeCode')}</Button>
                            </div>
                            <div>
                                <div className="mb-1.5 text-xs text-[color:var(--st-t2)]">{t('crossPlaylist.syncOtherDevice')}</div>
                                <div className="flex items-center gap-2">
                                    <TextField value={codeInput} onChange={setCodeInput} placeholder={t('crossPlaylist.syncCodePlaceholder')} />
                                    <Button onClick={() => void join()} disabled={busy || blocked || codeInput.replace(/[^A-Za-z0-9]/g, '').length < 8}>{t('crossPlaylist.syncJoin')}</Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {issued && (
                        <div className="rounded-xl bg-[var(--st-card)] px-4 py-3 text-center shadow-[0_0_0_1px_var(--st-line)]">
                            {secondsLeft > 0 ? (
                                <>
                                    <div className="font-mono text-3xl tracking-[0.18em] tabular-nums" data-testid="cross-sync-code">{formatCode(issued.code)}</div>
                                    <div className="mt-1.5 text-xs text-[color:var(--st-t2)]">{t('crossPlaylist.syncCodeHint', { minutes: Math.floor(secondsLeft / 60), seconds: String(secondsLeft % 60).padStart(2, '0') })}</div>
                                </>
                            ) : (
                                <div className="text-[13px] text-[color:var(--st-t2)]">{t('crossPlaylist.syncCodeExpired')}</div>
                            )}
                        </div>
                    )}

                    {message && <div className="text-[13px] text-[color:var(--st-t2)]">{message}</div>}
                    <div className="text-xs leading-5 text-[color:var(--st-t3)]">{t('crossPlaylist.syncNote')}</div>
                </div>
            </ThemedDialog>

            <ConfirmDialog
                isOpen={confirmLeave}
                title={t('crossPlaylist.syncLeaveTitle')}
                description={t('crossPlaylist.syncLeaveMessage')}
                isDaylight={isDaylight}
                onConfirm={() => {
                    setConfirmLeave(false);
                    setIssued(null);
                    sync.leaveSync();
                }}
                onClose={() => setConfirmLeave(false)}
            />
        </>
    );
};

export default CrossPlaylistSyncDialog;
