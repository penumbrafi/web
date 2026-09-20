import { scaleLinear } from 'd3-scale';
import { openToast } from '@penumbra-zone/ui/Toast';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import {
  LiquidityDistributionShape,
  PositionedLiquidity,
  simpleLiquidityPositions,
} from '@/shared/math/position';
import { parseNumber } from '@/shared/utils/num';
import { Position } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import { makeAutoObservable } from 'mobx';
import { round } from '@penumbra-zone/types/round';

const extractAmount = (positions: Position[], asset: AssetInfo): number => {
  let out = 0.0;
  for (const position of positions) {
    const asset1 = position.phi?.pair?.asset1;
    const asset2 = position.phi?.pair?.asset2;
    if (asset1?.equals(asset.id)) {
      out += pnum(position.reserves?.r1, asset.exponent).toNumber();
    }
    if (asset2?.equals(asset.id)) {
      out += pnum(position.reserves?.r2, asset.exponent).toNumber();
    }
  }
  return out;
};

const DEFAULT_POSITION_COUNT = 10;
export const DEFAULT_PRICE_SPREAD = 0.05;
export const STABLE_PRICE_SPREAD = 0.01;
export const DEFAULT_PRICE_RANGE = 0.3;
export const STABLE_PRICE_RANGE = 0.1;
const DEFAULT_FEE_TIER_PERCENT = 0.1;

/**
 * The fee a position charges takers, as a percentage.
 *
 * A position's fee is part of its trading function, not a protocol setting —
 * it is what the LP earns when someone trades against them. The form has
 * always had a `feeTierPercent`, defaulted to 0.1%, but never rendered it
 * anywhere, so LPs could neither see nor choose what they were charging.
 * These four are the conventional tiers: stable pairs at the bottom, volatile
 * and exotic pairs higher up, to compensate for inventory risk.
 */
export enum LPFeeTierOptions {
  Stable = '0.05%',
  Standard = '0.1%',
  Volatile = '0.3%',
  Exotic = '1%',
}

/**
 * Shape of `LPFormStore.offMidWarning`. The two wholly-off kinds are
 * advisory (the full range is built); `partial-straddle` means the
 * one-sided planner clamped the range to the funded side and the other
 * portion was dropped.
 */
export type OffMidWarningKind = 'bids-above-mid' | 'asks-below-mid' | 'partial-straddle';

export const LP_FEE_TIER_PERCENTS: Record<LPFeeTierOptions, string> = {
  [LPFeeTierOptions.Stable]: '0.05',
  [LPFeeTierOptions.Standard]: '0.1',
  [LPFeeTierOptions.Volatile]: '0.3',
  [LPFeeTierOptions.Exotic]: '1',
};

export class LPFormStore {
  private _baseAsset?: AssetInfo;
  private _quoteAsset?: AssetInfo;
  private lastTouchedInput: 'base' | 'quote' | null = null;

  baseInput = '';
  quoteInput = '';
  upperPriceInput: number | null = null;
  lowerPriceInput: number | null = null;
  feeTierPercentInput = String(DEFAULT_FEE_TIER_PERCENT);
  marketPrice: number | null = null;
  /**
   * User-specified reference price for the ladder's mid. When set, this
   * REPLACES the live-derived mid for every calculation the LP form does:
   * bid/ask split in the two-sided planner, wrongSide detection, off-mid
   * warning, opposite-input auto-fill. The live mid stays available on
   * `marketPrice` for the UI's "current" indicator. Cleared by leaving
   * the input blank.
   *
   * Motivation: on thin/wide-spread pairs the arithmetic midpoint of
   * touch prices is meaningless (e.g. 1.207 between best-bid 0.746 and
   * best-ask 1.668), and it forces a range that spans the user's real
   * intent (say 0.98–1.03) into a wholly-below-mid shape that the
   * planner treats as bid-only. Letting the user say "for THIS LP,
   * treat 1.0 as fair" turns it back into a normal two-sided ladder.
   */
  userReferencePriceInput = '';
  positions = DEFAULT_POSITION_COUNT;
  liquidityShape: LiquidityDistributionShape = LiquidityDistributionShape.FLAT;
  // Populated when the user drags a bar in the LP preview to override the
  // shape's computed per-rung amount. Length is aligned to `positions`.
  // Cleared when the user picks any non-CUSTOM shape.
  customWeights: number[] | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  get baseAsset(): undefined | AssetInfo {
    return this._baseAsset;
  }

