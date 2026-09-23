import { useWallet } from '@cosmos-kit/react';
import { useQueries } from '@tanstack/react-query';
import { ChainWalletBase, WalletStatus } from '@cosmos-kit/core';

import { Asset } from '@chain-registry/types';
import { SUPPORTED_ASSETS } from './supported-chains';
import { Coin, StargateClient } from '@cosmjs/stargate';
import { RPC_ENDPOINTS } from './cosmos-endpoints';
import { Registry } from '@penumbrafi/registry';
import { useRegistry } from '@/shared/api/registry';

// `chain-registry/assets` (the barrel) ships ~250 chains' asset lists
// totaling several MB. We only need the chains Penumbra has IBC
// connections to, so use the curated SUPPORTED_ASSETS here too.
const cosmosAssetList = SUPPORTED_ASSETS;

/** @var failedEndpoints is a map of endpoint -> timestamp of last failure */
const failedEndpoints = new Map<string, number>();
const FAILURE_COOLDOWN = 5 * 60 * 1000; // 5 minutes

const isEndpointHealthy = (endpoint: string): boolean => {
  const failureTime = failedEndpoints.get(endpoint);
  if (!failureTime) {
    return true;
  }

  const now = Date.now();
  if (now - failureTime > FAILURE_COOLDOWN) {
    failedEndpoints.delete(endpoint); // Remove from failed list after cooldown
    return true;
  }

  return false;
};

const markEndpointFailed = (endpoint: string): void => {
  failedEndpoints.set(endpoint, Date.now());
};

const getHealthyEndpoints = (chainId: string): string[] => {
  const key = chainId.toLowerCase();
  const endpoints = RPC_ENDPOINTS[key] ?? [];
  return endpoints.filter(isEndpointHealthy);
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const tryConnectWithRetry = async (endpoint: string, retries = 2): Promise<StargateClient> => {
  // exponential backoff
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const client = await StargateClient.connect(endpoint);
      return client;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await sleep(1000 * Math.pow(2, attempt));
    }
  }

  throw new Error('Max retries exceeded');
};

export const fetchChainBalances = async (
  address: string,
  chain: ChainWalletBase,
): Promise<readonly Coin[]> => {
  const { chainId } = chain;
  const healthyEndpoints = getHealthyEndpoints(chainId);

  // Try our reliable endpoints first
  for (const endpoint of healthyEndpoints) {
    try {
      const client = await tryConnectWithRetry(endpoint);
      const balances = await client.getAllBalances(address);
      return balances;
    } catch (error) {
      markEndpointFailed(endpoint);
      console.warn(
        `RPC endpoint failed for ${chain.chainName} (${chainId}): ${endpoint}. Trying next endpoint...`,
      );
    }
  }

  // Fall back to the default RPC from chainWalletBase if all our endpoints failed
  try {
    const defaultEndpoint = await chain.getRpcEndpoint();
    const defaultEndpointString =
      typeof defaultEndpoint === 'string' ? defaultEndpoint : defaultEndpoint.url;

    // Check if the default endpoint is different from our known endpoints
    if (
      !healthyEndpoints.includes(defaultEndpointString) &&
      isEndpointHealthy(defaultEndpointString)
    ) {
      const client = await tryConnectWithRetry(defaultEndpointString);
      const balances = await client.getAllBalances(address);
      return balances;
    }
  } catch (error) {
    // Mark default endpoint as failed too
    try {
      const defaultEndpoint = await chain.getRpcEndpoint();
      const defaultEndpointString =
        typeof defaultEndpoint === 'string' ? defaultEndpoint : defaultEndpoint.url;
      markEndpointFailed(defaultEndpointString);
    } catch {
      // Ignore error getting default endpoint
    }
  }

  // All endpoints failed
  console.error(
    `All RPC endpoints failed for ${chain.chainName} (${chainId}). Retrying will be attempted after cooldown period.`,
  );

  return [];
};

