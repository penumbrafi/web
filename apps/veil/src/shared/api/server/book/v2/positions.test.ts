import { describe, expect, it } from 'vitest';
import {
  Position,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { positionToOrder, type PairAssets } from './positions';

const id = (n: number) => new AssetId({ inner: new Uint8Array(32).fill(n) });
const A1 = id(1);
const A2 = id(2);

const position = ({
  p,
  q,
  fee = 0,
  r1,
  r2,
  state = PositionState_PositionStateEnum.OPENED,
}: {
  p: bigint;
  q: bigint;
  fee?: number;
  r1: bigint;
  r2: bigint;
  state?: PositionState_PositionStateEnum;
}) =>
  new Position({
    phi: { component: { fee, p: { lo: p }, q: { lo: q } }, pair: { asset1: A1, asset2: A2 } },
    reserves: { r1: { lo: r1 }, r2: { lo: r2 } },
    state: { state },
  });

// base = asset_1, same exponents.
const baseIs1: PairAssets = { base: A1, quote: A2, baseExponent: 6, quoteExponent: 6 };

describe('positionToOrder', () => {
  it('without a fee, bid and ask sit at p/q', () => {
    // 1 base = 2 quote. r1 = 10 base, r2 = 30 quote.
    const pos = position({ p: 2n, q: 1n, r1: 10_000_000n, r2: 30_000_000n });
    expect(positionToOrder(pos, 'ask', baseIs1)).toEqual({ price: 2, amount: 10 });
    // 30 quote buys 15 base at 2.
    expect(positionToOrder(pos, 'bid', baseIs1)).toEqual({ price: 2, amount: 15 });
  });

  it('a fee widens both sides around p/q', () => {
    const pos = position({ p: 2n, q: 1n, fee: 100, r1: 10_000_000n, r2: 30_000_000n });
    const ask = positionToOrder(pos, 'ask', baseIs1);
    const bid = positionToOrder(pos, 'bid', baseIs1);
    expect(ask?.price).toBeCloseTo(2 / 0.99, 12);
    expect(bid?.price).toBeCloseTo(2 * 0.99, 12);
    expect(bid?.amount).toBeCloseTo(30 / (2 * 0.99), 9);
    expect((bid?.price ?? 0) < (ask?.price ?? 0)).toBe(true);
  });

  it('orients when base is asset_2', () => {
    // Same position read as base = asset_2: 1 asset_2 = 1/2 asset_1.
    const pos = position({ p: 2n, q: 1n, r1: 10_000_000n, r2: 30_000_000n });
    const baseIs2: PairAssets = { base: A2, quote: A1, baseExponent: 6, quoteExponent: 6 };
    // Sells its asset_2 (30) at 0.5 asset_1 each.
    expect(positionToOrder(pos, 'ask', baseIs2)).toEqual({ price: 0.5, amount: 30 });
    // Buys asset_2 with its 10 asset_1 at 0.5 → 20 base.
    expect(positionToOrder(pos, 'bid', baseIs2)).toEqual({ price: 0.5, amount: 20 });
  });

  it('scales by the display exponents', () => {
    // base 18 decimals, quote 6: raw p/q = 3e-12 quote-units per base-unit
    // → 3 quote per base in display terms.
    const pos = position({ p: 3n, q: 1_000_000_000_000n, r1: 5n * 10n ** 18n, r2: 0n });
    const assets: PairAssets = { base: A1, quote: A2, baseExponent: 18, quoteExponent: 6 };
    const ask = positionToOrder(pos, 'ask', assets);
    expect(ask?.price).toBeCloseTo(3, 12);
    expect(ask?.amount).toBe(5);
    // No quote reserve → no bid.
    expect(positionToOrder(pos, 'bid', assets)).toBeUndefined();
  });

  it('skips closed positions and other pairs', () => {
    const closed = position({
      p: 1n,
      q: 1n,
      r1: 1n,
      r2: 1n,
      state: PositionState_PositionStateEnum.CLOSED,
    });
    expect(positionToOrder(closed, 'ask', baseIs1)).toBeUndefined();
    const other: PairAssets = { base: A1, quote: id(3), baseExponent: 6, quoteExponent: 6 };
    expect(
      positionToOrder(position({ p: 1n, q: 1n, r1: 1n, r2: 1n }), 'ask', other),
    ).toBeUndefined();
  });
});
