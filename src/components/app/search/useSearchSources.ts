import { useMemo, useSyncExternalStore } from 'react';
import { omni } from '../../../services/onlineMusic/omni';
import { isStageRemoteMode, REMOTE_PLAYABLE_PROVIDER_IDS } from '../../../services/stageMode';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { useSearchSettingsStore } from '../../../stores/useSearchSettingsStore';
import type { SearchSource } from '../../../stores/useSearchNavigationStore';
import { orderSearchSources } from '../../../utils/searchSourceOrder';

// src/components/app/search/useSearchSources.ts
// The source tabs of the search page. Every online platform that can be used gets one (the queue can mix platforms, so a song is searched
// for wherever it is wanted without first switching the platform in use), then the local library and Navidrome. Their order is the
// user's (settings → home → search), with the platform in use first unless they turned that off.

/** The tabs, in the order the page would show them with no setting: the platforms as registered, then local and Navidrome. */
export const useSearchSourceCandidates = (): SearchSource[] => {
    // Only a change of the platform list (a mod adds or removes one) makes the list be worked out again.
    const registryVersion = useSyncExternalStore(omni.subscribeProviders, omni.getProviderRegistryVersion);
    return useMemo<SearchSource[]>(() => {
        const remote = isStageRemoteMode();
        const online = omni.getProviderSummaries()
            .filter(provider => provider.availability.configured !== false)
            .map(provider => provider.providerId)
            .filter(providerId => !remote || REMOTE_PLAYABLE_PROVIDER_IDS.has(providerId));
        return [...online, 'local', 'navidrome'];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registryVersion]);
};

export const useSearchSources = (): SearchSource[] => {
    const candidates = useSearchSourceCandidates();
    const activeProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const order = useSearchSettingsStore(state => state.searchSourceOrder);
    const currentFirst = useSearchSettingsStore(state => state.searchCurrentSourceFirst);
    return useMemo(
        () => orderSearchSources({ sources: candidates, order, activeProviderId, currentFirst }),
        [candidates, order, activeProviderId, currentFirst],
    );
};
