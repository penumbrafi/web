/**
 * USD prices from Penumbra's own DEX only, filtered so thin markets can't
 * invent value. Pure, so it is unit tested directly; `overview.ts` feeds it
 * pindexer's daily candles.
 *
 * Raw candles lie on a thin book: one trade at a silly price is a daily
 * close like any other (ZEC once "closed" at 1 UM per base unit, which read
 * as $416k), and a pair that trades daily in dust can outrank a real market.
 * So, starting from stables at $1:
 *
 * 1. A daily close only counts if that day's volume on the pair was worth
 *    at least MIN_DAY_USD, valued through the already-priced side.
 * 2. A close more than MAX_DEVIATION away from the median of its
 *    neighbours is dropped as a spike.
 * 3. A pair needs MIN_CLOSES closes left after that.
 * 4. Each asset is priced along the route whose thinnest pair carried the
 *    most USD volume (USDC -> UM -> ATOM -> stATOM), not "any stable pair
 *    first". Assets no such route reaches stay unpriced.
 */

/** One daily candle, display units: `base` priced in `quote`. */
export interface PricePoint {
  base: string;
  quote: string;
  timeMs: number;
  price: number;
  /** That day's volume, in display units of `base`. */
  volume: number;
}

/** A close of "asset priced in other", with the day's volume in `other`. */
interface Close {
  timeMs: number;
  price: number;
  volume: number;
}

export const MIN_CLOSES = 5;
export const MIN_DAY_USD = 25;
const MAX_DEVIATION = 3;
const MEDIAN_RADIUS = 3;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/**
 * Drop closes further than MAX_DEVIATION (as a ratio, either way) from the
 * median of the closes around them. Input ascending by time.
 */
export const dropSpikes = <T extends { price: number }>(closes: readonly T[]): T[] =>
  closes.filter((c, i) => {
    const window = closes
      .slice(Math.max(0, i - MEDIAN_RADIUS), i + MEDIAN_RADIUS + 1)
      .map(x => x.price);
    const m = median(window);
    return m > 0 && c.price / m <= MAX_DEVIATION && m / c.price <= MAX_DEVIATION;
  });

/** Last close at or before each time; before the first close, the first one. */
const sampleForward = (
  closes: readonly { timeMs: number; price: number }[],
  times: readonly number[],
): number[] => {
  const out: number[] = [];
  let i = 0;
  let current = closes[0]?.price ?? 0;
  for (const t of times) {
    while (i < closes.length && (closes[i]?.timeMs ?? Infinity) <= t) {
      current = closes[i]?.price ?? current;
      i++;
    }
    out.push(current);
  }
  return out;
};

/** Value of a series sampled at `times` (ascending) at time `t`: the last sample at or before it. */
const valueAt = (series: readonly number[], times: readonly number[], t: number): number => {
  let lo = 0;
  let hi = times.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((times[mid] ?? Infinity) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return series[found] ?? 0;
};

/**
 * USD price per display unit of every asset the filtered DEX graph reaches,
 * at each of `times` (ascending). Assets it can't price honestly are absent.
 */
export const dexUsdSeries = ({
  points,
  times,
  stables,
}: {
  points: readonly PricePoint[];
  times: readonly number[];
  stables: ReadonlySet<string>;
}): Map<string, number[]> => {
  // asset -> other -> closes of "asset priced in other", both directions,
  // each with the day's volume counted in `other`.
  const edges = new Map<string, Map<string, Close[]>>();
  const push = (asset: string, other: string, close: Close) => {
    if (!(close.price > 0) || !Number.isFinite(close.price) || asset === other) {
      return;
    }
    let byOther = edges.get(asset);
    if (!byOther) {
      byOther = new Map();
      edges.set(asset, byOther);
    }
    let list = byOther.get(other);
    if (!list) {
      list = [];
      byOther.set(other, list);
    }
    list.push(close);
  };
  for (const p of points) {
    push(p.base, p.quote, { timeMs: p.timeMs, price: p.price, volume: p.volume * p.price });
    push(p.quote, p.base, { timeMs: p.timeMs, price: 1 / p.price, volume: p.volume });
  }
  for (const byOther of edges.values()) {
    for (const list of byOther.values()) {
      list.sort((a, b) => a.timeMs - b.timeMs);
    }
  }

  const out = new Map<string, number[]>();
  const ones = times.map(() => 1);
  // Widest path from the stables, where a route is as good as the USD
  // volume of its thinnest pair. Assets are finalised best-first, so each
  // one's parent is already priced when its pairs are measured in USD.
  const quality = new Map<string, number>();
  const best = new Map<string, { closes: Close[]; via: string }>();
  for (const s of stables) {
    quality.set(s, Infinity);
  }
  const done = new Set<string>();
  for (;;) {
    let pick: string | undefined;
    for (const [asset, q] of quality) {
      if (!done.has(asset) && (pick === undefined || q > (quality.get(pick) ?? 0))) {
        pick = asset;
      }
    }
    if (pick === undefined) {
      break;
    }
    done.add(pick);
    const route = best.get(pick);
    const viaUsd = route ? out.get(route.via) : ones;
    if (!viaUsd) {
      continue;
    }
    const pickUsd = route
      ? sampleForward(route.closes, times).map((p, i) => p * (viaUsd[i] ?? 0))
      : ones;
    out.set(pick, pickUsd);

    const pickQ = quality.get(pick) ?? 0;
    for (const [asset, byOther] of edges) {
      const raw = byOther.get(pick);
      if (done.has(asset) || !raw) {
        continue;
      }
      const liquid = raw.filter(c => c.volume * valueAt(pickUsd, times, c.timeMs) >= MIN_DAY_USD);
      const closes = dropSpikes(liquid);
      if (closes.length < MIN_CLOSES) {
        continue;
      }
      const usdVolume = closes.reduce(
        (sum, c) => sum + c.volume * valueAt(pickUsd, times, c.timeMs),
        0,
      );
      const q = Math.min(pickQ, usdVolume);
      if (q > (quality.get(asset) ?? 0)) {
        quality.set(asset, q);
        best.set(asset, { closes, via: pick });
      }
    }
  }
  return out;
};
