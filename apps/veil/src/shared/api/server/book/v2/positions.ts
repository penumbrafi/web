import BigNumber from 'bignumber.js';
import {
  Position,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import type { BookSide, RawOrder } from './levels.ts';

// Division precision: the default 20 decimal places truncates raw prices on
// pairs with a large exponent gap (18-decimal base vs 6-decimal quote gives
// raw prices around 1e-12), so use a local constructor with headroom.
const BN = BigNumber.clone({ DECIMAL_PLACES: 40 });
const raw = (v: Parameters<typeof pnum>[0]): BigNumber => new BN(pnum(v).toBigNumber().toFixed());

export interface PairAssets {
  base: AssetId;
  quote: AssetId;
  baseExponent: number;
  quoteExponent: number;
}

/**
 * A position's offer on one side of the base/quote book, in display units.
 *
 * pd's trading function is `phi(R) = p·R1 + q·R2` over the canonical pair
 * (asset_1 < asset_2): one unit of asset_1 is worth p/q of asset_2 before
 * fees, and the fee `f` (bps) scales by gamma = (10000 - f) / 10000 against
 * the trader in both directions (see get-calculated-assets.ts, and
 * `BareTradingFunction::effective_price` in pd). Orient so asset_1' = base:
 *   - ask (the position SELLS base for quote): price = p'/(q'·gamma),
 *     amount = its base reserve r1'.
 *   - bid (the position BUYS base with quote): price = p'·gamma/q', and the
 *     base it can absorb is its quote reserve converted at that price,
 *     r2'·q'/(p'·gamma).
 * p, q and the reserves are raw integer units, so the price is scaled by
 * 10^(baseExp - quoteExp) and the amount divided by 10^baseExp. The maths
 * stays in BigNumber (reserves are u128) and drops to a double only at the
 * end, which is plenty for display.
 */
export const positionToOrder = (
  position: Position,
  side: BookSide,
  assets: PairAssets,
): RawOrder | undefined => {
  const phi = position.phi;
  const component = phi?.component;
  const pair = phi?.pair;
  if (!component || !pair?.asset1 || !pair.asset2 || !position.reserves) {
    return undefined;
  }
  // The price index only holds open positions, but a stream can race a
  // close; never show a closed/withdrawn position's leftovers.
  if (position.state && position.state.state !== PositionState_PositionStateEnum.OPENED) {
    return undefined;
  }

  let baseIsAsset1: boolean;
  if (pair.asset1.equals(assets.base) && pair.asset2.equals(assets.quote)) {
    baseIsAsset1 = true;
  } else if (pair.asset2.equals(assets.base) && pair.asset1.equals(assets.quote)) {
    baseIsAsset1 = false;
  } else {
    return undefined;
  }

  const p = raw(component.p);
  const q = raw(component.q);
  const r1 = raw(position.reserves.r1);
  const r2 = raw(position.reserves.r2);
  const [pB, qB, rBase, rQuote] = baseIsAsset1 ? [p, q, r1, r2] : [q, p, r2, r1];
  if (pB.lte(0) || qB.lte(0)) {
    return undefined;
  }
  const gamma = new BN(10_000 - component.fee).dividedBy(10_000);
  if (gamma.lte(0)) {
    return undefined;
  }

  const priceScale = new BN(10).pow(assets.baseExponent - assets.quoteExponent);
  const baseScale = new BN(10).pow(assets.baseExponent);

  if (side === 'ask') {
    if (rBase.lte(0)) {
      return undefined;
    }
    const rawPrice = pB.dividedBy(qB.times(gamma));
    return {
      price: rawPrice.times(priceScale).toNumber(),
      amount: rBase.dividedBy(baseScale).toNumber(),
    };
  }
  if (rQuote.lte(0)) {
    return undefined;
  }
  const rawPrice = pB.times(gamma).dividedBy(qB);
  return {
    price: rawPrice.times(priceScale).toNumber(),
    amount: rQuote.dividedBy(rawPrice).dividedBy(baseScale).toNumber(),
  };
};
