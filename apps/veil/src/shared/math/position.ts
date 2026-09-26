import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  Position,
  PositionState,
  PositionState_PositionStateEnum,
  TradingPair,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { Amount } from '@penumbra-zone/protobuf/penumbra/core/num/v1/num_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import BigNumber from 'bignumber.js';

export interface PositionedLiquidity {
  position: Position;
  shape: LiquidityDistributionShape;
}

/**
 * One rung of a liquidity ladder, BEFORE it is turned into an on-chain
 * `Position`.
 *
 * Building a `Position` is the expensive half of planning: it runs the
 * `priceToPQ` fraction search and draws a 32-byte nonce from
 * `crypto.getRandomValues`. The preview overlay, validator, and confirm
 * modal only need the rung prices and reserve amounts, so they read a
 * `LiquidityRung[]` and leave `Position` construction to the two places that
 * actually broadcast or dry-run the transaction.
 */
export interface LiquidityRung {
  /** Display-unit price, quote / base. */
  price: number;
  /** The fee, in [0, 10_000]. */
  feeBps: number;
  /** Raw display-unit reserves the planner asked for — fed to `planToPosition`. */
  baseReserves: number;
  quoteReserves: number;
  /**
   * Display-unit reserves after quantising DOWN to base units — exactly what
   * the built position will hold, and exactly what reading `reserves.r1/r2`
   * back off it (`positionRequirements`, the confirm modal totals) yields.
   */
  baseAmount: number;
  quoteAmount: number;
}

export const compareAssetId = (a: AssetId, b: AssetId): number => {
  // The asset ids are serialized using LE, so this is checking the MSB.
  for (let i = 31; i >= 0; --i) {
    const a_i = a.inner[i] ?? -Infinity;
    const b_i = b.inner[i] ?? -Infinity;
    if (a_i < b_i) {
      return -1;
    }
    if (b_i < a_i) {
      return 1;
    }
  }
  return 0;
};

/**
 * A slimmed-down representation for assets, restricted to what we need for math.
 *
 * We have an identifier for the kind of asset, which is needed to construct a position,
 * and an exponent E, such that 10**E units of the base denom constitute a unit of the display denom.
 *
 * For example, 10**6 uUSD make up one USD.
 */
export interface Asset {
  id: AssetId;
  exponent: number;
}

/**
 * A basic plan to create a position.
 *
 * This can then be passed to `planToPosition` to fill out the position.
 */
export interface PositionPlan {
  baseAsset: Asset;
  quoteAsset: Asset;
  /** How much of the quote asset do you get for each unit of the base asset?
   *
   * This will be in terms of the *display* denoms, e.g. USD / UM.
   */
  price: number;
  /** The fee, in [0, 10_000]*/
  feeBps: number;
  /** How much of the base asset we want to provide, in display units. */
  baseReserves: number;
  /** How much of the quote asset we want to provide, in display units. */
  quoteReserves: number;
}

const priceToPQ = (
  price: number,
  pExponent: number,
  qExponent: number,
): { p: Amount; q: Amount } => {
  // Guard against non-finite inputs: BigNumber(NaN|Infinity).toFraction()
  // returns a non-iterable value in some bundler builds, which surfaces
  // as the cryptic "n.default is not iterable" destructuring error at
  // the `let [p, q] = ...` line below. Better to short-circuit to a
  // canonical (1, 1) than to crash the whole LP form.
  if (!Number.isFinite(price) || !Number.isFinite(pExponent) || !Number.isFinite(qExponent)) {
    return { p: pnum(1n).toAmount(), q: pnum(1n).toAmount() };
  }
  // e.g. price     = X USD / UM
  //      basePrice = Y uUM / uUSD = X USD / UM * uUSD / USD * UM / uUM
  //                = X * 10 ** qExponent * 10 ** -pExponent
  const basePrice = new BigNumber(price).times(new BigNumber(10).pow(qExponent - pExponent));

  // USD / UM -> [USD, UM], with a given precision.
  // Then, we want the invariant that p * UM + q * USD = constant, so
  let [p, q] = basePrice.toFraction();
  // These can be higher, but this gives us some leg room.
  const max_p_or_q = new BigNumber(10).pow(20);
  while (p.isGreaterThanOrEqualTo(max_p_or_q) || q.isGreaterThanOrEqualTo(max_p_or_q)) {
    p = p.shiftedBy(-1);
    q = q.shiftedBy(-1);
  }
  // Guard each coefficient against zero — the chain rejects a position
  // whose trading function has p=0 or q=0 ("trading function coefficients
  // must be nonzero"). Original code tested `p.isEqualTo(0)` twice, so `q`
  // was never actually bumped; when the shift loop drives `q` to 0 (18-exp
  // quote vs 6-exp base, price very close to a power of 10) the position
  // shipped with q=0 and pd rejected the tx.
  p = p.plus(Number(p.isEqualTo(0)));
  q = q.plus(Number(q.isEqualTo(0)));
  return { p: pnum(BigInt(p.toFixed(0))).toAmount(), q: pnum(BigInt(q.toFixed(0))).toAmount() };
};

