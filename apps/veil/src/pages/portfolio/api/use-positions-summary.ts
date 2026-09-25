import { useQuery } from '@tanstack/react-query';
import { DexService, ViewService } from '@penumbra-zone/protobuf';
import {
  Position,
  PositionId,
  PositionState,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';
import { joinLoHi } from '@penumbra-zone/types/lo-hi';

export interface AssetTotal {
  assetId: AssetId;
  /** Raw base-denom amount summed as a bigint. */
  amount: bigint;
}

/**
 * Total reserves across every position that matches `states`, summed
 * per-asset. Consumers turn each entry into a ValueView with the asset's
 * metadata + display exponent to render whole units.
 *
 * Unlike `usePositions`, this is a one-shot fetch — no pagination — so the
 * totals reflect the full position set, not just what's been scrolled into
 * view. On a wallet with a lot of positions this is the price of showing
 * accurate capital numbers on the portfolio card; the network payload is
 * IDs-only for the ownedPositionIds stream, plus one batch RPC.
 */
export const usePositionsSummary = (
  subaccount = 0,
  states: PositionState_PositionStateEnum[],
) => {
  return useQuery<AssetTotal[]>({
    // Prefixed with 'positions' so updatePositionsQuery (which does
    // refetchQueries({ queryKey: ['positions'] })) also refreshes the
    // summary card after close/withdraw. Without this the card sits on
    // stale reserves until the user manually refetches.
    queryKey: ['positions', 'summary', subaccount, states],
    enabled: connectionStore.connected && states.length > 0,
    queryFn: async () => {
      const positionIds: PositionId[] = [];
      for (const state of states) {
        for await (const item of penumbra.service(ViewService).ownedPositionIds({
          subaccount: new AddressIndex({ account: subaccount }),
          positionState: new PositionState({ state }),
        })) {
          if (item.positionId) {positionIds.push(item.positionId);}
        }
      }

      if (!positionIds.length) {return [];}

      const responses = await Array.fromAsync(
        penumbra.service(DexService).liquidityPositionsById({ positionId: positionIds }),
      );
      const positions = responses.map(r => r.data).filter(Boolean) as Position[];

      const totalsByAssetKey = new Map<string, AssetTotal>();
      const bump = (assetId: AssetId | undefined, raw: bigint) => {
        if (!assetId?.inner || raw === 0n) {return;}
        const key = uint8ArrayToBase64(assetId.inner);
        const existing = totalsByAssetKey.get(key);
        if (existing) {
          existing.amount += raw;
        } else {
          totalsByAssetKey.set(key, { assetId, amount: raw });
        }
      };

      for (const p of positions) {
        const pair = p.phi?.pair;
        const r1 = p.reserves?.r1;
        const r2 = p.reserves?.r2;
        if (pair?.asset1 && r1) {
          bump(pair.asset1, joinLoHi(r1.lo, r1.hi));
        }
        if (pair?.asset2 && r2) {
          bump(pair.asset2, joinLoHi(r2.lo, r2.hi));
        }
      }

      return [...totalsByAssetKey.values()];
    },
  });
};
