import { describe, expect, it } from 'vitest';
import type { BookV2Response } from '@/shared/api/server/book/v2/types';
import { flattenBookPages, nextBookPageParam } from './book-v2';

const level = (price: number, amount = 1) => ({ price, amount, total: amount, count: 1 });

const page = (over: Partial<BookV2Response>): BookV2Response => ({
  height: '1',
  mid: 1,
  bestBid: 0.99,
  bestAsk: 1.01,
  step: 0,
  base: { symbol: 'UM', exponent: 6 },
  quote: { symbol: 'USDC', exponent: 6 },
  bids: [],
  asks: [],
  ...over,
});

describe('nextBookPageParam', () => {
  it('advances both cursors and pins the resolved step', () => {
    const p = page({
      step: 0.01,
      bids: [level(0.99), level(0.98)],
      asks: [level(1.01), level(1.02)],
      nextCursorBid: 0.98,
      nextCursorAsk: 1.02,
    });
    expect(nextBookPageParam(p, {})).toEqual({ step: 0.01, cursorBid: 0.98, cursorAsk: 1.02 });
  });

  it('parks an exhausted side on its last price instead of replaying page one', () => {
    const p = page({
      bids: [level(0.99)],
      asks: [level(1.01), level(1.02)],
      nextCursorAsk: 1.02,
    });
    expect(nextBookPageParam(p, {})).toMatchObject({ cursorBid: 0.99, cursorAsk: 1.02 });
    // A later page with no bid rows keeps the previous bid cursor.
    const later = page({ asks: [level(1.03)], nextCursorAsk: 1.03 });
    expect(nextBookPageParam(later, { cursorBid: 0.99 })).toMatchObject({ cursorBid: 0.99 });
  });

  it('stops when neither side has more', () => {
    expect(nextBookPageParam(page({ bids: [level(0.99)] }), {})).toBeUndefined();
  });
});

describe('flattenBookPages', () => {
  it("emits v1's Trace order with per-level totals and direct hops", () => {
    const view = flattenBookPages(
      [
        page({
          bids: [level(0.99, 2), level(0.98)],
          asks: [level(1.01, 3), level(1.02)],
          nextCursorBid: 0.98,
        }),
        // A moved book can repeat a level; the first page's copy wins.
        page({ bids: [level(0.98, 5), level(0.97)], asks: [] }),
      ],
      'UM',
      'USDC',
    );
    expect(view?.bids.map(t => t.price)).toEqual(['0.99', '0.98', '0.97']);
    expect(view?.bids[1]?.amount).toBe('1');
    // Asks descending: best (lowest) ask LAST, like multiHops.sell.
    expect(view?.asks.map(t => t.price)).toEqual(['1.02', '1.01']);
    expect(view?.asks[1]).toEqual({ price: '1.01', amount: '3', total: '3', hops: ['UM', 'USDC'] });
    expect(view?.hasMoreBids).toBe(false);
    expect(view?.mid).toBe(1);
  });

  it('reads hasMore from the last page', () => {
    const view = flattenBookPages([page({ nextCursorAsk: 1.05 })], 'UM', 'USDC');
    expect(view).toMatchObject({ hasMoreAsks: true, hasMoreBids: false });
  });
});