/**
 * Convert a plan into a position.
 *
 * Try using `rangeLiquidityPositions` or `limitOrderPosition` instead, with this method existing
 * as an escape hatch in case any of those use cases aren't sufficient.
 */
// Convert a display-unit amount to a base-unit `Amount`, always rounding
// TOWARDS ZERO. pnum's default rounding is half-up, so a ladder of N rungs
// derived from `total / N` can sum to typed-total + ⌈N/2⌉ base units and the
// user is told "insufficient funds" for a balance the form itself validated
// as sufficient. Cosmos denom convention: never take more of the user's
// asset than what they typed — round down at the base-denom boundary.
const toBaseFloor = (display: number, exponent: number): Amount => {
  if (!Number.isFinite(display) || display <= 0) {
    return pnum(0n).toAmount();
  }
  const shifted = new BigNumber(display).shiftedBy(exponent);
  return pnum(BigInt(shifted.toFixed(0, BigNumber.ROUND_DOWN))).toAmount();
};

const amountIsNonZero = (a?: { lo?: bigint; hi?: bigint }): boolean =>
  a !== undefined && ((a.lo ?? 0n) !== 0n || (a.hi ?? 0n) !== 0n);

/**
 * Quantise a `PositionPlan` into a `LiquidityRung`, or `undefined` when both
 * reserves truncate to zero base units — the same rule `positionHasReserves`
 * applies to a built position, so `rungs.length` always equals the number
 * of positions the plan will actually open.
 */
const planToRung = (plan: PositionPlan): LiquidityRung | undefined => {
  const r1 = toBaseFloor(plan.baseReserves, plan.baseAsset.exponent);
  const r2 = toBaseFloor(plan.quoteReserves, plan.quoteAsset.exponent);
  if (!amountIsNonZero(r1) && !amountIsNonZero(r2)) {
    return undefined;
  }
  return {
    price: plan.price,
    feeBps: plan.feeBps,
    baseReserves: plan.baseReserves,
    quoteReserves: plan.quoteReserves,
    baseAmount: pnum(r1, plan.baseAsset.exponent).toNumber(),
    quoteAmount: pnum(r2, plan.quoteAsset.exponent).toNumber(),
  };
};

const plansToRungs = (plans: PositionPlan[]): LiquidityRung[] => {
  const out: LiquidityRung[] = [];
  for (const plan of plans) {
    const rung = planToRung(plan);
    if (rung) {
      out.push(rung);
    }
  }
  return out;
};

/** Turn already-quantised rungs into positions (nonce + trading function per rung). */
export const rungsToPositions = (
  rungs: LiquidityRung[],
  baseAsset: Asset,
  quoteAsset: Asset,
  shape: LiquidityDistributionShape,
): PositionedLiquidity[] =>
  rungs.map(rung =>
    planToPosition(
      {
        baseAsset,
        quoteAsset,
        feeBps: rung.feeBps,
        price: rung.price,
        // Raw (un-quantised) reserves: `toBaseFloor` is deterministic on the
        // same input, so the built position holds exactly `baseAmount` /
        // `quoteAmount`. Feeding the quantised floats back in could shave a
        // base unit through float error.
        baseReserves: rung.baseReserves,
        quoteReserves: rung.quoteReserves,
      },
      shape,
    ),
  );

