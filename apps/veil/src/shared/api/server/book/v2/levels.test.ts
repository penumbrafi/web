import { describe, expect, it } from 'vitest';
import {
  aggregateLevels,
  bucketPrice,
  defaultStep,
  levelPriceString,
  pageLevels,
  snapStep,
  stepForPct,
  touchPrice,
  type RawOrder,
} from './levels';

describe('snapStep', () => {
  it('snaps down onto the 1/2/2.5/5 x 10^n grid', () => {
    expect(snapStep(0.001)).toBe(0.001);
    expect(snapStep(0.0019)).toBe(0.001);
    expect(snapStep(0.0021)).toBe(0.002);
    expect(snapStep(0.0026)).toBe(0.0025);
    expect(snapStep(0.0049)).toBe(0.0025);
    expect(snapStep(0.0099)).toBe(0.005);
    expect(snapStep(37)).toBe(25);
  });

  it('is 0 for nothing to snap', () => {
    expect(snapStep(0)).toBe(0);
    expect(snapStep(-1)).toBe(0);
    expect(snapStep(NaN)).toBe(0);
  });

  it('keeps the default step stable while the mid wanders', () => {
    // ~0.1% of 4.0 .. 4.9 all snap to the same width, so ETags/cursors hold.
    const steps = [4.0, 4.2, 4.5, 4.9].map(defaultStep);
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBe(0.0025);
  });

  it('is raw (0) without a reference price', () => {
    expect(defaultStep(undefined)).toBe(0);
    expect(stepForPct(undefined, 1)).toBe(0);
  });
});

describe('bucketPrice', () => {
  it('floors bids and ceils asks (never shows a better price than offered)', () => {
    expect(bucketPrice(1.237, 0.01, 'bid')).toBe(1.23);
    expect(bucketPrice(1.231, 0.01, 'ask')).toBe(1.24);
  });

  it('keeps a price on a boundary in its own bucket despite float noise', () => {
    expect(bucketPrice(1.23, 0.01, 'bid')).toBe(1.23);
    expect(bucketPrice(1.23, 0.01, 'ask')).toBe(1.23);
    expect(bucketPrice(0.3, 0.1, 'ask')).toBe(0.3);
  });

  it('only de-noises when raw', () => {
    expect(bucketPrice(0.1 + 0.2, 0, 'bid')).toBe(0.3);
  });
});

const bids: RawOrder[] = [
  { price: 0.995, amount: 1 },
  { price: 0.999, amount: 2 },
  { price: 0.9985, amount: 3 },
  { price: 0.9, amount: 4 },
  { price: 0, amount: 9 }, // degenerate
  { price: 0.8, amount: 0 }, // drained
];
const asks: RawOrder[] = [
  { price: 1.0011, amount: 5 },
  { price: 1.0019, amount: 1 },
  { price: 1.2, amount: 2 },
];

describe('aggregateLevels', () => {
  it('orders bids descending from the touch with a cumulative total', () => {
    const levels = aggregateLevels(bids, 0, 'bid');
    expect(levels.map(l => l.price)).toEqual([0.999, 0.9985, 0.995, 0.9]);
    expect(levels.map(l => l.total)).toEqual([2, 5, 6, 10]);
    expect(levels.every(l => l.count === 1)).toBe(true);
  });

  it('merges a bucket and counts its positions', () => {
    const levels = aggregateLevels(bids, 0.001, 'bid');
    // 0.999 stays its own bucket on the boundary; 0.9985 floors to 0.998.
    expect(levels[0]).toEqual({ price: 0.999, amount: 2, total: 2, count: 1 });
    expect(levels[1]).toEqual({ price: 0.998, amount: 3, total: 5, count: 1 });
    const coarse = aggregateLevels(bids, 0.01, 'bid');
    expect(coarse[0]).toEqual({ price: 0.99, amount: 6, total: 6, count: 3 });
  });

  it('orders asks ascending and buckets them up', () => {
    const levels = aggregateLevels(asks, 0.001, 'ask');
    expect(levels.map(l => l.price)).toEqual([1.002, 1.2]);
    expect(levels[0]).toMatchObject({ amount: 6, count: 2, total: 6 });
    expect(levels[1]?.total).toBe(8);
  });

  it('drops a bid bucket that floors to zero', () => {
    expect(aggregateLevels([{ price: 0.004, amount: 1 }], 0.01, 'bid')).toEqual([]);
  });
});

describe('pageLevels', () => {
  const levels = aggregateLevels(
    Array.from({ length: 45 }, (_, i) => ({ price: 100 - i, amount: 1 })),
    0,
    'bid',
  );

  it('starts at the touch and hands back a price cursor', () => {
    const page = pageLevels(levels, 'bid', undefined, 20);
    expect(page.rows).toHaveLength(20);
    expect(page.rows[0]?.price).toBe(100);
    expect(page.nextCursor).toBe(81);
  });

  it('continues strictly beyond the cursor, totals still from the touch', () => {
    const page = pageLevels(levels, 'bid', 81, 20);
    expect(page.rows[0]?.price).toBe(80);
    expect(page.rows[0]?.total).toBe(21);
    expect(page.nextCursor).toBe(61);
    const last = pageLevels(levels, 'bid', 61, 20);
    expect(last.rows).toHaveLength(5);
    expect(last.nextCursor).toBeUndefined();
  });

  it('is empty past the end, and for a cursor between levels resumes after it', () => {
    expect(pageLevels(levels, 'bid', 56, 20).rows).toEqual([]);
    expect(pageLevels(levels, 'bid', 80.5, 2).rows.map(l => l.price)).toEqual([80, 79]);
  });

  it('pages asks upward', () => {
    const askLevels = aggregateLevels(
      Array.from({ length: 5 }, (_, i) => ({ price: 1 + i / 10, amount: 1 })),
      0,
      'ask',
    );
    const first = pageLevels(askLevels, 'ask', undefined, 2);
    expect(first.rows.map(l => l.price)).toEqual([1, 1.1]);
    expect(first.nextCursor).toBe(1.1);
    // A cursor that went through a query string still matches.
    const second = pageLevels(askLevels, 'ask', Number(String(first.nextCursor)), 2);
    expect(second.rows.map(l => l.price)).toEqual([1.2, 1.3]);
  });

  it('marks an exactly-full last page as the end', () => {
    const page = pageLevels(levels, 'bid', 61, 5);
    expect(page.rows).toHaveLength(5);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('touchPrice / levelPriceString', () => {
  it('reads the raw touch, ignoring drained orders', () => {
    expect(touchPrice(bids, 'bid')).toBe(0.999);
    expect(touchPrice(asks, 'ask')).toBe(1.0011);
    expect(touchPrice([], 'ask')).toBeUndefined();
  });

  it('never emits exponent notation', () => {
    expect(levelPriceString(1e-7)).toBe('0.0000001');
    expect(levelPriceString(1.5)).toBe('1.5');
  });
});