  get quoteAsset(): undefined | AssetInfo {
    return this._quoteAsset;
  }

  /**
   * Visualization & explanation of the scale and logic:
   * - If the price is lower than the market price, then offer quote
   * - If the price is higher than the market price, then offer base
   * - The scale is used to calculate the amount of opposite asset we want to offer
   *
   * Asset to Offer:         quote       base
   * Scale:           |---|----------|----------|---|
   * Domain (prices):   lower      market     upper
   * Range (amounts):    -10         0          10
   *            (or):     10         0         -10
   */
  updateOppositeInput = () => {
    // Use effectiveMarketPrice so the auto-fill respects a user-supplied
    // reference price. Otherwise a user overriding mid to 1.0 on a
    // book with live mid 1.207 would still get the opposite input
    // filled against 1.207 — producing an amount they can't afford or
    // that doesn't match their intent.
    const mid = this.effectiveMarketPrice;
    if (
      mid === null ||
      this.lowerPriceInput === null ||
      this.upperPriceInput === null
    ) {
      return;
    }

    if (this.lastTouchedInput === 'quote' && this.quoteInput === '') {
      this.baseInput = '';
    } else if (this.lastTouchedInput === 'quote' && this.quoteInput !== '') {
      const scale = scaleLinear()
        .domain([this.lowerPriceInput, mid])
        // eslint-disable-next-line @typescript-eslint/no-unsafe-unary-minus -- explicitly set a negative value to get a positive output
        .range([-this.quoteInput, 0]);

      const valueInQuote = scale(this.upperPriceInput);

      this.baseInput = round({
        value: String(Math.max(0, valueInQuote / mid)) || '',
        decimals: this.baseAsset?.exponent ?? 6,
        exponentialNotation: false,
      });
    }

    if (this.lastTouchedInput === 'base' && this.baseInput === '') {
      this.quoteInput = '';
    } else if (this.lastTouchedInput === 'base' && this.baseInput !== '') {
      const scale = scaleLinear()
        .domain([mid, this.upperPriceInput])
        // eslint-disable-next-line @typescript-eslint/no-unsafe-unary-minus -- explicitly set a negative value to get a positive output
        .range([0, -this.baseInput]);

      const valueInBase = scale(this.lowerPriceInput);

      this.quoteInput = round({
        value: String(Math.max(0, valueInBase * mid)) || '',
        decimals: this.quoteAsset?.exponent ?? 6,
        exponentialNotation: false,
      });
    }
  };

  setBaseInput = (x: string) => {
    this.baseInput = x.replace(/[^0-9.,]/g, '');
    this.lastTouchedInput = 'base';

    this.updateOppositeInput();
  };

  setQuoteInput = (x: string) => {
    this.quoteInput = x.replace(/[^0-9.,]/g, '');
    this.lastTouchedInput = 'quote';

    this.updateOppositeInput();
  };

  get lowerPrice(): number | null {
    return this.lowerPriceInput;
  }

  setLowerPriceInput = (x: number) => {
    this.lowerPriceInput = x;

    // Compare against the EFFECTIVE mid: with a user reference price set,
    // the plan splits on that, so testing the live mid here would fire
    // "asks only" and wipe the quote input for a range the plan treats
    // as perfectly two-sided.
    const mid = this.effectiveMarketPrice;
    if (this.lastTouchedInput === 'quote' && mid && this.lowerPriceInput > mid) {
      if (this.quoteInput !== '') {
        openToast({
          type: 'warning',
          message: `Range is entirely above mid — asks only.`,
          description: `${this._quoteAsset?.symbol} can only be quoted below the mid price, so that side has been cleared. Enter a ${this._baseAsset?.symbol} amount to quote asks; it will start earning once the market trades up into your range.`,
        });
      }

      this.quoteInput = '';
    }

    this.updateOppositeInput();
  };

  get upperPrice(): number | null {
    return this.upperPriceInput;
  }