export const planToPosition = (
  plan: PositionPlan,
  shape: LiquidityDistributionShape,
): PositionedLiquidity => {
  const { p: rawP, q: rawQ } = priceToPQ(
    plan.price,
    plan.baseAsset.exponent,
    plan.quoteAsset.exponent,
  );
  const rawA1 = plan.baseAsset;
  const rawA2 = plan.quoteAsset;
  const rawR1 = toBaseFloor(plan.baseReserves, plan.baseAsset.exponent);
  const rawR2 = toBaseFloor(plan.quoteReserves, plan.quoteAsset.exponent);

  const correctOrder = compareAssetId(plan.baseAsset.id, plan.quoteAsset.id) <= 0;
  const [[p, q], [r1, r2], [a1, a2]] = correctOrder
    ? [
        [rawP, rawQ],
        [rawR1, rawR2],
        [rawA1, rawA2],
      ]
    : [
        [rawQ, rawP],
        [rawR2, rawR1],
        [rawA2, rawA1],
      ];

  const position = new Position({
    phi: {
      component: {
        fee: plan.feeBps,
        p: pnum(p).toAmount(),
        q: pnum(q).toAmount(),
      },
      pair: new TradingPair({
        asset1: a1.id,
        asset2: a2.id,
      }),
    },
    nonce: crypto.getRandomValues(new Uint8Array(32)),
    state: new PositionState({ state: PositionState_PositionStateEnum.OPENED }),
    reserves: { r1, r2 },
    closeOnFill: false,
  });

  return { position, shape };
};

/**
 * A range liquidity plan provides for creating multiple positions across a range of prices.
 *
 * This plan attempts to distribute reserves across equally spaced price points.
 *
 * It needs to know the market price, to know when to switch from positions that sell the quote
 * asset, to positions that buy the quote asset.
 *
 * All prices are in terms of quoteAsset / baseAsset, in display units.
 *
 * TODO: validate this is superfluous in light of `SimpleLiquidityPlan`?
 */
interface RangeLiquidityPlan {
  baseAsset: Asset;
  quoteAsset: Asset;
  targetLiquidity: number;
  upperPrice: number;
  lowerPrice: number;
  marketPrice: number;
  feeBps: number;
  positions: number;
  distributionShape: LiquidityDistributionShape;
}

/**
 * Defines how liquidity should be distributed across the price range
 */
export enum LiquidityDistributionShape {
  /** Distribution shape alloted to limit orders (single position) */
  LIMIT = 'LIMIT',
  /** Equal distribution across all positions */
  FLAT = 'FLAT',
  /** Higher liquidity near market price, decreasing towards range edges */
  PYRAMID = 'PYRAMID',
  /** Lower liquidity near market price, increasing towards range edges */
  INVERTED_PYRAMID = 'INVERTED_PYRAMID',
  /** Per-rung amounts set explicitly by the user (drag-to-resize on the
   *  preview). Encoded on-chain as ARBITRARY. */
  CUSTOM = 'CUSTOM',
}

/**
 * Defines associative numeric encoding of `LiquidityDistributionShape` representing the strategy tag
 */
export enum LiquidityDistributionStrategy {
  SKIP = 1,
  ARBITRARY = 2,
  FLAT = 3,
  PYRAMID = 4,
  INVERTED_PYRAMID = 5,
}

export interface SimpleLiquidityPlan {
  baseAsset: Asset;
  quoteAsset: Asset;
  baseLiquidity: number;
  quoteLiquidity: number;
  upperPrice: number;
  lowerPrice: number;
  marketPrice: number;
  feeBps: number;
  positions: number;
  distributionShape: LiquidityDistributionShape;
  /** When distributionShape is CUSTOM, one weight per rung, indexed
   *  left-to-right along price (lower..upper). Interpreted as a
   *  distribution: values are normalized against their sum, then
   *  applied to the funded side's liquidity like any other shape.
   *  Length should equal `positions`; if shorter, missing entries
   *  are treated as 0; if longer, extras are ignored. */
  customWeights?: number[];
}

export function encodeLiquidityShape(
  shape: LiquidityDistributionShape,
): LiquidityDistributionStrategy {
  switch (shape) {
    case LiquidityDistributionShape.FLAT:
      return LiquidityDistributionStrategy.FLAT;
    case LiquidityDistributionShape.PYRAMID:
      return LiquidityDistributionStrategy.PYRAMID;
    case LiquidityDistributionShape.INVERTED_PYRAMID:
      return LiquidityDistributionStrategy.INVERTED_PYRAMID;
    // maps `LIMIT` liquidity shape (identifier for limit orders) to an `ARBITRARY` strategy tag.
    case LiquidityDistributionShape.LIMIT:
      return LiquidityDistributionStrategy.ARBITRARY;
    // CUSTOM = per-rung amounts, no computable shape, encoded ARBITRARY.
    case LiquidityDistributionShape.CUSTOM:
      return LiquidityDistributionStrategy.ARBITRARY;
    default:
      return LiquidityDistributionStrategy.SKIP;
  }
}

