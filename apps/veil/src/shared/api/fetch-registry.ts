import { ChainRegistryClient, Registry } from '@penumbra-labs/registry';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';

/*
 * Represents a registry in a nicely serializable package.
 *
 * This should probably just be exported from the library (TODO).
 */
export type JsonRegistry = ConstructorParameters<typeof Registry>[0];

const CLIENT = new ChainRegistryClient();

/** The staking token's asset id. */
export const STAKING_TOKEN_ASSET_ID: AssetId = CLIENT.bundled.globals().stakingAssetId;

export async function fetchRegistry(chainId: string): Promise<Registry> {
  return await CLIENT.remote.getWithBundledBackup(chainId);
}

// Process-wide memoized registry for server routes. `remote.get` is a WAN
// fetch of a ~250KB JSON (GitHub raw); doing it per request put a round
// trip + parse on the critical path of /api/book, /api/candles,
// /api/recent-executions, ... on every poll. The registry changes rarely,
// so: resolve once per chainId, serve the same promise to every caller,
// and refresh in the background once the entry is older than
// `REGISTRY_TTL_MS` (a registry bump then lands without a redeploy). A
// cold failure clears the slot so the next request retries instead of
// pinning a rejected promise; a refresh failure keeps serving the old
// registry. Falls back to the bundled registry when the remote is
// unreachable (same as `fetchRegistry`).
const REGISTRY_TTL_MS = 60 * 60 * 1000;
interface CachedRegistry {
  promise: Promise<Registry>;
  fetchedAt: number;
  refreshing: boolean;
}
const registryCache = new Map<string, CachedRegistry>();

export function getCachedRegistry(chainId: string): Promise<Registry> {
  const now = Date.now();
  const cached = registryCache.get(chainId);
  if (cached) {
    if (now - cached.fetchedAt > REGISTRY_TTL_MS && !cached.refreshing) {
      cached.refreshing = true;
      fetchRegistry(chainId)
        .then(registry => {
          registryCache.set(chainId, {
            promise: Promise.resolve(registry),
            fetchedAt: Date.now(),
            refreshing: false,
          });
        })
        .catch(err => {
          cached.refreshing = false;
          console.warn('[registry-cache] background refresh failed, keeping cached', {
            chainId,
            err,
          });
        });
    }
    return cached.promise;
  }
  const entry: CachedRegistry = {
    promise: fetchRegistry(chainId).catch((err: unknown) => {
      if (registryCache.get(chainId) === entry) {
        registryCache.delete(chainId);
      }
      throw err;
    }),
    fetchedAt: now,
    refreshing: false,
  };
  registryCache.set(chainId, entry);
  return entry.promise;
}

async function fetchJsonRegistry(chainId: string): Promise<JsonRegistry> {
  const registry = await fetchRegistry(chainId);
  // We use type-foo because this type isn't exported.
  const assetById: JsonRegistry['assetById'] = {};
  for (const metadata of registry.getAllAssets()) {
    const assetId = metadata.penumbraAssetId;
    if (!assetId) {
      // We don't want this to throw an error, but we should have some kind of warning.
      console.warn('Found a metadata entry with no asset ID', { chainId, metadata });
      continue;
    }
    // Safe, assuming the upstream API is well-formed, but really we should add provisions
    // to the registry to do this.
    assetById[uint8ArrayToBase64(assetId.inner)] = JSON.parse(
      JSON.stringify(metadata),
    ) as JsonRegistry['assetById'][string];
  }
  return {
    chainId: registry.chainId,
    ibcConnections: registry.ibcConnections,
    numeraires: registry.numeraires.map(x => uint8ArrayToBase64(x.inner)),
    assetById,
  };
}

/**
 * A JSONified registry, along with the staking token.
 *
 * This is suitable for passing across an API boundary.
 */
export interface JsonRegistryWithGlobals {
  stakingAssetIdBase64: string;
  registry: JsonRegistry;
}

/**
 * Fetch registry information, for a given chain id.
 *
 * This will make a fresh call to the remote registry.
 */
export async function fetchJsonRegistryWithGlobals(
  chainId: string,
): Promise<JsonRegistryWithGlobals> {
  const registry = await fetchJsonRegistry(chainId);
  const stakingAssetId = CLIENT.bundled.globals().stakingAssetId;
  return {
    registry,
    stakingAssetIdBase64: uint8ArrayToBase64(stakingAssetId.inner),
  };
}