/**
 * Look up a source-chain denom in Penumbra's registry via the IBC path
 * prefix. If Penumbra has a bridged version of this asset (e.g.
 * `transfer/channel-18/erc20:0xa00C59...` for Injective's native USDC),
 * synthesize a chain-registry Asset from the Penumbra metadata so
 * consumers get the right symbol/exponent/icons — with no dependency
 * on chain-registry indexing the source denom.
 *
 * Why: chain-registry's per-chain asset lists are incomplete for
 * non-standard denoms (Injective's erc20:… native USDC is missing from
 * chain-registry/mainnet/injective). The Penumbra registry, on the
 * other hand, knows every asset with an active IBC channel to Penumbra
 * by its full transfer/channel-N/<origin-denom> form. Take advantage.
 */
const augmentViaPenumbraRegistry = (
  denom: string,
  chainId: string,
  penumbraRegistry: Registry,
): Asset | undefined => {
  const conn = penumbraRegistry.ibcConnections.find(c => c.chainId === chainId);
  if (!conn?.channelId) return undefined;
  const penumbraBase = `transfer/${conn.channelId}/${denom}`;
  const asset = penumbraRegistry
    .getAllAssets()
    .find(a => a.base === penumbraBase);
  if (!asset) return undefined;

  // Map Penumbra Metadata → chain-registry Asset shape. denomUnits
  // stay as-is (Penumbra keeps the same {denom, exponent} structure).
  return {
    base: denom,
    symbol: asset.symbol,
    display: asset.display,
    name: asset.name || asset.symbol,
    denom_units: asset.denomUnits.map(u => ({
      denom: u.denom,
      exponent: u.exponent,
      aliases: u.aliases,
    })),
    type_asset: 'sdk.coin',
  };
};

// Searches for corresponding denom in Penumbra's registry first (works
// for anything bridged to Penumbra even if chain-registry doesn't
// list it), then chain-registry per-chain lists, then a raw fallback.
export const augmentToAsset = (
  denom: string,
  chainName: string,
  penumbraRegistry?: Registry,
  chainId?: string,
): Asset => {
  if (penumbraRegistry && chainId) {
    const bridged = augmentViaPenumbraRegistry(denom, chainId, penumbraRegistry);
    if (bridged) return bridged;
  }
  const match = cosmosAssetList
    .find(({ chain_name }) => chain_name === chainName)
    ?.assets.find(asset => asset.base === denom);

  return match ?? fallbackAsset(denom);
};

const fallbackAsset = (denom: string): Asset => {
  return {
    base: denom,
    denom_units: [{ denom, exponent: 0 }],
    display: denom,
    name: denom,
    symbol: denom,
    type_asset: 'sdk.coin',
  };
};

export const useBalances = () => {
  const { chainWallets, status } = useWallet();
  const { data: penumbraRegistry } = useRegistry();
  const result = useQueries({
    queries: chainWallets
      .filter(
        (
          chain,
        ): chain is ChainWalletBase & {
          get address(): string;
        } => chain.address !== undefined,
      )
      .map(chain => ({
        queryKey: ['cosmos-balances', status, chain.chainId, chain.address],
        queryFn: async () => {
          if (status !== WalletStatus.Connected && chainWallets.length === 0) {
            return [];
          }

          const balances = await fetchChainBalances(chain.address, chain);
          return balances.map(coin => {
            return {
              asset: augmentToAsset(
                coin.denom,
                chain.chainName,
                penumbraRegistry,
                chain.chainId,
              ),
              amount: coin.amount,
              chainId: chain.chainId,
            };
          });
        }, // Cap at 30s
        staleTime: 30 * 1000, // Consider data stale after 30 seconds
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
      })),
    combine: results => {
      return {
        data: results
          .map(result => result.data)
          .flat(2)
          .filter(Boolean) as { asset: Asset; amount: string; chainId: string }[],
        isLoading: results.some(result => result.isLoading),
        error: results.find(r => r.error !== null)?.error ?? null,
        refetch: () => Promise.all(results.map(result => result.refetch())),
      };
    },
  });

  return {
    balances: result.data,
    isLoading: result.isLoading && status === WalletStatus.Connected,
    error: result.error ? String(result.error) : null,
    refetch: result.refetch,
  };
};
