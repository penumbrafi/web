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

interface SimpleLiquidityPlan {
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

const withReserves = (positions: PositionedLiquidity[]): PositionedLiquidity[] =>
  positions.filter(p => positionHasReserves(p.position));

/** Given a plan for providing range liquidity, create all the necessary positions to accomplish the plan. */
export const rangeLiquidityPositions = (plan: RangeLiquidityPlan): PositionedLiquidity[] => {
  // The step width is positions-1 because it's between the endpoints
  // |---|---|---|---|
  // 0   1   2   3   4
  //   0   1   2   3
  const stepWidth = (plan.upperPrice - plan.lowerPrice) / plan.positions;
  return withReserves(
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

      return planToPosition(
        {
          baseAsset: plan.baseAsset,
          quoteAsset: plan.quoteAsset,
          feeBps: plan.feeBps,
          price,
          baseReserves,
          quoteReserves,
        },
        plan.distributionShape,
      );
    }),
  );
};

/** Given a plan for providing simple liquidity, create all the necessary positions to accomplish the plan. */
export const simpleLiquidityPositions = (plan: SimpleLiquidityPlan): PositionedLiquidity[] => {
  const hasBase = plan.baseLiquidity > 0;
  const hasQuote = plan.quoteLiquidity > 0;

  // One-sided funding: use every position on the funded side across
  // [mid, upper] (base only, ask ladder) or [lower, mid] (quote only, bid
  // ladder), instead of splitting positions in two and leaving half as
  // zero-reserve dead rungs. Weights are computed across the full n so
  // PYRAMID reads as a monotonic stair heavy near mid, and
  // INVERTED_PYRAMID as a stair heavy at the edge.
  if (hasBase && !hasQuote) {
    return oneSidedPositions(plan, 'base');
  }
  if (hasQuote && !hasBase) {
    return oneSidedPositions(plan, 'quote');
  }

  // Two-sided path. The split is anchored at mid *clamped into the range*,
  // not at raw mid. Raw mid is only inside [lower, upper] when the range
  // straddles it; for a deliberately one-sided range (with both sides funded
  // but the range set entirely above or below mid) it sits outside, and
  // using it as the start of the upper rungs (or the end of the lower
  // rungs) laid positions clean outside the range the user chose. With the
  // range straddling mid the anchor IS mid, so nothing changes.
  const totalRange = plan.upperPrice - plan.lowerPrice;
  const anchorPrice = Math.min(Math.max(plan.marketPrice, plan.lowerPrice), plan.upperPrice);
  const marketPosition = (anchorPrice - plan.lowerPrice) / totalRange;

  // Position-count split. `marketPosition` is only in [0, 1] when mid sits
  // inside the range; for a one-sided range it drifts out of bounds, and the
  // unclamped `floor(positions * marketPosition)` could exceed
  // `plan.positions`, opening more rungs than the form advertised. Clamp so
  // the split always sums to exactly `plan.positions`.
  const lowerPositionsAmount = Math.min(
    plan.positions,
    Math.max(0, Math.floor(plan.positions * marketPosition)),
  );
  const upperPositionsAmount = plan.positions - lowerPositionsAmount;

  // Guard the zero-count side: a fully one-sided range leaves one of these
  // at 0 and the division would yield Infinity/NaN prices. The corresponding
  // Array.from({length: 0}) never reads the value, but keeping it finite
  // means a stray NaN can never reach priceToPQ and silently produce p=q=0
  // coefficients the chain rejects ("trading function coefficients must be
  // nonzero").
  const lowerStepWidth =
    lowerPositionsAmount > 0 ? (anchorPrice - plan.lowerPrice) / lowerPositionsAmount : 0;
  const upperStepWidth =
    upperPositionsAmount > 0 ? (plan.upperPrice - anchorPrice) / upperPositionsAmount : 0;

  // CUSTOM uses the user-supplied per-rung weights verbatim; every other
  // shape derives them from the shape formula. Length is padded/truncated
  // to match the split total.
  const rawWeights =
    plan.distributionShape === LiquidityDistributionShape.CUSTOM && plan.customWeights
      ? plan.customWeights
      : getPositionWeights(lowerPositionsAmount + upperPositionsAmount, plan.distributionShape);
  const weights = Array.from(
    { length: lowerPositionsAmount + upperPositionsAmount },
    (_, i) => rawWeights[i] ?? 0,
  );

  const lowerRangeTotalWeight = weights
    .slice(0, lowerPositionsAmount)
    .reduce((sum, w) => sum + w, 0);
  const upperRangeTotalWeight = weights.slice(lowerPositionsAmount).reduce((sum, w) => sum + w, 0);

  const lowerPositions = Array.from({ length: lowerPositionsAmount }, (_, i) => {
    const price = plan.lowerPrice + i * lowerStepWidth;
    const weight = (weights[i] ?? 0) / (lowerRangeTotalWeight || 1);
    return planToPosition(
      {
        baseAsset: plan.baseAsset,
        quoteAsset: plan.quoteAsset,
        feeBps: plan.feeBps,
        price,
        baseReserves: 0,
        quoteReserves: plan.quoteLiquidity * weight,
      },
      plan.distributionShape,
    );
  });

  const upperPositions = Array.from({ length: upperPositionsAmount }, (_, i) => {
    const price = anchorPrice + i * upperStepWidth;
    const weight = (weights[i + lowerPositionsAmount] ?? 0) / (upperRangeTotalWeight || 1);
    return planToPosition(
      {
        baseAsset: plan.baseAsset,
        quoteAsset: plan.quoteAsset,
        feeBps: plan.feeBps,
        price,
        baseReserves: plan.baseLiquidity * weight,
        quoteReserves: 0,
      },
      plan.distributionShape,
    );
  });

  return withReserves([...lowerPositions, ...upperPositions]);
};

