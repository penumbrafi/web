import { PenumbraClient, PenumbraManifest } from '@penumbra-zone/client';
import { useQuery } from '@tanstack/react-query';

/**
 * Resolves all installed wallet provider manifests, **dropping any that fail**
 * to fetch. Previously this used `Promise.all`, so one misbehaving extension
 * — e.g. Prax injecting a stale `chrome-extension://invalid/manifest.json`
 * after an uninstall, or any Penumbra-fork extension whose content script
 * doesn't get its runtime id bridged in time — would reject the whole batch
 * and the user would see an empty wallet list, even with a working wallet
 * (Zafu, Prax) installed.
 *
 * `allSettled` lets healthy providers surface while we silently skip broken
 * ones. The connect button reads from this; if every provider fails, the
 * caller sees an empty record (treated the same as "no wallet installed").
 */
export const useProviderManifests = () => {
  return useQuery({
    queryKey: ['provider-manifests'],
    queryFn: async () => {
      const providers = PenumbraClient.getProviderManifests();

      const settled = await Promise.allSettled(
        Object.entries(providers).map(async ([key, promise]) => {
          const value = await promise;
          return [key, value] as const;
        }),
      );

      const resolvedManifests = settled.flatMap(r => {
        if (r.status === 'fulfilled') {
          return [r.value];
        }
        // Don't spam the console at info level — Penumbra-tagged extensions
        // do throw routinely on uninstalled/disabled providers.
        console.debug('[providerManifests] skipping broken provider:', r.reason);
        return [];
      });

      return Object.fromEntries(resolvedManifests) as Record<string, PenumbraManifest>;
    },
  });
};
