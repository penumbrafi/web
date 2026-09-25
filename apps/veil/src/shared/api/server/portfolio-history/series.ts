/**
 * Pure helpers for the portfolio price history. No I/O, so they are unit
 * tested directly; `index.ts` feeds them pindexer rows.
 */

/** One candle close, already converted to display units: `base` priced in `quote`. */
export interface PricePoint {
  base: string;
  quote: string;
  timeMs: number;
  price: number;
}

/**
 * Samples a sparse, time-ordered price list at each of `times`, carrying the
 * last close forward. Before the first close the first known close is used
 * (a thin pair with one trade in range would otherwise read as worth 0 until
 * then). Returns undefined when there are no prices at all.
 */
export const sampleForward = (
  prices: { timeMs: number; price: number }[],
  times: number[],
): number[] | undefined => {
  const first = prices[0];
  if (!first) {
    return undefined;
  }
  const out: number[] = [];
  let i = 0;
  let current = first.price;
  for (const t of times) {
    while (i < prices.length && (prices[i]?.timeMs ?? Infinity) <= t) {
      current = prices[i]?.price ?? current;
      i++;
    }
    out.push(current);
  }
  return out;
};

/**
 * USD price per display unit of every asset reachable from an anchor, at each
 * sample time.
 *
 * - `stables` are pegged at 1.
 * - `um` is priced against whichever stable it has the most closes with.
 * - Everything else is priced against a stable if it trades against one,
 *   else against UM times UM's USD series.
 *
 * A close for (A in B) also gives (B in A) as its reciprocal, so both trade
 * directions count.
 */
export const buildUsdSeries = ({
  points,
  times,
  stables,
  um,
}: {
  points: PricePoint[];
  times: number[];
  stables: Set<string>;
  um: string;
}): Map<string, number[]> => {
  // asset -> anchor -> closes (both directions folded into "asset in anchor")
  const byAsset = new Map<string, Map<string, { timeMs: number; price: number }[]>>();
  const push = (asset: string, anchor: string, timeMs: number, price: number) => {
    if (!(price > 0) || !Number.isFinite(price)) {
      return;
    }
    let anchors = byAsset.get(asset);
    if (!anchors) {
      anchors = new Map();
      byAsset.set(asset, anchors);
    }
    let list = anchors.get(anchor);
    if (!list) {
      list = [];
      anchors.set(anchor, list);
    }
    list.push({ timeMs, price });
  };

  const isAnchor = (id: string) => id === um || stables.has(id);
  for (const p of points) {
    if (isAnchor(p.quote)) {
      push(p.base, p.quote, p.timeMs, p.price);
    }
    if (isAnchor(p.base)) {
      push(p.quote, p.base, p.timeMs, 1 / p.price);
    }
  }
  for (const anchors of byAsset.values()) {
    for (const list of anchors.values()) {
      list.sort((a, b) => a.timeMs - b.timeMs);
    }
  }

  const out = new Map<string, number[]>();
  const ones = times.map(() => 1);
  for (const s of stables) {
    out.set(s, ones);
  }

  const bestStable = (asset: string) => {
    let best: { timeMs: number; price: number }[] | undefined;
    for (const [anchor, list] of byAsset.get(asset) ?? []) {
      if (stables.has(anchor) && list.length > (best?.length ?? 0)) {
        best = list;
      }
    }
    return best;
  };

  const umCloses = bestStable(um);
  const umUsd = umCloses ? sampleForward(umCloses, times) : undefined;
  if (umUsd) {
    out.set(um, umUsd);
  }

  for (const asset of byAsset.keys()) {
    if (out.has(asset)) {
      continue;
    }
    const direct = bestStable(asset);
    if (direct) {
      const series = sampleForward(direct, times);
      if (series) {
        out.set(asset, series);
      }
      continue;
    }
    const viaUm = byAsset.get(asset)?.get(um);
    if (viaUm && umUsd) {
      const inUm = sampleForward(viaUm, times);
      if (inUm) {
        out.set(
          asset,
          inUm.map((p, i) => p * (umUsd[i] ?? 0)),
        );
      }
    }
  }
  return out;
};

/** `count` heights spread evenly over [from, to], deduplicated, ascending. */
export const sampleHeights = (from: number, to: number, count: number): number[] => {
  if (to <= from || count < 2) {
    return [to];
  }
  const out = new Set<number>();
  for (let i = 0; i < count; i++) {
    out.add(Math.round(from + ((to - from) * i) / (count - 1)));
  }
  return [...out].sort((a, b) => a - b);
};