  setUpperPriceInput = (x: number) => {
    this.upperPriceInput = x;

    // Effective mid, same reasoning as setLowerPriceInput.
    const mid = this.effectiveMarketPrice;
    if (this.lastTouchedInput === 'base' && mid && this.upperPriceInput < mid) {
      if (this.baseInput !== '') {
        openToast({
          type: 'warning',
          message: `Range is entirely below mid — bids only.`,
          description: `${this._baseAsset?.symbol} can only be quoted above the mid price, so that side has been cleared. Enter a ${this._quoteAsset?.symbol} amount to quote bids; it will start earning once the market trades down into your range.`,
        });
      }

      this.baseInput = '';
    }

    this.updateOppositeInput();
  };

  // Treat fees that don't parse as 0
  get feeTierPercent(): number {
    return Math.max(0, Math.min(parseNumber(this.feeTierPercentInput) ?? 0, 50));
  }

  feeTierOption: LPFeeTierOptions | undefined = LPFeeTierOptions.Standard;

  setFeeTierPercentInput = (x: string) => {
    this.feeTierPercentInput = x;
    this.feeTierOption = Object.values(LPFeeTierOptions).find(
      option => LP_FEE_TIER_PERCENTS[option] === x,
    );
  };

  setFeeTierOption = (option: LPFeeTierOptions) => {
    this.setFeeTierPercentInput(LP_FEE_TIER_PERCENTS[option]);
  };

  /** The base amount actually being provisioned, treating a blank field as zero. */
  get baseLiquidity(): number {
    return parseNumber(this.baseInput) ?? 0;
  }

  /** The quote amount actually being provisioned, treating a blank field as zero. */
  get quoteLiquidity(): number {
    return parseNumber(this.quoteInput) ?? 0;
  }

