import { describe, expect, it } from 'vitest';
import { valueSeries, type NoteSpan } from './use-balance-history';

const history = {
  points: [
    { height: 10, timeMs: 1 },
    { height: 20, timeMs: 2 },
    { height: 30, timeMs: 3 },
  ],
  usd: { UM: [0.01, 0.02, 0.04], USDC: [1, 1, 1] },
};
const exponentOf = (id: string) => (id === 'UM' || id === 'USDC' ? 6 : undefined);

describe('valueSeries', () => {
  it('counts a note from its created height until it is spent', () => {
    const spans: NoteSpan[] = [
      // 100 UM received at 15, spent at 25
      { assetId: 'UM', amount: 100_000_000n, created: 15, spent: 25 },
      // 5 USDC received at 5, never spent
      { assetId: 'USDC', amount: 5_000_000n, created: 5, spent: 0 },
    ];
    const v = valueSeries({ spans, history, exponentOf });
    expect(v[0]).toBeCloseTo(5); // only USDC
    expect(v[1]).toBeCloseTo(5 + 100 * 0.02); // UM alive at 20
    expect(v[2]).toBeCloseTo(5); // UM spent before 30
  });

  it('skips assets without a price or known decimals', () => {
    const spans: NoteSpan[] = [{ assetId: 'LPNFT', amount: 1n, created: 1, spent: 0 }];
    expect(valueSeries({ spans, history, exponentOf })).toEqual([0, 0, 0]);
  });
});
