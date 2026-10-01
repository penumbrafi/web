import { describe, expect, it } from 'vitest';
import { inPriceRange, isRangeActive, parseRangeBound } from './price-range';
import { DisplayPosition } from './types';

// Only `orders[0].effectivePrice` is read; pnum accepts a plain number.
const at = (price: number) =>
  ({ orders: [{ effectivePrice: price }] }) as unknown as DisplayPosition;

describe('parseRangeBound', () => {
  it('treats empty and invalid input as unbounded', () => {
    expect(parseRangeBound('')).toBeUndefined();
    expect(parseRangeBound('  ')).toBeUndefined();
    expect(parseRangeBound('abc')).toBeUndefined();
    expect(parseRangeBound('-1')).toBeUndefined();
  });

  it('parses decimals', () => {
    expect(parseRangeBound(' 1.25 ')).toBe(1.25);
    expect(parseRangeBound('0')).toBe(0);
  });
});

describe('inPriceRange', () => {
  it('matches everything when no bound is set', () => {
    expect(isRangeActive({})).toBe(false);
    expect(inPriceRange(at(5), {})).toBe(true);
  });

  it('is inclusive on both ends', () => {
    const range = { min: 1, max: 2 };
    expect(inPriceRange(at(1), range)).toBe(true);
    expect(inPriceRange(at(2), range)).toBe(true);
    expect(inPriceRange(at(0.99), range)).toBe(false);
    expect(inPriceRange(at(2.01), range)).toBe(false);
  });

  it('supports one-sided ranges', () => {
    expect(inPriceRange(at(10), { min: 5 })).toBe(true);
    expect(inPriceRange(at(4), { min: 5 })).toBe(false);
    expect(inPriceRange(at(4), { max: 5 })).toBe(true);
  });

  it('excludes rows without a usable price when a range is set', () => {
    const noOrders = { orders: [] } as unknown as DisplayPosition;
    expect(inPriceRange(noOrders, { min: 1 })).toBe(false);
  });
});
