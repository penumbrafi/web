import { pnum } from '@penumbra-zone/types/pnum';
import type { Trace } from '@/shared/api/server/book/types';

export type TradeDirection = 'buy' | 'sell';

/** Why the walk over the book ended. */
export type ReachStop =
  /** A level on the far side of the target was found: everything up to the target was taken. */
  | 'target'
  /** The caller's budget ran out first. */
  | 'budget'
  /** The visible side ran out before the target. */
  | 'book';

export interface ReachPriceFill {
  /** Base-asset amount taken, in display units. */
  baseAmount: number;
  /** Quote-asset amount spent (buy) or received (sell), in display units. */
  quoteAmount: number;
  /** `quoteAmount / baseAmount` — the average fill price. Zero when nothing filled. */
  avgPrice: number;
  /** The last level the order touches, in quote per base. Zero when nothing filled. */
  worstPrice: number;
  stoppedBy: ReachStop;
}

const EMPTY: ReachPriceFill = {
  baseAmount: 0,
  quoteAmount: 0,
  avgPrice: 0,
  worstPrice: 0,
  stoppedBy: 'book',
};

/**
 * Walk the book and size a market order so that its *worst* fill is the
 * target price — the "market order, limited to that price" march.
 *
 * The inverse of `route-book/simulation.ts::simulateMarketBase`, which asks
 * "what does this size consume". This asks "what size reaches this price",
 * which is what a trader wants when they think in price rather than amount.
 *
 * Level ordering is the invariant `simulateMarketBase` relies on: both sides
 * arrive DESCENDING by price, so the best ask is the LAST sell row and the
 * best bid is the FIRST buy row. Pinned by `slice-book.test.ts`.
 *
 * `budget` is the input asset's ceiling — quote for a buy, base for a sell —
 * or `Infinity` to size purely against the book.
 *
 * Holds no opinion about whether a Penumbra `Swap` can actually enforce the
 * target on-chain: it cannot (see `SwapBody` — no price field). Sizing is the
 * only lever, so this is where "limited to that price" is implemented, and
 * the caller is responsible for saying so out loud.
 */
export const reachPrice = (
  direction: TradeDirection,
  targetPrice: number,
  budget: number,
  buyRows: Trace[],
  sellRows: Trace[],
): ReachPriceFill => {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || !(budget > 0)) {
    return EMPTY;
  }

  const isBuy = direction === 'buy';
  const length = isBuy ? sellRows.length : buyRows.length;

  let baseAmount = 0;
  let quoteAmount = 0;
  let worstPrice = 0;
  let left = budget;
  let exhausted = true;
  let stoppedBy: ReachStop = 'book';

  for (let i = 0; i < length; i++) {
    const row = isBuy ? sellRows[length - 1 - i] : buyRows[i];
    if (!row) {
      continue;
    }
    const price = pnum(row.price).toNumber();
    const available = pnum(row.amount).toNumber();
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(available) || available <= 0) {
      continue;
    }

    // The target is the worst price this order may touch: asks at or below
    // it when buying, bids at or above it when selling. A level past the
    // target means the target sits inside the range already taken — stop
    // *before* consuming it rather than overshooting through it.
    if (isBuy ? price > targetPrice : price < targetPrice) {
      exhausted = false;
      stoppedBy = 'target';
      break;
    }

    // What the remaining budget still covers, in base units.
    const affordable = isBuy ? left / price : left;
    const take = Math.min(available, affordable);
    baseAmount += take;
    quoteAmount += take * price;
    worstPrice = price;
    left -= isBuy ? take * price : take;

    if (left <= 0) {
      exhausted = false;
      stoppedBy = 'budget';
      break;
    }
  }

  // The side ran out without a far-side level to bound the walk. The target
  // is then only "reached" if the deepest level taken sits at it (or past
  // it, which the level filter above would have caught) — otherwise the
  // order took everything visible and still fell short.
  if (exhausted) {
    const deepest = worstPrice;
    const reachedByDepth = isBuy ? deepest >= targetPrice : deepest <= targetPrice;
    stoppedBy = reachedByDepth ? 'target' : 'book';
  }

  return {
    baseAmount,
    quoteAmount,
    avgPrice: baseAmount > 0 ? quoteAmount / baseAmount : 0,
    worstPrice,
    stoppedBy,
  };
};
