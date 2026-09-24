import { describe, expect, it } from 'vitest';
import BigNumber from 'bignumber.js';
import { Metadata, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Amount } from '@penumbra-zone/protobuf/penumbra/core/num/v1/num_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import { computePositionStats } from './get-position-stats';
import type { CalculatedAsset } from './types';
import type { PositionStats } from '@/shared/api/server/position/stats/types';

const metadata = (symbol: string, inner: number) =>
  new Metadata({
    symbol,
    display: symbol,
    base: `u${symbol}`,
    penumbraAssetId: { inner: new Uint8Array([inner]) },
    denomUnits: [
      { denom: `u${symbol}`, exponent: 0 },
      { denom: symbol, exponent: 6 },
    ],
  });

const USDC = metadata('USDC', 1);
const UM = metadata('UM', 2);

const calculated = (asset: Metadata, amount: number): CalculatedAsset => ({
  asset,
  exponent: 6,
  amount: new BigNumber(amount),
  price: new BigNumber(0),
  effectivePrice: new BigNumber(0),
  reserves: new Amount(),
});

describe('computePositionStats', () => {
  // Real position plpid160ujl… : asset1 = USDC, asset2 = UM, fees accrued
  // entirely in UM. `marketPrice` must be the CANONICAL mid (asset2 per
  // asset1 = UM per USDC), not the display mid (USDC per UM). Passing the
  // display mid divides instead of multiplying and rendered 1.81 UM of fees
  // as "706.95 USDC" on a position worth about half a dollar.
  const raw: PositionStats = {
    positionId: { inner: new Uint8Array([9]) },
    asset1: { inner: new Uint8Array([1]) },
    asset2: { inner: new Uint8Array([2]) },
    openingHeight: 12837412,
    openingTime: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    openingReserves1: new Value({ amount: pnum(543957).toAmount() }),
    openingReserves2: new Value({ amount: pnum(0).toAmount() }),
    fees1: new Value({ amount: pnum(0).toAmount() }),
    fees2: new Value({ amount: pnum(1813529).toAmount() }),
  } as unknown as PositionStats;

  const args = {
    raw,
    asset1: calculated(USDC, 0.543957),
    asset2: calculated(UM, 0),
    quoteAsset: calculated(USDC, 0.543957),
  };

  const CANONICAL_MID = 1 / 0.002566; // UM per USDC ≈ 389.7

  it('values asset2 fees in the quote asset using the canonical mid', () => {
    const stats = computePositionStats({ ...args, marketPrice: CANONICAL_MID });
    // 1.813529 UM / 389.7 UM-per-USDC ≈ 0.00465 USDC
    expect(stats?.feesQuoteNumber).toBeCloseTo(0.004654, 5);
  });

  it('keeps APR within a sane range for a real position', () => {
    const stats = computePositionStats({ ...args, marketPrice: CANONICAL_MID });
    // Half a cent of fees on ~0.54 USDC over 5 days — tens of percent, not
    // the 22_586_100% the reciprocal mid produced.
    expect(stats?.aprPct).toBeDefined();
    expect(stats?.aprPct).toBeLessThan(200);
  });

  it('regression: the display mid inflates fees by ~mid squared', () => {
    // Guards the orientation contract itself — if someone feeds the display
    // mid again, this is the number they get back.
    const wrong = computePositionStats({ ...args, marketPrice: 0.002566 });
    expect(wrong?.feesQuoteNumber).toBeGreaterThan(700);
  });
});
