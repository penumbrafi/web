import type { UTCTimestamp } from 'lightweight-charts';
import { pnum } from '@penumbra-zone/types/pnum';
import type { Trace } from '@/shared/api/server/book/types';

export interface DepthPoint {
  time: UTCTimestamp;
  value: number;
  price: number;
}

export interface DepthSeriesData {
  bids: DepthPoint[];
  asks: DepthPoint[];
  mid: number;
  midTime: UTCTimestamp;
  // Maps integer time back to actual price for hover/click handlers.
  timeToPrice: (time: number) => number;
  // Maps a price to the integer time used by lightweight-charts.
  priceToTime: (price: number) => UTCTimestamp;
  minPrice: number;
  maxPrice: number;
}

const toNum = (s: string): number => pnum(s).toNumber();

/**
 * Build cumulative depth arrays from the route book.
 *
 * Input invariants from `useBook`:
 *   - `buy` is sorted DESCENDING by price (highest bid first).
 *   - `sell` is sorted ASCENDING by price... actually the route-book renders
 *     sells with highest at top so it's DESCENDING. The lowest sell is at the
 *     end of the array. We re-sort defensively below.
 *
 * We accumulate from the mid outward:
 *   - bids: going DOWN in price (highest bid → lowest), cumulative grows.
 *   - asks: going UP in price (lowest ask → highest), cumulative grows.
 *
 * For rendering we then sort each series ascending by price (chart X axis).
 */
export const buildDepthData = (
  buys: Trace[],
  sells: Trace[],
): DepthSeriesData | undefined => {
  if (!buys.length || !sells.length) {
    return undefined;
  }

  const bidsDesc = [...buys]
    .map(t => ({ price: toNum(t.price), total: toNum(t.total) }))
    .filter(p => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.total))
    .sort((a, b) => b.price - a.price);

  const asksAsc = [...sells]
    .map(t => ({ price: toNum(t.price), total: toNum(t.total) }))
    .filter(p => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.total))
    .sort((a, b) => a.price - b.price);

  if (!bidsDesc.length || !asksAsc.length) {
    return undefined;
  }

  const highestBid = bidsDesc[0]!.price;
  const lowestAsk = asksAsc[0]!.price;
  const mid = (highestBid + lowestAsk) / 2;

  // Cumulative bids walking from highest bid downward.
  let cumBid = 0;
  const bidsCum = bidsDesc.map(p => {
    cumBid += p.total;
    return { price: p.price, value: cumBid };
  });
  // Re-sort ascending for the chart (left → right by price).
  bidsCum.sort((a, b) => a.price - b.price);

  // Cumulative asks walking from lowest ask upward.
  let cumAsk = 0;
  const asksCum = asksAsc.map(p => {
    cumAsk += p.total;
    return { price: p.price, value: cumAsk };
  });

  const minPrice = bidsCum[0]!.price;
  const maxPrice = asksCum[asksCum.length - 1]!.price;

  // Map price → integer timestamp. Choose a scale that keeps adjacent
  // levels at least 1 unit apart while keeping the range comfortably
  // inside Number.MAX_SAFE_INTEGER.
  const span = Math.max(maxPrice - minPrice, Number.EPSILON);
  // Find the smallest gap between adjacent prices to size the scale.
  const allPrices = [...bidsCum.map(p => p.price), mid, ...asksCum.map(p => p.price)].sort(
    (a, b) => a - b,
  );
  let minGap = span;
  for (let i = 1; i < allPrices.length; i++) {
    const gap = allPrices[i]! - allPrices[i - 1]!;
    if (gap > 0 && gap < minGap) {minGap = gap;}
  }
  // Pick a scale large enough to keep adjacent levels distinct after
  // rounding, but capped so the resulting timestamps stay well within
  // Number.MAX_SAFE_INTEGER (2^53 - 1).
  const MAX_TIME = 1e12;
  const idealScale = Math.ceil(2 / minGap);
  const cappedScale = Math.min(idealScale, Math.floor(MAX_TIME / span));
  const scale = Math.max(1, cappedScale);
  const offset = 1; // keep timestamps strictly positive

  const priceToTime = (price: number): UTCTimestamp =>
    (Math.round((price - minPrice) * scale) + offset) as UTCTimestamp;
  const timeToPrice = (time: number): number => (time - offset) / scale + minPrice;
  const midTime = priceToTime(mid);

  // Build series points keyed on the integer timestamp. Deduplicate any
  // collisions caused by rounding by keeping the larger cumulative value
  // (the deeper-side reading) so the curve never decreases on its own side.
  const dedupe = (
    points: { price: number; value: number }[],
    pickHigher: boolean,
  ): DepthPoint[] => {
    const map = new Map<number, DepthPoint>();
    for (const p of points) {
      const t = priceToTime(p.price) as number;
      const existing = map.get(t);
      const next: DepthPoint = { time: t as UTCTimestamp, value: p.value, price: p.price };
      if (!existing) {
        map.set(t, next);
      } else if (pickHigher ? next.value > existing.value : next.value < existing.value) {
        map.set(t, next);
      }
    }
    return [...map.values()].sort((a, b) => (a.time as number) - (b.time as number));
  };

  // For bids on the chart (X ascending = lower → higher price), the
  // cumulative value DECREASES toward the mid (you have less depth as the
  // price gets close to the touch). On collision, prefer the LARGER value
  // (the deeper bid), which is the "outermost" reading at that pixel.
  const bids = dedupe(bidsCum, true);
  // For asks (X ascending = lower → higher price), value INCREASES outward.
  // On collision prefer the LARGER value too.
  const asks = dedupe(asksCum, true);

  // Drop each series to zero at the mid so the area visually closes off
  // inside the spread (the standard depth-chart shape). The bid area runs
  // from the left edge up to the mid; the ask area runs from the mid out
  // to the right edge. Use the integer timestamp just inside the spread.
  if (bids.length > 0) {
    const last = bids[bids.length - 1]!;
    const closeTime = ((midTime as number) > (last.time as number)
      ? (midTime as number)
      : (last.time as number) + 1) as UTCTimestamp;
    bids.push({ time: closeTime, value: 0, price: timeToPrice(closeTime as number) });
  }
  if (asks.length > 0) {
    const first = asks[0]!;
    const openTime = ((midTime as number) < (first.time as number)
      ? (midTime as number)
      : (first.time as number) - 1) as UTCTimestamp;
    asks.unshift({ time: openTime, value: 0, price: timeToPrice(openTime as number) });
  }

  return {
    bids,
    asks,
    mid,
    midTime,
    timeToPrice,
    priceToTime,
    minPrice,
    maxPrice,
  };
};
