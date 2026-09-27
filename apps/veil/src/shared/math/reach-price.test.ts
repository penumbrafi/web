import { describe, expect, it } from 'vitest';
import { reachPrice } from './reach-price';
import type { Trace } from '@/shared/api/server/book/types';

const row = (price: number, amount: number): Trace => ({
  price: String(price),
  amount: String(amount),
  total: String(amount),
  hops: ['BASE', 'QUOTE'],
});

// Bids arrive best-first (descending); asks arrive worst-first (descending,
// best ask last) — the ordering `sliceBook` and `simulateMarketBase` both
// rely on.
const BIDS = [row(12, 5), row(10, 5), row(8, 5)];
const ASKS = [row(20, 5), row(12, 5), row(10, 5)];

describe('reachPrice', () => {
  it('takes only the levels up to the target, best-first', () => {
    // Target 11 sits between the 10 and 12 asks: only the 10 ask is at or
    // below it, so 5 base at 10 is the whole order.
    const fill = reachPrice('buy', 11, Infinity, BIDS, ASKS);
    expect(fill.baseAmount).toBe(5);
    expect(fill.quoteAmount).toBe(50);
    expect(fill.avgPrice).toBe(10);
    expect(fill.worstPrice).toBe(10);
    expect(fill.stoppedBy).toBe('target');
  });

  it('includes a level sitting exactly on the target', () => {
    // Target 12 reaches the 12 ask, and the book then runs out; the deepest
    // level taken is at the target exactly, which still counts as reached.
    const fill = reachPrice('buy', 12, Infinity, BIDS, ASKS);
    expect(fill.baseAmount).toBe(10);
    expect(fill.quoteAmount).toBe(110);
    expect(fill.avgPrice).toBe(11);
    expect(fill.worstPrice).toBe(12);
    expect(fill.stoppedBy).toBe('target');
  });

  it('reports the book rather than the target when depth falls short', () => {
    // Target 25 is past the deepest ask: the order takes everything visible
    // and still does not get there.
    const fill = reachPrice('buy', 25, Infinity, BIDS, ASKS);
    expect(fill.baseAmount).toBe(15);
    expect(fill.worstPrice).toBe(20);
    expect(fill.stoppedBy).toBe('book');
  });

  it('nothing to take when the target is behind the touch', () => {
    const fill = reachPrice('buy', 9, Infinity, BIDS, ASKS);
    expect(fill.baseAmount).toBe(0);
    expect(fill.quoteAmount).toBe(0);
    expect(fill.avgPrice).toBe(0);
  });

  it('stops at the budget and says so', () => {
    // 40 quote buys 4 of the 5 available at 10, then the budget is gone.
    const fill = reachPrice('buy', 11, 40, BIDS, ASKS);
    expect(fill.baseAmount).toBe(4);
    expect(fill.quoteAmount).toBe(40);
    expect(fill.stoppedBy).toBe('budget');
  });

  it('walks bids downward for a sell', () => {
    // Target 11 sits between the 12 and 10 bids: only the 12 bid is at or
    // above it, so 5 base sold at 12.
    const fill = reachPrice('sell', 11, Infinity, BIDS, ASKS);
    expect(fill.baseAmount).toBe(5);
    expect(fill.quoteAmount).toBe(60);
    expect(fill.avgPrice).toBe(12);
    expect(fill.worstPrice).toBe(12);
    expect(fill.stoppedBy).toBe('target');
  });

  it('budgets a sell in base units', () => {
    const fill = reachPrice('sell', 11, 2, BIDS, ASKS);
    expect(fill.baseAmount).toBe(2);
    expect(fill.quoteAmount).toBe(24);
    expect(fill.stoppedBy).toBe('budget');
  });

  it('returns nothing for a degenerate target or budget', () => {
    for (const [target, budget] of [
      [0, Infinity],
      [-1, Infinity],
      [NaN, Infinity],
      [11, 0],
      [11, -1],
    ]) {
      const fill = reachPrice('buy', target!, budget!, BIDS, ASKS);
      expect(fill.baseAmount).toBe(0);
      expect(fill.stoppedBy).toBe('book');
    }
  });

  it('is empty on an empty book', () => {
    const fill = reachPrice('buy', 11, Infinity, [], []);
    expect(fill.baseAmount).toBe(0);
    expect(fill.stoppedBy).toBe('book');
  });

  it('parses the book’s significant-figure price strings', () => {
    const asks = [row(0.003965, 100)];
    const fill = reachPrice('buy', 0.004, Infinity, [], asks);
    expect(fill.baseAmount).toBe(100);
    expect(fill.quoteAmount).toBeCloseTo(0.3965, 10);
  });
});
