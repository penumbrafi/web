import { useCallback } from 'react';
import { useRegistry, useRegistryAssets } from '@/shared/api/registry';
import { AssetId, Metadata, Denom } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';
import { useWalletAssetsMap } from '@/shared/api/wallet-assets';

/**
 * Returns the `Metadata[]` based on the provider connection state.
 **/
export const useAssets = () => {
  return useRegistryAssets();
};

export type GetMetadata = (assetId?: AssetId | Denom) => Metadata | undefined;

export const isDenom = (value?: Denom | AssetId): value is Denom =>
  value?.getType().typeName === Denom.typeName;

/**
 * A hook that returns a synchronous function for querying the metadata by assetId.
 * Needed for an optimized client-side asset fetching.
 *
 * Stabilized via useCallback so consumers can pass it as a useMemo / useEffect
 * dep without busting on every parent render — the previous closure form
 * returned a fresh arrow per render which silently invalidated downstream
 * memos (e.g. displayPositions in PositionsTable, the chart's getMetadata
 * threading).
 */
export const useGetMetadata = (): GetMetadata => {
  const registry = useRegistry().data;
  // Wallet-provided metadata covers synthesized denoms the chain registry
  // never lists — LPNFTs (`lpnft_opened_*` etc), per-validator delegation
  // tokens and unbonding tokens. Without this fallback the tx history
  // renders those as "Unknown"; with it the LPNFT filter in
  // TransactionSummary/adapt-effects can kick in and the delegation /
  // unbonding tokens show a real display denom.
  const walletAssets = useWalletAssetsMap().data;
  return useCallback(
    x => {
      if (!x) return undefined;
      const registryHit = registry.tryGetMetadata(x);
      if (registryHit) return registryHit;
      if (!walletAssets) return undefined;
      // Only AssetId (not Denom) is keyable in the wallet map.
      if ('inner' in x && x.inner instanceof Uint8Array) {
        return walletAssets.get(uint8ArrayToBase64(x.inner));
      }
      return undefined;
    },
    [registry, walletAssets],
  );
};
