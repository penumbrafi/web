import { describe, expect, it } from 'vitest';
import { dexUsdSeries, dropSpikes, MIN_CLOSES, MIN_DAY_USD, PricePoint } from './pricing';

const days = (n: number) => Array.from({ length: n }, (_, i) => i * 10);
// Each close with `volume` units of `base` traded that day.
const pair = (base: string, quote: string, prices: number[], volume = 1_000): PricePoint[] =>
  prices.map((price, i) => ({ base, quote, timeMs: i * 10, price, volume }));

describe('dropSpikes', () => {
  it('drops a close far from its neighbours and keeps ordinary moves', () => {
    const closes = [10, 11, 10, 1000, 12, 11, 10].map((price, i) => ({ timeMs: i, price }));
    expect(dropSpikes(closes).map(c => c.price)).toEqual([10, 11, 10, 12, 11, 10]);
  });
});

describe('dexUsdSeries', () => {
  const stables = new Set(['USDC']);
  const times = days(6);

  it('pegs stables at 1 and prices a direct pair', () => {
    const out = dexUsdSeries({ points: pair('UM', 'USDC', [2, 2, 2, 2, 2, 2]), times, stables });
    expect(out.get('USDC')).toEqual([1, 1, 1, 1, 1, 1]);
    expect(out.get('UM')).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('ignores a pair with too few closes (the one-trade ZEC case)', () => {
    const out = dexUsdSeries({
      points: pair('ZEC', 'USDC', new Array<number>(MIN_CLOSES - 1).fill(416_000)),
      times,
      stables,
    });
    expect(out.has('ZEC')).toBe(false);
  });

  it('prefers the most liquid route over a thin direct stable pair', () => {
    const points = [
      ...pair('ATOM', 'USDC', [2, 2, 2, 2, 2, 2]),
      // stATOM trades 1.5 ATOM a day in size, and dribbles at a stale $7.7.
      ...pair('stATOM', 'ATOM', [1.5, 1.5, 1.5, 1.5, 1.5, 1.5]),
      ...pair('stATOM', 'USDC', [7.7, 7.7, 7.7, 7.7, 7.7, 7.7], 5),
    ];
    const out = dexUsdSeries({ points, times, stables });
    expect(out.get('stATOM')?.[5]).toBeCloseTo(3);
  });

  it('ignores closes on days with dust volume', () => {
    const dust = MIN_DAY_USD / 2 / 1_000_000;
    const out = dexUsdSeries({
      points: pair('ZEC', 'USDC', [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000], dust),
      times,
      stables,
    });
    expect(out.has('ZEC')).toBe(false);
  });

  it('reads the reciprocal direction of a pair', () => {
    const out = dexUsdSeries({
      points: pair('USDC', 'UM', [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
      times,
      stables,
    });
    expect(out.get('UM')?.[0]).toBeCloseTo(2);
  });
});
