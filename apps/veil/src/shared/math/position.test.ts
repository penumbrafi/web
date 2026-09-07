import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { describe, expect, it } from 'vitest';
import {
  planToPosition,
  simpleLiquidityPositions,
  LiquidityDistributionShape,
  getPositionWeights,
} from './position';
import { pnum } from '@penumbra-zone/types/pnum';
import { Position } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';

const ASSET_A = new AssetId({ inner: new Uint8Array(Array(32).fill(0xaa)) });
const ASSET_B = new AssetId({ inner: new Uint8Array(Array(32).fill(0xbb)) });

const getPrice = (position: Position): number => {
  return pnum(position.phi?.component?.p).toNumber() / pnum(position.phi?.component?.q).toNumber();
};

describe('planToPosition', () => {
  it('works for plans with no exponent', () => {
    const position = planToPosition(
      {
        baseAsset: {
          id: ASSET_A,
          exponent: 0,
        },
        quoteAsset: {
          id: ASSET_B,
          exponent: 0,
        },
        price: 20.5,
        feeBps: 100,
        baseReserves: 1000,
        quoteReserves: 2000,
      },
      LiquidityDistributionShape.FLAT,
    );
    expect(position.position.phi?.component?.fee).toEqual(100);
    expect(getPrice(position.position)).toEqual(20.5);
    expect(pnum(position.position.reserves?.r1).toNumber()).toEqual(1000);
    expect(pnum(position.position.reserves?.r2).toNumber()).toEqual(2000);
  });

  it('works for plans with identical exponent', () => {
    const position = planToPosition(
      {
        baseAsset: {
          id: ASSET_A,
          exponent: 6,
        },
        quoteAsset: {
          id: ASSET_B,
          exponent: 6,
        },
        price: 12.34,
        feeBps: 100,
        baseReserves: 5,
        quoteReserves: 7,
      },
      LiquidityDistributionShape.FLAT,
    );
    expect(position.position.phi?.component?.fee).toEqual(100);
    expect(getPrice(position.position)).toEqual(12.34);
    expect(pnum(position.position.reserves?.r1).toNumber()).toEqual(5e6);
    expect(pnum(position.position.reserves?.r2).toNumber()).toEqual(7e6);
  });

  it('works for plans with different exponents', () => {
    const position = planToPosition(
      {
        baseAsset: {
          id: ASSET_A,
          exponent: 6,
        },
        quoteAsset: {
          id: ASSET_B,
          exponent: 8,
        },
        price: 12.34,
        feeBps: 100,
        baseReserves: 5,
        quoteReserves: 7,
      },
      LiquidityDistributionShape.FLAT,
    );
    expect(position.position.phi?.component?.fee).toEqual(100);
    expect(getPrice(position.position) * 10 ** (6 - 8)).toEqual(12.34);
    expect(pnum(position.position.reserves?.r1).toNumber()).toEqual(5e6);
    expect(pnum(position.position.reserves?.r2).toNumber()).toEqual(7e8);
  });
});

describe('renderPositions', () => {
  it('works for plans with no exponent', () => {
    const position = planToPosition(
      {
        baseAsset: {
          id: ASSET_A,
          exponent: 0,
        },
        quoteAsset: {
          id: ASSET_B,
          exponent: 0,
        },
        price: 20.5,
        feeBps: 100,
        baseReserves: 1000,
        quoteReserves: 2000,
      },
      LiquidityDistributionShape.FLAT,
    );
    expect(position.position.phi?.component?.fee).toEqual(100);
    expect(getPrice(position.position)).toEqual(20.5);
    expect(pnum(position.position.reserves?.r1).toNumber()).toEqual(1000);
    expect(pnum(position.position.reserves?.r2).toNumber()).toEqual(2000);
  });

  it('works for plans with identical exponent', () => {
    const position = planToPosition(
      {
        baseAsset: {
          id: ASSET_A,
          exponent: 6,
        },
        quoteAsset: {
          id: ASSET_B,
          exponent: 6,
        },
        price: 12.34,
        feeBps: 100,
        baseReserves: 5,
        quoteReserves: 7,
      },
      LiquidityDistributionShape.FLAT,
    );
    expect(position.position.phi?.component?.fee).toEqual(100);
    expect(getPrice(position.position)).toEqual(12.34);
    expect(pnum(position.position.reserves?.r1).toNumber()).toEqual(5e6);
    expect(pnum(position.position.reserves?.r2).toNumber()).toEqual(7e6);
  });

  it('works for plans with different exponents', () => {
    const position = planToPosition(
      {
        baseAsset: {
          id: ASSET_A,
          exponent: 6,
        },
        quoteAsset: {
          id: ASSET_B,
          exponent: 8,
        },
        price: 12.34,
        feeBps: 100,
        baseReserves: 5,
        quoteReserves: 7,
      },
      LiquidityDistributionShape.FLAT,
    );
    expect(position.position.phi?.component?.fee).toEqual(100);
    expect(getPrice(position.position) * 10 ** (6 - 8)).toEqual(12.34);
    expect(pnum(position.position.reserves?.r1).toNumber()).toEqual(5e6);
    expect(pnum(position.position.reserves?.r2).toNumber()).toEqual(7e8);
  });
});