export const getPositionWeights = (
  positions: number,
  shape: LiquidityDistributionShape,
): number[] => {
  if (positions === 1) {
    return [1];
  }

  return Array.from({ length: positions }, (_, i) => {
    const normalizedIndex = i / (positions - 1);
    switch (shape) {
      case LiquidityDistributionShape.FLAT:
        return 1;
      case LiquidityDistributionShape.PYRAMID:
        // Creates a pyramid shape with peak at middle
        return 0.1 + 0.9 * (1 - Math.abs(normalizedIndex - 0.5) * 2);
      case LiquidityDistributionShape.INVERTED_PYRAMID:
        // Creates an inverted pyramid with peaks at edges
        return Math.abs(normalizedIndex - 0.5) * 2;
      default:
        return 1;
    }
  });
};

/**
 * True when a built position provisions a non-zero amount of at least one asset,
 * measured in *base* units — i.e. exactly what the chain checks.
 *
 * `Position::check_stateless` in pd rejects the whole transaction with
 * "initial reserves must provision some amount of either asset" if r1 and r2
 * are both zero. Because reserves are quantised to base units by
 * `pnum(x, exponent).toAmount()`, a display-unit amount that is merely *small*
 * (a thin outer rung of a PYRAMID split, or the empty side of a one-sided
 * range) truncates to zero and poisons an otherwise valid batch. Filtering
 * those rungs out here is what lets a small or one-sided LP land on the first
 * try instead of being rejected wholesale.
 */
export const positionHasReserves = ({ reserves }: Position): boolean => {
  const r1 = reserves?.r1;
  const r2 = reserves?.r2;
  const nonZero = (a?: { lo?: bigint; hi?: bigint }): boolean =>
    a !== undefined && ((a.lo ?? 0n) !== 0n || (a.hi ?? 0n) !== 0n);
  return nonZero(r1) || nonZero(r2);
};

/**
 * The cheap half of `rangeLiquidityPositions`: rung prices + reserves,
 * filtered exactly as the built positions would be, no protos and no nonces.
 */
export const rangeLiquidityRungs = (plan: RangeLiquidityPlan): LiquidityRung[] => {
  // The step width is positions-1 because it's between the endpoints
  // |---|---|---|---|
  // 0   1   2   3   4
  //   0   1   2   3
  const stepWidth = (plan.upperPrice - plan.lowerPrice) / plan.positions;
  return plansToRungs(
    Array.from({ length: plan.positions }, (_, i) => {
      const price = plan.lowerPrice + i * stepWidth;

      let baseReserves: number;
      let quoteReserves: number;
      if (price < plan.marketPrice) {
        // If the price is < market price, then people *paying* that price are getting a good deal,
        // and receiving the base asset in exchange, so we don't want to offer them any of that.
        baseReserves = 0;
        quoteReserves = plan.targetLiquidity / plan.positions;
      } else {
        // Conversely, when price > market price, then the people that are selling the base asset,
        // receiving the quote asset in exchange are getting a good deal, so we don't want to offer that.
        baseReserves = plan.targetLiquidity / plan.positions / price;
        quoteReserves = 0;
      }

      return {
        baseAsset: plan.baseAsset,
        quoteAsset: plan.quoteAsset,
        feeBps: plan.feeBps,
        price,
        baseReserves,
        quoteReserves,
      };
    }),
  );
};

/** Given a plan for providing range liquidity, create all the necessary positions to accomplish the plan. */
export const rangeLiquidityPositions = (plan: RangeLiquidityPlan): PositionedLiquidity[] =>
  rungsToPositions(
    rangeLiquidityRungs(plan),
    plan.baseAsset,
    plan.quoteAsset,
    plan.distributionShape,
  );

/** Given a plan for providing simple liquidity, create all the necessary positions to accomplish the plan. */
export const simpleLiquidityPositions = (plan: SimpleLiquidityPlan): PositionedLiquidity[] =>
  rungsToPositions(
    simpleLiquidityRungs(plan),
    plan.baseAsset,
    plan.quoteAsset,
    plan.distributionShape,
  );

