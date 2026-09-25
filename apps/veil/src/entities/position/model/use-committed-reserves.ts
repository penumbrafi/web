import { useMemo } from 'react';
import { PositionState_PositionStateEnum } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { connectionStore } from '@/shared/model/connection';
import { usePositions } from '@/entities/position/api/use-positions';

interface AssetLite {
  penumbraAssetId?: AssetId;
  exponent: number;
}

/**
 * Sum the user's currently OPENED position reserves in a specific pair,
 * returned as display-units for the two sides in the caller's orientation.
 *
 * Reads `position.reserves.r1/r2` directly (canonical asset1/asset2
 * ordering on the position) and re-orients to the caller's (base, quote)
 * pair — flipping when the position's canonical asset1 turns out to be
 * the caller's quote. Skips positions in any state other than OPENED so
 * closed-but-not-yet-withdrawn reserves don't get counted twice against
 * the wallet.
 *
 * Used by the LP "Suggest position" button so a user with existing LP
 * exposure in this pair gets a *delta* suggestion (target minus already
 * committed), not a naive 10% of liquid balance that ratchets down on
 * every subsequent click.
 */
export const useCommittedReserves = (
  base: AssetLite | undefined,
  quote: AssetLite | undefined,
): { base: number; quote: number } => {
  const { subaccount, connected } = connectionStore;
  const { data } = usePositions(subaccount, [PositionState_PositionStateEnum.OPENED]);

  return useMemo(() => {
    const empty = { base: 0, quote: 0 };
    if (!connected || !base?.penumbraAssetId || !quote?.penumbraAssetId || !data?.pages) {
      return empty;
    }
    let baseSum = 0n;
    let quoteSum = 0n;

    for (const page of data.pages) {
      for (const position of page.values()) {
        const pair = position.phi?.pair;
        const r1 = position.reserves?.r1;
        const r2 = position.reserves?.r2;
        if (!pair?.asset1 || !pair.asset2 || !r1 || !r2) {continue;}

        const canonical =
          pair.asset1.equals(base.penumbraAssetId) && pair.asset2.equals(quote.penumbraAssetId);
        const flipped =
          pair.asset2.equals(base.penumbraAssetId) && pair.asset1.equals(quote.penumbraAssetId);
        if (!canonical && !flipped) {continue;}

        // Positions in a pair always share canonical ordering on-chain
        // (asset1 < asset2 by id) so each match maps r1/r2 to the
        // caller's (base, quote) orientation via a per-position flip
        // rather than sniffing orientation from the first hit.
        if (canonical) {
          baseSum += joinLoHiAmount(r1);
          quoteSum += joinLoHiAmount(r2);
        } else {
          baseSum += joinLoHiAmount(r2);
          quoteSum += joinLoHiAmount(r1);
        }
      }
    }

    return {
      base: Number(baseSum) / Math.pow(10, base.exponent),
      quote: Number(quoteSum) / Math.pow(10, quote.exponent),
    };
  }, [data, connected, base?.penumbraAssetId, base?.exponent, quote?.penumbraAssetId, quote?.exponent]);
};
