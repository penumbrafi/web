import BigNumber from 'bignumber.js';

// Pure price-level logic for /api/book/v2: bucketing, paging and cursors.
// No next/server or pd imports, so the client can reuse the same bucket
// maths (row highlight keys) and vitest can exercise it directly.

export type BookSide = 'bid' | 'ask';

/** One position's offer on one side, in display units (amount in base). */
export interface RawOrder {
  price: number;
  amount: number;
}

/** An aggregated price level as sent on the wire. */
export interface BookLevel {
  price: number;
  /** Base available at this level. */
  amount: number;
  /** Cumulative base from the touch through this level (across pages). */
  total: number;
  /** Positions contributing to this level. */
  count: number;
}

// Doubles carry ~15-17 significant digits; rounding bucket prices to 12 and
// raw prices to 10 keeps float noise (0.30000000000000004, two positions
// with the same p/q landing 1ulp apart) from minting separate levels or
// breaking cursor equality.
const BUCKET_PRECISION = 12;
const RAW_PRECISION = 10;
const roundTo = (n: number, digits: number): number => Number(n.toPrecision(digits));

// Default bucket width as a fraction of the reference price (~0.1%).
export const DEFAULT_STEP_FRACTION = 0.001;
// Bucket widths are snapped onto a {1, 2, 2.5, 5} x 10^n grid. An unsnapped
// `mid * pct` step moves every block, which would change every bucket
// boundary, every cursor and every ETag per block, and reset the client's
// loaded pages each time. Snapped, it only moves when the mid crosses a
// grid point.
const STEP_MANTISSAS = [1, 2, 2.5, 5, 10] as const;

/** Snap a positive width to the nearest-below "nice" step; 0 for none. */
export const snapStep = (raw: number): number => {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  const exp = Math.floor(Math.log10(raw));
  const scale = 10 ** exp;
  const mantissa = raw / scale;
  let picked: number = STEP_MANTISSAS[0];
  for (const m of STEP_MANTISSAS) {
    // Tolerance so 0.001 (mantissa 0.99999...) still snaps to 1e-3.
    if (m <= mantissa * (1 + 1e-9)) {
      picked = m;
    }
  }
  return roundTo(picked * scale, BUCKET_PRECISION);
};

/** Step for `pct` percent of `ref`, snapped; 0 (raw) when unknown. */
export const stepForPct = (ref: number | undefined, pct: number): number =>
  ref !== undefined && ref > 0 && pct > 0 ? snapStep(ref * (pct / 100)) : 0;

export const defaultStep = (ref: number | undefined): number =>
  stepForPct(ref, DEFAULT_STEP_FRACTION * 100);

/**
 * The bucket a price lands in. Bids round DOWN and asks round UP, so a
 * bucketed level never advertises a better price than the positions in it
 * actually offer. `step <= 0` means raw prices (only float-noise rounding).
 */
export const bucketPrice = (price: number, step: number, side: BookSide): number => {
  if (!(step > 0)) {
    return roundTo(price, RAW_PRECISION);
  }
  // Nudge by a relative epsilon so a price sitting exactly on a boundary
  // (1.23 / 0.01 = 122.99999999999999) stays in its own bucket.
  const ratio = price / step;
  const idx = side === 'bid' ? Math.floor(ratio * (1 + 1e-9)) : Math.ceil(ratio * (1 - 1e-9));
  return roundTo(idx * step, BUCKET_PRECISION);
};

/** Best-first comparator: bids descend from the touch, asks ascend. */
const bestFirst = (side: BookSide) => (a: number, b: number) => (side === 'bid' ? b - a : a - b);

/**
 * Aggregate raw orders into levels, best-first, with `total` cumulative
 * from the touch. Orders with a non-positive or non-finite price/amount are
 * dropped (a drained position, a degenerate p/q).
 */
export const aggregateLevels = (orders: RawOrder[], step: number, side: BookSide): BookLevel[] => {
  const byPrice = new Map<number, BookLevel>();
  for (const o of orders) {
    if (!Number.isFinite(o.price) || !Number.isFinite(o.amount) || o.price <= 0 || o.amount <= 0) {
      continue;
    }
    const price = bucketPrice(o.price, step, side);
    // A bid bucket can floor to 0 when step > price; it isn't a real price.
    if (!(price > 0)) {
      continue;
    }
    const level = byPrice.get(price);
    if (level) {
      level.amount += o.amount;
      level.count += 1;
    } else {
      byPrice.set(price, { price, amount: o.amount, total: 0, count: 1 });
    }
  }
  const cmp = bestFirst(side);
  const levels = [...byPrice.values()].sort((a, b) => cmp(a.price, b.price));
  let running = 0;
  for (const l of levels) {
    running += l.amount;
    l.total = running;
  }
  return levels;
};

/** Whether `price` lies strictly beyond `cursor`, moving away from the touch. */
const isBeyond = (price: number, cursor: number, side: BookSide): boolean => {
  // Relative tolerance: the cursor round-trips through JSON / a query
  // string, so compare with slack rather than exact float equality.
  const eps = Math.abs(cursor) * 1e-9;
  return side === 'bid' ? price < cursor - eps : price > cursor + eps;
};

export interface LevelPage {
  rows: BookLevel[];
  /** Price to continue from; absent when this page reaches the end of the side. */
  nextCursor?: number;
}

/**
 * One page of a side: the first `count` levels strictly beyond `cursor`
 * (from the touch when no cursor). The cursor is a PRICE, not an offset, so
 * a page fetched after the book moved still continues from the right place
 * instead of skipping or repeating the levels that shifted.
 */
export const pageLevels = (
  levels: BookLevel[],
  side: BookSide,
  cursor: number | undefined,
  count: number,
): LevelPage => {
  const start = cursor === undefined ? 0 : levels.findIndex(l => isBeyond(l.price, cursor, side));
  if (start < 0) {
    return { rows: [] };
  }
  const rows = levels.slice(start, start + count);
  const last = rows[rows.length - 1];
  const more = start + count < levels.length;
  return more && last ? { rows, nextCursor: last.price } : { rows };
};

/** Best raw (unbucketed) price on a side, if any. */
export const touchPrice = (orders: RawOrder[], side: BookSide): number | undefined => {
  let best: number | undefined;
  for (const o of orders) {
    if (!(o.price > 0) || !(o.amount > 0) || !Number.isFinite(o.price)) {
      continue;
    }
    if (best === undefined || (side === 'bid' ? o.price > best : o.price < best)) {
      best = o.price;
    }
  }
  return best;
};

/**
 * Plain decimal string for a level price (never exponent notation, which
 * `String(1e-7)` would give and the ladder's formatter can't read). Used as
 * the ladder's row key, so the client derives highlight keys with it too.
 */
export const levelPriceString = (price: number): string => new BigNumber(price).toFixed();