/**
 * Weight of a rung by its distance from mid, `f` in [0, 1] (0 = the rung
 * nearest mid, 1 = the far edge of its side). One rule for both sides and
 * for one-sided ladders, so a shape means the same thing everywhere:
 * Concentrated is heavy at mid, Linear is even, Volatile is light at mid and
 * heavy at the edge. (A one-sided ladder used to ignore the chosen shape and
 * always ramp like Volatile, while the chain recorded the chosen one.)
 */
export const shapeWeight = (shape: LiquidityDistributionShape, f: number): number => {
  const t = Math.max(0, Math.min(1, f));
  switch (shape) {
    case LiquidityDistributionShape.PYRAMID:
      return 1 - 0.9 * t;
    case LiquidityDistributionShape.INVERTED_PYRAMID:
      return 0.1 + 0.9 * t;
    default:
      return 1;
  }
};

/** Position of rung `i` of `count` on a side, as distance from mid in [0, 1]. */
const distanceFromMid = (i: number, count: number, midAtStart: boolean): number => {
  if (count <= 1) {
    return 0;
  }
  const f = i / (count - 1);
  return midAtStart ? f : 1 - f;
};

/** One rung of a planned ladder, before quantising and dropping empty rungs. */
export interface LadderRung {
  /** Index into the ladder (and into `customWeights`), 0 = lowest price. */
  index: number;
  price: number;
  side: 'buy' | 'sell';
  /** Display units: base on asks, quote on bids. */
  baseReserves: number;
  quoteReserves: number;
  /** This rung's share of its side's total, in [0, 1]; a side sums to 1. */
  share: number;
}

/**
 * The full ladder for a simple LP: every one of `plan.positions` rungs with
 * its price, side, reserves and share of its side. The single source for
 * the built positions (via `simpleLiquidityRungs`), the chart preview and
 * custom-weight seeding, so what is drawn and dragged is what gets opened.
 *
 * Custom weights, when set, are per ladder index and normalised within each
 * side: making one rung smaller makes the others on its side larger, and
 * the side's total never changes.
 */
export const simpleLiquidityLadder = (plan: SimpleLiquidityPlan): LadderRung[] => {
  const hasBase = plan.baseLiquidity > 0;
  const hasQuote = plan.quoteLiquidity > 0;
  const custom =
    plan.distributionShape === LiquidityDistributionShape.CUSTOM && plan.customWeights
      ? plan.customWeights
      : undefined;
  // A CUSTOM ladder without weights (shouldn't happen) reads as Linear.
  const baseShape =
    plan.distributionShape === LiquidityDistributionShape.CUSTOM
      ? LiquidityDistributionShape.FLAT
      : plan.distributionShape;

  if (hasBase !== hasQuote) {
    return oneSidedLadder(plan, hasBase ? 'base' : 'quote', custom, baseShape);
  }

  // Two-sided: split at mid clamped into the range. Raw mid is only inside
  // [lower, upper] when the range straddles it; for a range set wholly
  // above or below mid, clamping keeps every rung inside the chosen range.
  const totalRange = plan.upperPrice - plan.lowerPrice;
  const anchorPrice = Math.min(Math.max(plan.marketPrice, plan.lowerPrice), plan.upperPrice);
  const marketPosition = (anchorPrice - plan.lowerPrice) / totalRange;
  // Clamp so the split always sums to exactly `plan.positions`.
  const lowerCount = Math.min(
    plan.positions,
    Math.max(0, Math.floor(plan.positions * marketPosition)),
  );
  const upperCount = plan.positions - lowerCount;
  // Finite even for an empty side, so no NaN price can reach priceToPQ.
  const lowerStep = lowerCount > 0 ? (anchorPrice - plan.lowerPrice) / lowerCount : 0;
  const upperStep = upperCount > 0 ? (plan.upperPrice - anchorPrice) / upperCount : 0;

  const weightAt = (index: number, sideIndex: number, sideCount: number, midAtStart: boolean) =>
    custom
      ? Math.max(0, custom[index] ?? 0)
      : shapeWeight(baseShape, distanceFromMid(sideIndex, sideCount, midAtStart));

  // Bids ascend toward mid (mid at the end); asks start at mid.
  const lowerWeights = Array.from({ length: lowerCount }, (_, i) =>
    weightAt(i, i, lowerCount, false),
  );
  const upperWeights = Array.from({ length: upperCount }, (_, i) =>
    weightAt(lowerCount + i, i, upperCount, true),
  );
  const lowerTotal = lowerWeights.reduce((s, w) => s + w, 0) || 1;
  const upperTotal = upperWeights.reduce((s, w) => s + w, 0) || 1;

  const lower = lowerWeights.map((w, i): LadderRung => {
    const share = w / lowerTotal;
    return {
      index: i,
      price: plan.lowerPrice + i * lowerStep,
      side: 'buy',
      baseReserves: 0,
      quoteReserves: plan.quoteLiquidity * share,
      share,
    };
  });
  const upper = upperWeights.map((w, i): LadderRung => {
    const share = w / upperTotal;
    return {
      index: lowerCount + i,
      price: anchorPrice + i * upperStep,
      side: 'sell',
      baseReserves: plan.baseLiquidity * share,
      quoteReserves: 0,
      share,
    };
  });
  return [...lower, ...upper];
};

