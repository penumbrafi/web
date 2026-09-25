import { describe, expect, it } from 'vitest';
import { buildUsdSeries, sampleForward, sampleHeights } from './series';

describe('sampleForward', () => {
  it('carries the last close forward and backfills before the first', () => {
    const prices = [
      { timeMs: 20, price: 2 },
      { timeMs: 40, price: 4 },
    ];
    expect(sampleForward(prices, [10, 20, 30, 40, 50])).toEqual([2, 2, 2, 4, 4]);
  });

  it('is undefined without prices', () => {
    expect(sampleForward([], [1, 2])).toBeUndefined();
  });
});

describe('buildUsdSeries', () => {
  const stables = new Set(['USDC']);
  const times = [0, 10];

  it('pegs stables, prices UM against a stable, and routes others via UM', () => {
    const usd = buildUsdSeries({
      stables,
      um: 'UM',
      times,
      points: [
        { base: 'UM', quote: 'USDC', timeMs: 0, price: 0.005 },
        { base: 'UM', quote: 'USDC', timeMs: 10, price: 0.004 },
        // OSMO only trades against UM: 1 OSMO = 20 UM
        { base: 'OSMO', quote: 'UM', timeMs: 0, price: 20 },
      ],
    });
    expect(usd.get('USDC')).toEqual([1, 1]);
    expect(usd.get('UM')).toEqual([0.005, 0.004]);
    expect(usd.get('OSMO')?.[0]).toBeCloseTo(0.1);
    expect(usd.get('OSMO')?.[1]).toBeCloseTo(0.08);
  });

  it('reads a reverse-direction close as the reciprocal', () => {
    // USDC priced in INJ: 1 USDC = 0.125 INJ, so 1 INJ = 8 USDC
    const usd = buildUsdSeries({
      stables,
      um: 'UM',
      times,
      points: [{ base: 'USDC', quote: 'INJ', timeMs: 0, price: 0.125 }],
    });
    expect(usd.get('INJ')).toEqual([8, 8]);
  });

  it('prefers a direct stable quote over routing through UM', () => {
    const usd = buildUsdSeries({
      stables,
      um: 'UM',
      times: [0],
      points: [
        { base: 'UM', quote: 'USDC', timeMs: 0, price: 0.005 },
        { base: 'INJ', quote: 'UM', timeMs: 0, price: 1000 },
        { base: 'INJ', quote: 'USDC', timeMs: 0, price: 8.2 },
      ],
    });
    expect(usd.get('INJ')).toEqual([8.2]);
  });
});

describe('sampleHeights', () => {
  it('spans the range inclusively', () => {
    expect(sampleHeights(100, 200, 3)).toEqual([100, 150, 200]);
  });
});