  /**
   * The user's explicit "reference price" for this LP, parsed from
   * `userReferencePriceInput`. `null` when unset or non-numeric.
   */
  get userReferencePrice(): number | null {
    const parsed = parseNumber(this.userReferencePriceInput);
    if (parsed === undefined || !Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  setUserReferencePriceInput = (x: string) => {
    this.userReferencePriceInput = x;
    // The auto-filled side was computed against the previous mid; redo
    // it so the opposite input tracks the new anchor.
    this.updateOppositeInput();
  };

  /**
   * Mid price the plan anchors to. Precedence:
   *   1. `userReferencePrice` — explicit user override (highest weight)
   *   2. live `marketPrice` — derived from the route book
   *   3. midpoint of the range as a last-resort bootstrap (fresh pair,
   *      empty book)
   * Returns `null` only when we truly have nothing.
   *
   * Without a real value here, `simpleLiquidityPositions` receives
   * `undefined`, `Math.min(undefined, x)` returns NaN, and the LP form
   * degrades to a misleading "amounts too small" for a perfectly-sized
   * plan on a new pair.
   */
  get effectiveMarketPrice(): number | null {
    const override = this.userReferencePrice;
    if (override !== null) return override;
    if (this.marketPrice !== null && Number.isFinite(this.marketPrice)) {
      return this.marketPrice;
    }
    const lo = this.lowerPriceInput;
    const hi = this.upperPriceInput;
    if (lo === null || hi === null || !Number.isFinite(lo) || !Number.isFinite(hi)) {
      return null;
    }
    return (lo + hi) / 2;
  }

  /** True when only one of the two assets is being provisioned. */
  get isOneSided(): boolean {
    return this.baseLiquidity > 0 !== this.quoteLiquidity > 0;
  }

  /**
   * Which side has been funded that gets DROPPED by the two-sided ladder
   * planner because the range sits wholly on the other side of mid.
   * BLOCKING: quiet fund loss, user should either widen the range or drop
   * the ignored input.
   *
   * The one-sided-off-mid case (funded only quote/base with range wholly
   * on the opposite side) is NOT a bug any more — one-sided ladders build
   * across the full range when mid is outside it. That case surfaces as
   * `offMidWarning` instead, letting the user proceed with a clear
   * arb-risk hint.
   */
  get wrongSideFunded(): 'base' | 'quote' | undefined {
    // Uses `effectiveMarketPrice` so a user-supplied reference price
    // takes precedence over the live-derived mid. Without this, a user
    // who overrides the mid to place a two-sided ladder inside a
    // wide-spread market would still be blocked by the live mid.
    const mid = this.effectiveMarketPrice;
    if (mid === null || this.lowerPriceInput === null || this.upperPriceInput === null) {
      return undefined;
    }
    // Two-sided funding but the range sits wholly on one side of mid: the
    // two-sided ladder path in `simpleLiquidityPositions` still silently
    // drops the side whose rung count computes to 0. Report the *dropped*
    // side so the user sees what would be ignored instead of finding out
    // via a missing balance.
    if (this.lowerPriceInput >= mid && this.baseLiquidity > 0 && this.quoteLiquidity > 0) {
      return 'quote';
    }
    if (this.upperPriceInput <= mid && this.baseLiquidity > 0 && this.quoteLiquidity > 0) {
      return 'base';
    }
    return undefined;
  }

  /**
   * One-sided LP where the funded side is on the "unfavourable" side of
   * mid — e.g. quote-only above mid (paying above-market to buy base) or
   * base-only below mid (selling base below market). The chain accepts it;
   * arbitrageurs likely eat it immediately. Not a blocker, just a loud
   * warning so users who mean it can proceed and users who fat-fingered
   * the range can catch it.
   *
   * Third case, `partial-straddle`: one-sided funding with a range that
   * CROSSES the anchor mid. `oneSidedPositions` clamps the ladder to the
   * funded side's half (base → [mid, upper], quote → [lower, mid]) so no
   * rung is quoted at a loss; the other half is silently dropped. Warn
   * so the user knows their range is being trimmed.
   */
  get offMidWarning(): OffMidWarningKind | undefined {
    if (this.lowerPriceInput === null || this.upperPriceInput === null) {
      return undefined;
    }
    if (!this.isOneSided) return undefined;

    // Wholly-off cases use the LIVE mid (not effective) — the user-
    // supplied reference price is precisely them saying "for my purposes
    // 1.0 IS mid," so no off-mid warning is appropriate for a range that
    // sits to one side of their choice. Warning fires only when a one-
    // sided range diverges from the actual live market they're posting
    // into.
    const live = this.marketPrice;
    if (live !== null) {
      if (this.lowerPriceInput >= live && this.quoteLiquidity > 0) {
        // Only quote funded, range above mid → bidding on base at
        // above-market prices.
        return 'bids-above-mid';
      }
      if (this.upperPriceInput <= live && this.baseLiquidity > 0) {
        // Only base funded, range below mid → offering base at
        // below-market prices.
        return 'asks-below-mid';
      }
    }

    // Straddle uses the EFFECTIVE mid — that is what `oneSidedPositions`
    // receives as `plan.marketPrice`, so it is the anchor the clamp
    // actually trims against.
    const mid = this.effectiveMarketPrice;
    if (mid !== null && this.lowerPriceInput < mid && this.upperPriceInput > mid) {
      return 'partial-straddle';
    }
    return undefined;
  }

  get plan(): PositionedLiquidity[] | undefined {
    if (
      !this._baseAsset ||
      !this._quoteAsset ||
      this.upperPrice === null ||
      this.lowerPrice === null ||
      this.effectiveMarketPrice === null
    ) {
      return undefined;
    }

    // A one-sided LP — all bids or all asks — is a legitimate and common
    // strategy, and is what a range that sits entirely to one side of mid
    // *means*. Requiring both fields to be non-empty made it unreachable:
    // dragging the range off mid clears the opposite input (see
    // set{Lower,Upper}PriceInput), which then left `plan` undefined and the
    // submit button permanently, silently dead. See penumbra-zone/web#2551.
    // Only a genuinely empty form has nothing to plan.
    if (this.baseLiquidity <= 0 && this.quoteLiquidity <= 0) {
      return undefined;
    }

    return simpleLiquidityPositions({
      baseAsset: this._baseAsset,
      quoteAsset: this._quoteAsset,
      baseLiquidity: this.baseLiquidity,
      quoteLiquidity: this.quoteLiquidity,
      upperPrice: this.upperPrice,
      lowerPrice: this.lowerPrice,
      marketPrice: this.effectiveMarketPrice,
      // feeBps is a uint32 on-chain and downstream conversion via
      // simpleLiquidityPositions -> Position.phi.fee bails on a
      // non-integer with "invalid uint 32: 57.99999999999999" when
      // the fee slider's logarithmic interpolation produces a value
      // like 0.5799999999999999. Round to the nearest bp.
      feeBps: Math.round(this.feeTierPercent * 100),
      positions: this.positions,
      distributionShape: this.liquidityShape,
      customWeights: this.customWeights ?? undefined,
    });
  }

  get baseAssetAmount(): string | undefined {
    const baseAsset = this._baseAsset;
    const plan = this.plan;
    if (!plan || !baseAsset) {
      return undefined;
    }
    const positions: Position[] = plan.map(p => p.position);

    return baseAsset.formatDisplayAmount(extractAmount(positions, baseAsset));
  }

  get quoteAssetAmount(): string | undefined {
    const quoteAsset = this._quoteAsset;
    const plan = this.plan;
    if (!plan || !quoteAsset) {
      return undefined;
    }
    const positions: Position[] = plan.map(p => p.position);

    return quoteAsset.formatDisplayAmount(extractAmount(positions, quoteAsset));
  }

  setAssets(base: AssetInfo, quote: AssetInfo, resetInputs = false) {
    this._baseAsset = base;
    this._quoteAsset = quote;
    if (resetInputs) {
      this.upperPriceInput = null;
      this.lowerPriceInput = null;
      this.baseInput = '';
      this.quoteInput = '';
      // A reference price is per-pair intent ("treat 1.0 as mid for this
      // peg"). Carrying it into UM/USDC would anchor that ladder to 1.0.
      this.userReferencePriceInput = '';
    }
  }

  setPositions = (n: number) => {
    const clamped = Math.max(1, Math.min(20, Math.floor(n)));
    if (this.customWeights && this.customWeights.length !== clamped) {
      // Drop hand-edited weights whose length no longer matches the new
      // rung count — safer to fall back to the shape formula than to
      // truncate / pad an intent the user set at a different N.
      this.customWeights = null;
    }
    this.positions = clamped;
  };

  setLiquidityShape = (shape: LiquidityDistributionShape) => {
    this.liquidityShape = shape;
    // Any non-CUSTOM shape drops per-rung overrides so the shape formula
    // fully takes over. Users pick FLAT / PYRAMID / VOLATILE to reset.
    if (shape !== LiquidityDistributionShape.CUSTOM) {
      this.customWeights = null;
    }
  };

  /**
   * Replace one rung's weight (drag-to-resize on the LP preview). Flips
   * the shape to CUSTOM as a side-effect: the user is now sculpting the
   * distribution by hand, and the shape formula shouldn't overwrite what
   * they drew on the next render.
   */
  setCustomWeight = (index: number, weight: number) => {
    const n = this.positions;
    if (index < 0 || index >= n) return;
    const clamped = Math.max(0, weight);
    // Seed from the current shape so the first drag doesn't wipe every
    // other rung — the user drags one bar, the rest stay where they were.
    const seed =
      this.customWeights && this.customWeights.length === n
        ? [...this.customWeights]
        : deriveWeightsFromShape(n, this.liquidityShape);
    seed[index] = clamped;
    this.customWeights = seed;
    this.liquidityShape = LiquidityDistributionShape.CUSTOM;
  };

  clearCustomWeights = () => {
    this.customWeights = null;
  };
}

// Local mirror of the shape → weights fallback used when the user first
// drags a bar and there's no prior customWeights snapshot. Kept in-store
// (rather than imported from the math module) so a future decoupling of
// shape formulas from the preview doesn't require a store change.
const deriveWeightsFromShape = (
  n: number,
  shape: LiquidityDistributionShape,
): number[] => {
  if (n <= 0) return [];
  if (n === 1) return [1];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    switch (shape) {
      case LiquidityDistributionShape.PYRAMID:
        return 0.1 + 0.9 * (1 - Math.abs(t - 0.5) * 2);
      case LiquidityDistributionShape.INVERTED_PYRAMID:
        return Math.abs(t - 0.5) * 2;
      case LiquidityDistributionShape.FLAT:
      default:
        return 1;
    }
  });
};
