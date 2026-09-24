import { describe, expect, it } from 'vitest';
import { sliceBook } from './index';
import type { RouteBookResponseJson, TraceJson } from './types';

const t = (price: number, hops: number): TraceJson => ({
  price: String(price),
  amount: '1',
  total: '1',
  hops: Array.from({ length: hops }, () => ({})),
});

// Best-price-first on both sides, as processSimulation emits them.
const buy = Array.from({ length: 100 }, (_, i) => t(100 - i, i % 3 === 0 ? 2 : 3));
const sell = Array.from({ length: 100 }, (_, i) => t(101 + i, i % 2 === 0 ? 2 : 4));
const full: RouteBookResponseJson = {
  singleHops: { buy: buy.filter(x => x.hops.length === 2), sell: sell.filter(x => x.hops.length === 2) },
  multiHops: { buy, sell },
};

describe('sliceBook', () => {
  it('returns the stored book untouched at the compute limit', () => {
    expect(sliceBook(full, 100)).toBe(full);
  });

  it('matches what a limit-30 compute produced: best 30, singles filtered from those', () => {
    const b = sliceBook(full, 30);
    expect(b.multiHops.buy).toEqual(buy.slice(0, 30));
    expect(b.multiHops.sell).toEqual(sell.slice(0, 30));
    expect(b.singleHops.buy).toEqual(buy.slice(0, 30).filter(x => x.hops.length === 2));
    expect(b.singleHops.sell).toEqual(sell.slice(0, 30).filter(x => x.hops.length === 2));
    // Not singles drawn from the full 100.
    expect(b.singleHops.buy.length).toBeLessThan(full.singleHops.buy.length);
  });
});
