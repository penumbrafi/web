import type { Trace } from '@/shared/api/server/book/types';

/**
 * Cumulative-depth bar widths, keyed by row price.
 *
 * The row background bar always reads as a depth-curve staircase — bar
 * length at each row equals the cumulative inventory from the touch
 * outward, normalized so the deepest visible row fills the whole
 * background. This is the MEXC / Binance / OKX default depth tint, and
 * it stays true regardless of whether the `Total` column shows per-level
 * or cumulative *numbers* (that's the `1:1 / Σ` toggle, decoupled from
 * the bar shape).
 *
 * Rows come in display order: sells top-down (worst price first, best at
 * spread), buys top-down (best bid first). Cumulation walks *from the
 * spread outward*, so `side` picks the iteration direction.
 */
export const calculateCumulativeDepthByPrice = (
  orders: Trace[],
  side: 'sell' | 'buy',
): Map<string, number> => {
  if (!orders.length) {
    return new Map();
  }
  const cum = new Array<number>(orders.length);
  let running = 0;
  if (side === 'sell') {
    // sells: worst price at top (idx 0), best at spread (idx n-1) → walk up
    for (let i = orders.length - 1; i >= 0; i--) {
      running += parseFloat(orders[i]?.total ?? '0');
      cum[i] = running;
    }
  } else {
    // buys: best bid at top (idx 0), worst at bottom → walk down
    for (const [i, order] of orders.entries()) {
      running += parseFloat(order.total);
      cum[i] = running;
    }
  }
  const maxCum = running;
  const out = new Map<string, number>();
  if (maxCum <= 0) {
    return out;
  }
  for (const [i, order] of orders.entries()) {
    out.set(order.price, ((cum[i] ?? 0) / maxCum) * 100);
  }
  return out;
};
