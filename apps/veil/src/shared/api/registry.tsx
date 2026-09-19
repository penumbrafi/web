'use client';

import { Registry } from '@penumbrafi/registry';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { JsonRegistryWithGlobals } from './fetch-registry';

export interface RegistryWithGlobals {
  stakingAssetId: AssetId;
  registry: Registry;
}

const RegistryContext = createContext<RegistryWithGlobals | undefined>(undefined);

const STORAGE_KEY = 'penumbra-registry-v1';
const REGISTRY_TTL_MS = 60 * 60 * 1000; // 1h

interface CachedRegistry {
  fetchedAt: number;
  chainId: string;
  data: JsonRegistryWithGlobals;
}

const readCache = (chainId: string): JsonRegistryWithGlobals | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CachedRegistry;
    if (cached.chainId !== chainId) return undefined;
    if (Date.now() - cached.fetchedAt > REGISTRY_TTL_MS) return undefined;
    return cached.data;
  } catch {
    return undefined;
  }
};

const writeCache = (chainId: string, data: JsonRegistryWithGlobals) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), chainId, data } satisfies CachedRegistry),
    );
  } catch {
    // localStorage can be disabled / quota-exceeded; cache miss is fine
  }
};

const fetchRegistryFromApi = async (chainId: string): Promise<JsonRegistryWithGlobals> => {
  const res = await fetch(`/api/registry?chainId=${encodeURIComponent(chainId)}`, {
    // Server route already caches with revalidate; let the browser
    // also keep its copy under HTTP cache control headers.
    cache: 'force-cache',
  });
  if (!res.ok) {
    throw new Error(`registry fetch failed: ${res.status}`);
  }
  return (await res.json()) as JsonRegistryWithGlobals;
};

interface RegistryProviderProps {
  chainId: string;
  children: ReactNode;
}

/**
 * Provides the chain registry to every consumer of `useRegistry()` and friends.
 *
 * Previously the registry was fetched server-side in the root layout and
 * passed down as a prop, which embedded the entire ~250KB JSON in the RSC
 * payload of every page. Now the layout passes only the chainId; we fetch
 * client-side once, cache the result in localStorage for an hour, and
 * subsequent navigations read instantly from the cache.
 *
 * For the first-paint experience: if the cache is warm, `initialData` makes
 * the query resolve synchronously on first render. If cold, we render a
 * lightweight inline placeholder until the response lands. This keeps the
 * synchronous `useRegistry()` API for the 60+ existing call sites — they
 * don't have to know about Suspense.
 */
export const RegistryProvider = ({ chainId, children }: RegistryProviderProps) => {
  // The server has no localStorage and no fetch result, so `data` is
  // always undefined during SSR — the server emits the skeleton. We
  // need the *first* client paint to also emit the skeleton, otherwise
  // hydration mismatches when the client immediately reads from
  // localStorage. Gating the query on a post-mount flag guarantees
  // SSR and first-paint render identical HTML; after mount, the cache
  // is read and (if present) the query resolves synchronously from
  // initialData on the very next render — single-frame transition,
  // no network call on warm visits.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const initialData = mounted ? readCache(chainId) : undefined;

  const { data, error } = useQuery({
    queryKey: ['penumbra-registry', chainId],
    queryFn: () => fetchRegistryFromApi(chainId),
    initialData,
    enabled: mounted,
    staleTime: REGISTRY_TTL_MS,
    gcTime: REGISTRY_TTL_MS * 2,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  // Persist freshly-fetched data to localStorage when the data identity
  // changes (i.e. it came from the network rather than from the cache).
  useEffect(() => {
    if (data && data !== initialData) {
      writeCache(chainId, data);
    }
  }, [data, initialData, chainId]);

  const parsed = useMemo<RegistryWithGlobals | undefined>(() => {
    if (!data) return undefined;
    return {
      stakingAssetId: AssetId.fromJson({ inner: data.stakingAssetIdBase64 }),
      registry: new Registry(data.registry),
    };
  }, [data]);

  if (error) {
    return (
      <div className='m-8 rounded-lg bg-other-tonal-fill5 p-6 text-text-primary'>
        <div className='mb-2 font-medium'>Registry unavailable</div>
        <div className='text-sm text-text-secondary'>
          The chain asset registry couldn&apos;t be loaded. Refresh to retry.
        </div>
      </div>
    );
  }

  if (!parsed) {
    // Identical markup on SSR and first client paint — no hydration drift.
    // suppressHydrationWarning is here as belt-and-braces against any
    // theme-class differences swapped in by the body className.
    return (
      <div
        className='flex min-h-screen items-center justify-center'
        suppressHydrationWarning
      >
        <div className='h-2 w-32 animate-pulse rounded bg-other-tonal-fill5' />
      </div>
    );
  }

  return <RegistryContext.Provider value={parsed}>{children}</RegistryContext.Provider>;
};

const useRegistryWithGlobals = (): RegistryWithGlobals => {
  const value = useContext(RegistryContext);
  if (!value) {
    throw new Error(
      'No RegistryProvider in ambient scope, make sure to wrap this component in one',
    );
  }
  return value;
};

export const useRegistry = () => {
  const data = useRegistryWithGlobals().registry;
  return { data };
};

export const useRegistryAssets = () => {
  const { registry } = useRegistryWithGlobals();
  // Memoize on registry identity — getAllAssets().sort() walks every asset
  // and allocates a fresh sorted array. Without this it ran on every
  // render of every consumer (useAssets / usePathToMetadata / Summary /
  // pair selector / ...) and gave each of them a fresh reference, which
  // silently busted any downstream useMemo that listed `assets` as a dep.
  // Registry is set once per session via the provider, so this memo
  // basically caches forever in practice.
  const data = useMemo(
    () =>
      registry
        .getAllAssets()
        .sort((a, b) => Number(b.priorityScore) - Number(a.priorityScore)),
    [registry],
  );
  return useMemo(() => ({ data, isLoading: false }), [data]);
};

export const useStakingTokenMetadata = () => {
  const { stakingAssetId, registry } = useRegistryWithGlobals();
  const data = useMemo(
    () => registry.getMetadata(stakingAssetId),
    [registry, stakingAssetId],
  );
  return useMemo(() => ({ data, isLoading: false }), [data]);
};
