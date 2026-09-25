import { pnum } from '@penumbra-zone/types/pnum';
import type { Trace } from '@/shared/api/server/book/types';

export interface FillSimulation {
  filledBaseAmount: number;
  quoteSpent: number;
  avgPrice: number;
  // Per-consumed-level: what fraction of that level's inventory got taken
  // (0..1). Keyed by the trace's `price` field so consumers can look up
  // a row's fill without repeating the walk. If a level is missing here
  // the row is untouched by this order.
  fills: Map<string, number>;
  requestedBaseAmount: number;
  fullyFilled: boolean;
}

/**
 * Walk the book and compute what a market order of `baseAmount` in the
 * given direction would consume. For buys we consume asks best-first
 * (lowest price → higher); for sells we consume bids best-first (highest
 * price → lower).
 *
 * `buyRows` and `sellRows` are the raw multiHops arrays: both sorted
 * DESCENDING by price. So the best ask is at `sellRows[sellRows.length-1]`
 * and we iterate that end backward; the best bid is at `buyRows[0]` and we
 * iterate forward.
 */
export const simulateMarketBase = (
  direction: 'buy' | 'sell',
  baseAmount: number,
  buyRows: Trace[],
  sellRows: Trace[],
): FillSimulation | undefined => {
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {return undefined;}
  if (!buyRows.length && !sellRows.length) {return undefined;}

  const walk: Trace[] =
    direction === 'buy' ? [...sellRows].reverse() : buyRows;

  const fills = new Map<string, number>();
  let remaining = baseAmount;
  let quoteAcc = 0;

  for (const row of walk) {
    if (remaining <= 0) {break;}
    const avail = pnum(row.amount).toNumber();
    const price = pnum(row.price).toNumber();
    if (!Number.isFinite(avail) || !Number.isFinite(price) || avail <= 0 || price <= 0) {
      continue;
    }
    const taken = Math.min(avail, remaining);
    const fraction = taken / avail;
    // If a bucketed row appears twice (shouldn't, but be defensive) keep
    // the larger fill fraction.
    const prior = fills.get(row.price);
    if (prior === undefined || fraction > prior) {fills.set(row.price, fraction);}
    quoteAcc += taken * price;
    remaining -= taken;
  }

  const filled = baseAmount - remaining;
  return {
    filledBaseAmount: filled,
    quoteSpent: quoteAcc,
    avgPrice: filled > 0 ? quoteAcc / filled : 0,
    fills,
    requestedBaseAmount: baseAmount,
    // 1 ppm tolerance so floating-point noise on the last row doesn't
    // read as "not fully filled".
    fullyFilled: remaining <= baseAmount * 1e-6,
  };
};