const oneSidedPositions = (
  plan: SimpleLiquidityPlan,
  side: 'base' | 'quote',
): PositionedLiquidity[] => {
  // Base only → asks between max(mid, lower) and upper.
  // Quote only → bids between lower and min(mid, upper).
  const from = side === 'base' ? Math.max(plan.marketPrice, plan.lowerPrice) : plan.lowerPrice;
  const to = side === 'base' ? plan.upperPrice : Math.min(plan.marketPrice, plan.upperPrice);
  const span = to - from;
  const n = plan.positions;
  // Also bail on non-finite span or non-finite bounds — a NaN
  // marketPrice or bound would silently produce NaN prices below and
  // crash priceToPQ inside BigNumber.toFraction with the cryptic
  // "n.default is not iterable" destructuring error. Better a
  // no-op empty plan than a hard crash.
  if (
    span <= 0 ||
    n <= 0 ||
    !Number.isFinite(span) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to)
  ) {
    return [];
  }

  // One-sided always uses the volatile / INVERTED_PYRAMID growth (light
  // near mid, rising to the far edge), regardless of the shape the
  // trader picked in the form. Concentrated (heavy near mid) on a
  // one-sided plan empties the near-mid rungs on the first tick and
  // leaves the LP holding empty positions; volatile keeps inventory
  // out where it can catch a real swing. FLAT is a valid honest
  // uniform, but the overlay preview also flips to volatile for one-
  // sided so the preview matches this path.
  const nearMidFraction = (i: number) => (n === 1 ? 0 : i / (n - 1));
  const weightAt = (i: number): number => 0.1 + 0.9 * nearMidFraction(i);

  // 'from' is the mid end for base-side; the low end for quote-side.
  // Emit rungs left-to-right (ascending price) either way.
  const midEndIsFrom = side === 'base';
  const isCustom =
    plan.distributionShape === LiquidityDistributionShape.CUSTOM && plan.customWeights;
  const weights = isCustom
    ? Array.from({ length: n }, (_, priceIdx) => plan.customWeights?.[priceIdx] ?? 0)
    : Array.from({ length: n }, (_, priceIdx) => {
        const distFromMidIdx = midEndIsFrom ? priceIdx : n - 1 - priceIdx;
        return weightAt(distFromMidIdx);
      });
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const totalLiq = side === 'base' ? plan.baseLiquidity : plan.quoteLiquidity;
  const step = span / n;

  const built = Array.from({ length: n }, (_, i) => {
    const price = from + i * step;
    const share = totalLiq * ((weights[i] ?? 0) / total);
    return planToPosition(
      {
        baseAsset: plan.baseAsset,
        quoteAsset: plan.quoteAsset,
        feeBps: plan.feeBps,
        price,
        // `share` is already in the funded side's display units — no price
        // conversion. plan.baseLiquidity and plan.quoteLiquidity are each in
        // their own denomination per SimpleLiquidityPlan; dividing by price
        // here (as rangeLiquidityPositions does for its quote-denominated
        // targetLiquidity) would inflate the base reserves by ~1/price.
        baseReserves: side === 'base' ? share : 0,
        quoteReserves: side === 'quote' ? share : 0,
      },
      plan.distributionShape,
    );
  });
  // Same zero-reserve filter as the two-sided path — a thin outer PYRAMID
  // rung on a small size can truncate to zero and the chain rejects the tx.
  return withReserves(built);
};

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
