import React, { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ThemedDialog from '../../shared/ThemedDialog';
import { Button } from '../../modal/settings/kit';
import { CustomSelect } from '../../shared/CustomSelect';
import { omni } from '../../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { visiblePlaylists } from './crossPlaylistModel';
import { listAccountPlaylists } from './crossPlaylistSourceFetch';
import { useCrossPlaylistStore } from './crossPlaylistStore';

// src/components/app/crossPlaylist/CrossPlaylistImportDialog.tsx
// Merging playlists of the platform accounts the user is signed in to into a cross-platform playlist: pick any number of them (from every
// platform), and say whether each goes to a new playlist of its own or all into one that exists, and whether to keep following them
// (so "refresh" later brings in what they have got since).

type Props = { isOpen: boolean; onClose: () => void; isDaylight: boolean; initialTargetId?: string | null };

const NEW_PLAYLIST = '';

/** The app's own tick box (the browser's would be a different blue): a button that reads as a checkbox. */
const TickBox: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }> = ({ checked, onChange, disabled, label }) => (
    <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
            event.stopPropagation();
            onChange(!checked);
        }}
        className={`st-t-fast flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-40 ${
            checked
                ? 'border-transparent bg-[var(--st-accent)] text-[color:var(--st-on-accent)]'
                : 'border-[color:var(--st-t3)] bg-transparent text-transparent hover:border-[color:var(--st-t2)]'
        }`}
    >
        <Check size={13} strokeWidth={3} aria-hidden />
    </button>
);

export const CrossPlaylistImportDialog: React.FC<Props> = ({ isOpen, onClose, isDaylight, initialTargetId = null }) => {
    const { t } = useTranslation();
    // The accounts' playlist lists arrive (and change) after sign-in; read again when they do.
    const accounts = useOnlineProviderAccountStore(state => state.accounts);
    const options = useMemo(() => listAccountPlaylists(), [accounts, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
    const { playlists, importAccountPlaylists } = useCrossPlaylistStore(useShallow(state => ({
        playlists: state.playlists,
        importAccountPlaylists: state.importAccountPlaylists,
    })));
    const targets = useMemo(() => visiblePlaylists(playlists), [playlists]);

    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [target, setTarget] = useState<string>(NEW_PLAYLIST);
    const [follow, setFollow] = useState(true);
    const [busy, setBusy] = useState<null | { done: number; total: number; name: string }>(null);

    useEffect(() => {
        if (!isOpen) return;
        setPicked(new Set());
        setTarget(initialTargetId ?? NEW_PLAYLIST);
        setBusy(null);
    }, [isOpen, initialTargetId]);

    const keyOf = (option: { providerId: string; collectionId: string }) => `${option.providerId}:${option.collectionId}`;
    const groups = useMemo(() => {
        const byProvider = new Map<string, typeof options>();
        for (const option of options) byProvider.set(option.providerId, [...(byProvider.get(option.providerId) ?? []), option]);
        return [...byProvider.entries()];
    }, [options]);

    const toggle = (key: string) => setPicked(previous => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    });

    const run = async () => {
        const items = options.filter(option => picked.has(keyOf(option))).map(option => ({ providerId: option.providerId, collectionId: option.collectionId, name: option.name }));
        if (items.length === 0) return;
        setBusy({ done: 0, total: items.length, name: items[0].name });
        const outcomes = await importAccountPlaylists({
            items,
            targetPlaylistId: target || null,
            follow,
            onProgress: (done, total, name) => setBusy({ done, total, name }),
        });
        setBusy(null);
        const failed = outcomes.filter(outcome => outcome.error);
        const added = outcomes.reduce((sum, outcome) => sum + outcome.added, 0);
        setStatusMessage({
            type: failed.length ? 'error' : 'success',
            text: failed.length
                ? t('crossPlaylist.importFailedSome', { count: failed.length, names: failed.map(outcome => outcome.name).join('、') })
                : t('crossPlaylist.importedFromAccounts', { count: outcomes.length, added }),
        });
        if (failed.length === 0) onClose();
    };

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={busy ? () => {} : onClose}
            isDaylight={isDaylight}
            title={t('crossPlaylist.fromAccountTitle')}
            description={t('crossPlaylist.fromAccountIntro')}
            size="m"
            fill
            closeDisabled={Boolean(busy)}
            footerNote={busy ? t('crossPlaylist.importing', { done: Math.min(busy.done + 1, busy.total), total: busy.total, name: busy.name }) : t('crossPlaylist.pickedCount', { count: picked.size })}
            footer={(
                <Button onClick={() => void run()} disabled={Boolean(busy) || picked.size === 0}>{t('crossPlaylist.import')}</Button>
            )}
        >
            {options.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-[color:var(--st-t3)]">{t('crossPlaylist.fromAccountEmpty')}</div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
                        <div className="flex items-center gap-2">
                            <span className="text-[color:var(--st-t2)]">{t('crossPlaylist.importInto')}</span>
                            <CustomSelect
                                compact
                                value={target}
                                onChange={setTarget}
                                options={[{ value: NEW_PLAYLIST, label: t('crossPlaylist.importIntoNew') }, ...targets.map(playlist => ({ value: playlist.id, label: playlist.name }))]}
                                disabled={Boolean(busy)}
                                isDaylight={isDaylight}
                            />
                        </div>
                        <div className="flex items-center gap-2" title={t('crossPlaylist.followHint')}>
                            <TickBox checked={follow} onChange={setFollow} disabled={Boolean(busy)} label={t('crossPlaylist.follow')} />
                            <button type="button" className="text-left" onClick={() => setFollow(!follow)} disabled={Boolean(busy)}>{t('crossPlaylist.follow')}</button>
                        </div>
                    </div>
                    <div className="st-card st-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                        {groups.map(([providerId, list]) => (
                            <div key={providerId}>
                                <div className="sticky top-0 bg-[var(--st-card)] px-4 py-1.5 text-xs font-medium text-[color:var(--st-t2)]">{omni.getProviderLabel(providerId)}</div>
                                {list.map(option => (
                                    <div
                                        key={keyOf(option)}
                                        role="presentation"
                                        onClick={() => { if (!busy) toggle(keyOf(option)); }}
                                        className="st-row st-t-fast flex min-h-12 cursor-pointer items-center gap-3 px-4 py-1.5 hover:bg-[var(--st-fill)]"
                                    >
                                        <TickBox checked={picked.has(keyOf(option))} onChange={() => toggle(keyOf(option))} disabled={Boolean(busy)} label={option.name} />
                                        <span className="min-w-0 flex-1 truncate text-sm">{option.name}</span>
                                        {typeof option.trackCount === 'number' && <span className="shrink-0 text-xs text-[color:var(--st-t3)]">{t('crossPlaylist.songCount', { count: option.trackCount })}</span>}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </ThemedDialog>
    );
};

export default CrossPlaylistImportDialog;