describe('simpleLiquidityPositions', () => {
  const basePlan = {
    baseAsset: {
      id: ASSET_A,
      exponent: 6,
    },
    quoteAsset: {
      id: ASSET_B,
      exponent: 6,
    },
    baseLiquidity: 1000,
    quoteLiquidity: 1000,
    upperPrice: 2.0,
    lowerPrice: 1.0,
    marketPrice: 1.5,
    feeBps: 100,
    positions: 20,
    distributionShape: LiquidityDistributionShape.FLAT,
  };

  it('creates correct number of positions', () => {
    const positions = simpleLiquidityPositions(basePlan);
    expect(positions).toHaveLength(20);
  });

  it('distributes liquidity evenly in FLAT mode', () => {
    const positions = simpleLiquidityPositions({
      ...basePlan,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    const baseReserves = positions
      .map(p => pnum(p.position.reserves?.r1).toNumber())
      .filter(Boolean);
    const quoteReserves = positions
      .map(p => pnum(p.position.reserves?.r2).toNumber())
      .filter(Boolean);
    const reserves = [...quoteReserves, ...baseReserves];

    // All reserves should be equal
    expect(reserves.every(r => r === reserves[0])).toBe(true);
  });

  it('creates pyramid distribution in PYRAMID mode', () => {
    const positions = simpleLiquidityPositions({
      ...basePlan,
      distributionShape: LiquidityDistributionShape.PYRAMID,
    });

    const baseReserves = positions
      .map(p => pnum(p.position.reserves?.r1).toNumber())
      .filter(Boolean);
    const quoteReserves = positions
      .map(p => pnum(p.position.reserves?.r2).toNumber())
      .filter(Boolean);
    const reserves = [...quoteReserves, ...baseReserves];

    const middleIndex1 = Math.floor(reserves.length / 2);
    const middleIndex2 = Math.ceil(reserves.length / 2);

    const middleReserve1 = reserves[middleIndex1]!;
    const middleReserve2 = reserves[middleIndex2]!;
    const firstReserve = reserves[0]!;
    const lastReserve = reserves[reserves.length - 1]!;

    expect(middleReserve1).toBeGreaterThan(firstReserve);
    expect(middleReserve1).toBeGreaterThan(lastReserve);
    expect(middleReserve2).toBeGreaterThan(firstReserve);
    expect(middleReserve2).toBeGreaterThan(lastReserve);
  });

  it('creates inverted pyramid distribution in INVERTED_PYRAMID mode', () => {
    const positions = simpleLiquidityPositions({
      ...basePlan,
      distributionShape: LiquidityDistributionShape.INVERTED_PYRAMID,
    });

    const baseReserves = positions
      .map(p => pnum(p.position.reserves?.r1).toNumber())
      .filter(Boolean);
    const quoteReserves = positions
      .map(p => pnum(p.position.reserves?.r2).toNumber())
      .filter(Boolean);
    const reserves = [...quoteReserves, ...baseReserves];

    const middleIndex1 = Math.floor(reserves.length / 2);
    const middleIndex2 = Math.ceil(reserves.length / 2);

    const middleReserve1 = reserves[middleIndex1]!;
    const middleReserve2 = reserves[middleIndex2]!;
    const firstReserve = reserves[0]!;
    const lastReserve = reserves[reserves.length - 1]!;

    expect(middleReserve1).toBeLessThan(firstReserve);
    expect(middleReserve1).toBeLessThan(lastReserve);
    expect(middleReserve2).toBeLessThan(firstReserve);
    expect(middleReserve2).toBeLessThan(lastReserve);
  });

  it('maintains total liquidity in FLAT distribution', () => {
    const positions = simpleLiquidityPositions({
      ...basePlan,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    // Calculate total base and quote liquidity
    const totalBaseLiquidity = positions.reduce(
      (sum, p) => sum + pnum(p.position.reserves?.r1 ?? 0, basePlan.baseAsset.exponent).toNumber(),
      0,
    );
    const totalQuoteLiquidity = positions.reduce(
      (sum, p) => sum + pnum(p.position.reserves?.r2 ?? 0, basePlan.quoteAsset.exponent).toNumber(),
      0,
    );

    // Total liquidity should match input (accounting for exponents)
    expect(totalBaseLiquidity).toBeCloseTo(basePlan.baseLiquidity);
    expect(totalQuoteLiquidity).toBeCloseTo(basePlan.quoteLiquidity);
  });

  it('maintains total liquidity in PYRAMID distribution', () => {
    const positions = simpleLiquidityPositions({
      ...basePlan,
      distributionShape: LiquidityDistributionShape.PYRAMID,
    });

    // Calculate total base and quote liquidity
    const totalBaseLiquidity = positions.reduce(
      (sum, p) => sum + pnum(p.position.reserves?.r1 ?? 0, basePlan.baseAsset.exponent).toNumber(),
      0,
    );
    const totalQuoteLiquidity = positions.reduce(
      (sum, p) => sum + pnum(p.position.reserves?.r2 ?? 0, basePlan.quoteAsset.exponent).toNumber(),
      0,
    );

    // Total liquidity should match input (accounting for exponents)
    expect(totalBaseLiquidity).toBeCloseTo(basePlan.baseLiquidity);
    expect(totalQuoteLiquidity).toBeCloseTo(basePlan.quoteLiquidity);
  });

  it('maintains total liquidity in INVERTED_PYRAMID distribution', () => {
    const positions = simpleLiquidityPositions({
      ...basePlan,
      distributionShape: LiquidityDistributionShape.INVERTED_PYRAMID,
    });

    // Calculate total base and quote liquidity
    const totalBaseLiquidity = positions.reduce(
      (sum, p) => sum + pnum(p.position.reserves?.r1 ?? 0, basePlan.baseAsset.exponent).toNumber(),
      0,
    );
    const totalQuoteLiquidity = positions.reduce(
      (sum, p) => sum + pnum(p.position.reserves?.r2 ?? 0, basePlan.quoteAsset.exponent).toNumber(),
      0,
    );

    // Total liquidity should match input (accounting for exponents)
    expect(totalBaseLiquidity).toBeCloseTo(basePlan.baseLiquidity);
    expect(totalQuoteLiquidity).toBeCloseTo(basePlan.quoteLiquidity);
  });
});

describe('getPositionWeights', () => {
  it('ensures minimum weight of 0.02 for PYRAMID distribution', () => {
    const positions = 10;
    const weights = getPositionWeights(positions, LiquidityDistributionShape.PYRAMID);
    weights.forEach(weight => {
      expect(weight).toBeGreaterThanOrEqual(0.02);
    });
  });

  it('returns correct number of weights', () => {
    const positions = 5;
    const weights = getPositionWeights(positions, LiquidityDistributionShape.FLAT);
    expect(weights).toHaveLength(positions);
  });

  it('returns [1] for single position', () => {
    const weights = getPositionWeights(1, LiquidityDistributionShape.FLAT);
    expect(weights).toEqual([1]);
  });

  it('maintains relative proportions in PYRAMID distribution', () => {
    const positions = 5;
    const weights = getPositionWeights(positions, LiquidityDistributionShape.PYRAMID);

    // Middle position should have highest weight
    const middleIndex = Math.floor(positions / 2);
    const middleWeight = weights[middleIndex]!;
    weights.forEach((weight, i) => {
      if (i !== middleIndex) {
        expect(middleWeight).toBeGreaterThan(weight);
      }
    });
  });

  it('maintains relative proportions in INVERTED_PYRAMID distribution', () => {
    const positions = 5;
    const weights = getPositionWeights(positions, LiquidityDistributionShape.INVERTED_PYRAMID);

    // Edge positions should have higher weights than middle
    const middleIndex = Math.floor(positions / 2);
    const middleWeight = weights[middleIndex]!;
    weights.forEach((weight, i) => {
      if (i === 0 || i === positions - 1) {
        expect(weight).toBeGreaterThan(middleWeight);
      }
    });
  });
});

/**
 * pd's `Position::check_stateless` rejects the *entire transaction* if any
 * single position has r1 == 0 && r2 == 0 ("initial reserves must provision
 * some amount of either asset"). These are the shapes that used to produce
 * such positions and therefore made a first LP attempt fail outright.
 */
describe('simpleLiquidityPositions — every emitted position is chain-acceptable', () => {
  const baseAsset = { id: ASSET_A, exponent: 6 };
  const quoteAsset = { id: ASSET_B, exponent: 6 };

  const hasReserves = ({ position }: { position: Position }) =>
    pnum(position.reserves?.r1).toNumber() > 0 || pnum(position.reserves?.r2).toNumber() > 0;

  /** Every rung must sit inside the range the user actually chose. */
  const expectWithinRange = (
    positions: { position: Position }[],
    lowerPrice: number,
    upperPrice: number,
  ) => {
    positions.forEach(({ position }) => {
      const price = getPrice(position);
      expect(price).toBeGreaterThanOrEqual(lowerPrice - 1e-9);
      expect(price).toBeLessThanOrEqual(upperPrice + 1e-9);
    });
  };

  it('drops rungs whose reserves truncate to zero base units', () => {
    // A dust-sized two-sided LP: 10 PYRAMID rungs over 0.000004 of each asset
    // rounds several rungs to 0 uUM / 0 uUSD once quantised to base units.
    const positions = simpleLiquidityPositions({
      baseAsset,
      quoteAsset,
      baseLiquidity: 0.000004,
      quoteLiquidity: 0.000004,
      upperPrice: 1.1,
      lowerPrice: 0.9,
      marketPrice: 1,
      feeBps: 10,
      positions: 10,
      distributionShape: LiquidityDistributionShape.PYRAMID,
    });

    expect(positions.every(hasReserves)).toBe(true);
    // Prove rungs were actually dropped, rather than the filter being a no-op.
    expect(positions.length).toBeLessThan(10);
  });

  it('supports a one-sided range entirely above mid without empty rungs', () => {
    const positions = simpleLiquidityPositions({
      baseAsset,
      quoteAsset,
      baseLiquidity: 100,
      quoteLiquidity: 0,
      upperPrice: 1.4,
      lowerPrice: 1.2,
      marketPrice: 1,
      feeBps: 10,
      positions: 10,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    expect(positions.length).toBeGreaterThan(0);
    expect(positions.every(hasReserves)).toBe(true);
    // Never open more rungs than the form advertised.
    expect(positions.length).toBeLessThanOrEqual(10);
    // Regression: rungs used to start at raw mid (1.0) and march up to 1.36,
    // putting half the ladder below the user's lower bound and selling one
    // rung *at mid* — an instant fill at the price the range was drawn to
    // avoid.
    expectWithinRange(positions, 1.2, 1.4);
  });

  it('supports a one-sided range entirely below mid without empty rungs', () => {
    const positions = simpleLiquidityPositions({
      baseAsset,
      quoteAsset,
      baseLiquidity: 0,
      quoteLiquidity: 100,
      upperPrice: 0.8,
      lowerPrice: 0.6,
      marketPrice: 1,
      feeBps: 10,
      positions: 10,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    expect(positions.length).toBeGreaterThan(0);
    expect(positions.every(hasReserves)).toBe(true);
    expect(positions.length).toBeLessThanOrEqual(10);
    // Regression: the mirror case — bids used to run up to 0.96, well above
    // the user's 0.8 upper bound.
    expectWithinRange(positions, 0.6, 0.8);
  });

  it('produces no positions at all when neither side funds anything', () => {
    const positions = simpleLiquidityPositions({
      baseAsset,
      quoteAsset,
      baseLiquidity: 0,
      quoteLiquidity: 0,
      upperPrice: 1.1,
      lowerPrice: 0.9,
      marketPrice: 1,
      feeBps: 10,
      positions: 10,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    // Better an empty plan the form can explain than a batch the chain rejects.
    expect(positions).toHaveLength(0);
  });

  it('emits finite prices for a fully one-sided range', () => {
    const positions = simpleLiquidityPositions({
      baseAsset,
      quoteAsset,
      baseLiquidity: 50,
      quoteLiquidity: 0,
      upperPrice: 2,
      lowerPrice: 1.5,
      marketPrice: 1,
      feeBps: 10,
      positions: 5,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    positions.forEach(({ position }) => {
      expect(pnum(position.phi?.component?.p).toNumber()).toBeGreaterThan(0);
      expect(pnum(position.phi?.component?.q).toNumber()).toBeGreaterThan(0);
    });
    expectWithinRange(positions, 1.5, 2);
  });

  it('still centres a two-sided range on the live mid', () => {
    const positions = simpleLiquidityPositions({
      baseAsset,
      quoteAsset,
      baseLiquidity: 100,
      quoteLiquidity: 100,
      upperPrice: 1.1,
      lowerPrice: 0.9,
      marketPrice: 1,
      feeBps: 10,
      positions: 10,
      distributionShape: LiquidityDistributionShape.FLAT,
    });

    // The anchor clamp must be a no-op when mid is inside the range: bids
    // below mid, asks above it, nothing crossing.
    expect(positions).toHaveLength(10);
    expectWithinRange(positions, 0.9, 1.1);
    positions.forEach(({ position }) => {
      const price = getPrice(position);
      const sellsBase = pnum(position.reserves?.r1).toNumber() > 0;
      const baseIsAsset1 = position.phi?.pair?.asset1?.equals(ASSET_A) ?? false;
      const offersBase = baseIsAsset1 ? sellsBase : !sellsBase;
      if (offersBase) {
        expect(price).toBeGreaterThanOrEqual(1 - 1e-9);
      } else {
        expect(price).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  });
});
