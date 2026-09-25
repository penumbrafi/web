'use client';

import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

/**
 * Snapshot of every asset the connected wallet has seen — including
 * synthesized metadata for LPNFTs (`lpnft_opened_*` / `_closed_` / `_withdrawn_`),
 * per-validator delegation tokens (`udelegation_<validator>`) and unbonding
 * tokens (`uunbonding_start_at_height_*_<validator>`) that are NOT in the chain
 * registry. Consumers that resolve metadata by asset id use this alongside the
 * registry so those synthesized tokens render with a real display denom
 * instead of falling through to "Unknown".
 *
 * The ViewService.assets stream returns AssetsResponse messages, each carrying
 * one Metadata; we drain the whole stream once per connection and expose a
 * base64(assetId.inner) → Metadata map.
 */
export const useWalletAssetsMap = () => {
  return useQuery<Map<string, Metadata>>({
    queryKey: ['walletAssets', connectionStore.subaccount],
    enabled: connectionStore.connected,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const out = new Map<string, Metadata>();
      for await (const item of penumbra.service(ViewService).assets({})) {
        const meta = item.denomMetadata;
        const inner = meta?.penumbraAssetId?.inner;
        if (!meta || !inner) {
          continue;
        }
        out.set(uint8ArrayToBase64(inner), meta);
      }
      return out;
    },
  });
};