const oneSidedLadder = (
  plan: SimpleLiquidityPlan,
  side: 'base' | 'quote',
  custom: number[] | undefined,
  shape: LiquidityDistributionShape,
): LadderRung[] => {
  // Mid inside the range (straddle): only the funded side's half, so a
  // base-only ladder never sells below market. Mid outside: the whole
  // range, the trader's explicit off-mid placement (the validator warns).
  const { lowerPrice: lower, upperPrice: upper, marketPrice: mid } = plan;
  const midInRange = mid >= lower && mid <= upper;
  let from = lower;
  let to = upper;
  if (midInRange) {
    if (side === 'base') {
      from = Math.max(mid, lower);
    } else {
      to = Math.min(mid, upper);
    }
  }
  const span = to - from;
  const n = plan.positions;
  // Non-finite bounds or span would put NaN prices into priceToPQ.
  if (
    span <= 0 ||
    n <= 0 ||
    !Number.isFinite(span) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to)
  ) {
    return [];
  }
  // Asks (base) start at mid; bids (quote) end at mid.
  const midAtStart = side === 'base';
  const weights = Array.from({ length: n }, (_, i) =>
    custom ? Math.max(0, custom[i] ?? 0) : shapeWeight(shape, distanceFromMid(i, n, midAtStart)),
  );
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const totalLiq = side === 'base' ? plan.baseLiquidity : plan.quoteLiquidity;
  const step = span / n;
  return weights.map((w, i): LadderRung => {
    const share = w / total;
    // `share` of the funded side, already in that side's display units.
    const amount = totalLiq * share;
    return {
      index: i,
      price: from + i * step,
      side: side === 'base' ? 'sell' : 'buy',
      baseReserves: side === 'base' ? amount : 0,
      quoteReserves: side === 'quote' ? amount : 0,
      share,
    };
  });
};

/**
 * The cheap half of `simpleLiquidityPositions`: rung prices + reserves,
 * filtered exactly as the built positions would be (a rung that quantises
 * to nothing is dropped: the chain rejects an empty position).
 */
export const simpleLiquidityRungs = (plan: SimpleLiquidityPlan): LiquidityRung[] =>
  plansToRungs(
    simpleLiquidityLadder(plan).map(
      (r): PositionPlan => ({
        baseAsset: plan.baseAsset,
        quoteAsset: plan.quoteAsset,
        feeBps: plan.feeBps,
        price: r.price,
        baseReserves: r.baseReserves,
        quoteReserves: r.quoteReserves,
      }),
    ),
  );

/** A limit order plan attempts to buy or sell the baseAsset at a given price.
 *
 * This price is always in terms of quoteAsset / baseAsset.
 *
 * The input is the quote asset when buying, and the base asset when selling, and in display units.
 */
interface LimitOrderPlan {
  buy: 'buy' | 'sell';
  price: number;
  input: number;
  baseAsset: Asset;
  quoteAsset: Asset;
  distributionShape: LiquidityDistributionShape;
}

export const limitOrderPosition = (plan: LimitOrderPlan): PositionedLiquidity => {
  let baseReserves: number;
  let quoteReserves: number;
  if (plan.buy === 'buy') {
    baseReserves = 0;
    quoteReserves = plan.input;
  } else {
    baseReserves = plan.input;
    quoteReserves = 0;
  }
  const pos = planToPosition(
    {
      baseAsset: plan.baseAsset,
      quoteAsset: plan.quoteAsset,
      feeBps: 0,
      price: plan.price,
      baseReserves,
      quoteReserves,
    },
    plan.distributionShape,
  );
  pos.position.closeOnFill = true;
  return pos;
};
