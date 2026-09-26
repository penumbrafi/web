import { scaleLinear } from 'd3-scale';
import { openToast } from '@penumbra-zone/ui/Toast';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import {
  LadderRung,
  LiquidityDistributionShape,
  LiquidityRung,
  PositionedLiquidity,
  rungsToPositions,
  SimpleLiquidityPlan,
  simpleLiquidityLadder,
  simpleLiquidityRungs,
} from '@/shared/math/position';
import { parseNumber } from '@/shared/utils/num';
import { makeAutoObservable } from 'mobx';
import { round } from '@penumbra-zone/types/round';

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
  // Which shape the current `customWeights` were seeded from, so the shape
  // row can keep that button selected and relabel it "Custom" rather than
  // showing no selection at all once the user drags a bar. Null whenever
  // `liquidityShape` is not CUSTOM.
  customBaseShape: LiquidityDistributionShape | null = null;
  // Whether `customWeights` were drawn on a one-sided or a two-sided ladder.
  // Their indices only mean the same rungs on the same kind of ladder, so a
  // switch between the two stops applying them (see `activeCustomWeights`).
  customSided: 'one' | 'two' | null = null;

  /**
   * Fraction of each side's wallet balance the `suggestPosition` helper
   * commits to the seed ladder. Persisted per-session (mobx-only), so a
   * user who bumps it to 25% keeps that preference until reload. Range
   * clamped to [0.05, 0.5] — sub-5% produces reserves so small the
   * rung-count filter drops most positions, and above 50% starts to
   * conflict with keeping cash for further swaps.
   */
  suggestBalancePct = 0.10;

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
    if (override !== null) {return override;}
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
    if (!this.isOneSided) {return undefined;}

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

  /**
   * The ladder as cheap plain data: one `{price, reserves}` per position
   * that will actually be opened (zero-reserve rungs already dropped).
   *
   * This is what the preview overlay, validator and confirm modal read.
   * It is a mobx computed, so it only recomputes when an input or the mid
   * moves — and even then it is a handful of float ops, no protobuf
   * construction and no `crypto.getRandomValues`. See `plan` for the
   * expensive half.
   */
  /** Custom weights, when they were drawn on this kind of ladder (one- or two-sided). */
  get activeCustomWeights(): number[] | null {
    if (!this.customWeights) {
      return null;
    }
    return this.customSided === (this.isOneSided ? 'one' : 'two') ? this.customWeights : null;
  }

  /**
   * Inputs for the ladder math: the one place rungs, ladder and plan all
   * read, so the chart preview can't draw a different ladder than the one
   * that gets opened.
   */
  get planInput(): SimpleLiquidityPlan | undefined {
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

    const custom = this.activeCustomWeights;
    let shape = this.liquidityShape;
    if (shape === LiquidityDistributionShape.CUSTOM && !custom) {
      shape = this.customBaseShape ?? LiquidityDistributionShape.FLAT;
    }
    return {
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
      distributionShape: shape,
      customWeights: custom ?? undefined,
    };
  }

  get rungs(): LiquidityRung[] | undefined {
    const input = this.planInput;
    return input ? simpleLiquidityRungs(input) : undefined;
  }

  /**
   * Every rung of the ladder (none dropped), with its index, side, reserves
   * and share of its side: what the chart preview draws and drags.
   */
  get ladder(): LadderRung[] | undefined {
    const input = this.planInput;
    return input ? simpleLiquidityLadder(input) : undefined;
  }

  /**
   * The on-chain positions for `rungs` — trading function + a fresh 32-byte
   * nonce each. Expensive and non-deterministic, so ONLY the gas dry-run and
   * the real submit should read it; everything else wants `rungs`.
   */
  get plan(): PositionedLiquidity[] | undefined {
    const rungs = this.rungs;
    if (!rungs || !this._baseAsset || !this._quoteAsset) {
      return undefined;
    }
    return rungsToPositions(rungs, this._baseAsset, this._quoteAsset, this.liquidityShape);
  }

  get baseAssetAmount(): string | undefined {
    const baseAsset = this._baseAsset;
    const rungs = this.rungs;
    if (!rungs || !baseAsset) {
      return undefined;
    }
    return baseAsset.formatDisplayAmount(sumBy(rungs, r => r.baseAmount));
  }

  get quoteAssetAmount(): string | undefined {
    const quoteAsset = this._quoteAsset;
    const rungs = this.rungs;
    if (!rungs || !quoteAsset) {
      return undefined;
    }
    return quoteAsset.formatDisplayAmount(sumBy(rungs, r => r.quoteAmount));
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
    if (this.customWeights && clamped !== this.positions) {
      // Hand-drawn weights belong to a ladder with a different rung count.
      // Leave custom mode properly (back to the shape they were drawn from)
      // rather than only dropping the weights: that left the button saying
      // "Custom", hid Reset, and quietly planned Linear.
      this.clearCustomWeights();
    }
    this.positions = clamped;
  };

  setLiquidityShape = (shape: LiquidityDistributionShape) => {
    this.liquidityShape = shape;
    // Any non-CUSTOM shape drops per-rung overrides so the shape formula
    // fully takes over. Users pick FLAT / PYRAMID / VOLATILE to reset.
    if (shape !== LiquidityDistributionShape.CUSTOM) {
      this.customWeights = null;
      this.customBaseShape = null;
      this.customSided = null;
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
    if (index < 0 || index >= n) {return;}
    const clamped = Math.max(0, weight);
    // Seed from the current shape so the first drag doesn't wipe every
    // other rung — the user drags one bar, the rest stay where they were.
    // Seed from the ladder on screen (its per-side shares), so the first
    // drag changes only the dragged rung and nothing else snaps.
    const active = this.activeCustomWeights;
    const seed =
      active && active.length === n
        ? [...active]
        : (this.ladder?.map(r => r.share) ?? Array.from({ length: n }, () => 1));
    seed[index] = clamped;
    // Remember the shape we sculpted FROM the first time only, so repeated
    // drags don't lose the original base.
    if (this.liquidityShape !== LiquidityDistributionShape.CUSTOM) {
      this.customBaseShape = this.liquidityShape;
    }
    this.customWeights = seed;
    this.customSided = this.isOneSided ? 'one' : 'two';
    this.liquidityShape = LiquidityDistributionShape.CUSTOM;
  };

  clearCustomWeights = () => {
    this.customWeights = null;
    this.customSided = null;
    // Drop back to whatever shape the overrides were sculpted from.
    if (this.liquidityShape === LiquidityDistributionShape.CUSTOM) {
      this.liquidityShape = this.customBaseShape ?? LiquidityDistributionShape.FLAT;
    }
    this.customBaseShape = null;
  };

  /**
   * One-click "sane-default LP" for a fresh pair.
   *
   * Fills every field in one atomic write so the user's next click is
   * "Provide liquidity" — not "figure out what mid to pick, then a range,
   * then reserves, then a fee tier." Every field remains editable
   * afterwards (this seeds, it doesn't lock).
   *
   * Sizing math (see the redshiftzero decision doc):
   *   baseReserves  = 0.10 × baseBalance
   *   quoteReserves = 0.10 × quoteBalance
   *
   * "10% of total, in the user's current holding ratio" collapses to
   * "10% of each side" — no USD conversion needed for the reserve math.
   * USD prices only enter as the mid anchor.
   *
   * One-sided case (holding UM but no INJ, or vice versa): produce a
   * pure sell/buy ladder. The chain accepts it; the two-sided planner's
   * `oneSidedPositions` path already handles the clamp. UI hints at it
   * via `offMidWarning === 'partial-straddle'` and the "one-sided
   * ladder" chip.
   *
   * Empty-empty (both balances zero / unknown): no-op, since seeding
   * zero reserves produces no positions.
   */
  setSuggestBalancePct = (pct: number) => {
    if (!Number.isFinite(pct)) {return;}
    this.suggestBalancePct = Math.max(0.05, Math.min(0.5, pct));
  };

  /**
   * @param mid  Anchor price for the ladder.
   * @param opts.committedBase   Base display-units already tied up in this
   *                             pair's open LP positions. Used so the "pct
   *                             of balance" target treats total portfolio
   *                             exposure (wallet + committed) as the base,
   *                             and the suggestion adds only the delta to
   *                             hit it. `0` (default) is the fresh-user
   *                             case: everything liquid becomes portfolio.
   * @param opts.committedQuote  Same, for quote.
   */
  suggestPosition = (
    mid: number,
    opts: { committedBase?: number; committedQuote?: number } = {},
  ) => {
    if (!(mid > 0) || !Number.isFinite(mid)) {return;}
    const baseBal = this._baseAsset?.balance ?? 0;
    const quoteBal = this._quoteAsset?.balance ?? 0;
    if (baseBal <= 0 && quoteBal <= 0) {return;}

    const baseExp = this._baseAsset?.exponent ?? 6;
    const quoteExp = this._quoteAsset?.exponent ?? 6;

    const pct = this.suggestBalancePct;
    const committedBase = Math.max(0, opts.committedBase ?? 0);
    const committedQuote = Math.max(0, opts.committedQuote ?? 0);

    // Committed-reserves-aware sizing: target = pct × (wallet + already
    // committed). Suggestion = max(0, target − committed), clamped to
    // liquid wallet. Without this, repeatedly clicking Suggest ratchets
    // the position DOWN (each click sizes 10% of a smaller wallet).
    // With it, the first click targets 10% of portfolio, the second is
    // a no-op if we're already at target, and the user has to raise the
    // slider or top up to add more — which is the right mental model.
    const targetBase = pct * (baseBal + committedBase);
    const targetQuote = pct * (quoteBal + committedQuote);
    const baseReserves = Math.max(0, Math.min(baseBal, targetBase - committedBase));
    const quoteReserves = Math.max(0, Math.min(quoteBal, targetQuote - committedQuote));

    // Bypass the setters' auto-fill / guard logic and reset
    // `lastTouchedInput` — the whole shape is coming from the store,
    // not from the user typing one side, so `updateOppositeInput`
    // would fight us.
    this.lastTouchedInput = null;
    this.baseInput =
      baseReserves > 0
        ? round({ value: String(baseReserves), decimals: baseExp, exponentialNotation: false })
        : '';
    this.quoteInput =
      quoteReserves > 0
        ? round({ value: String(quoteReserves), decimals: quoteExp, exponentialNotation: false })
        : '';

    // Range choice depends on funding: balanced → ±5% straddle; base-
    // only → sell ladder ABOVE mid [mid, mid×1.05]; quote-only → buy
    // ladder BELOW mid [mid×0.95, mid]. Straddling mid in a one-sided
    // case would trip `partial-straddle` on the very first suggestion
    // and clamp half the ladder away — the user asked for a sane
    // starting point, not a warning.
    const baseOnly = baseReserves > 0 && quoteReserves <= 0;
    const quoteOnly = quoteReserves > 0 && baseReserves <= 0;
    let [loMul, hiMul] = [0.95, 1.05];
    if (baseOnly) {
      [loMul, hiMul] = [1, 1.05];
    } else if (quoteOnly) {
      [loMul, hiMul] = [0.95, 1];
    }
    this.lowerPriceInput = Number(
      round({ value: String(mid * loMul), decimals: quoteExp, exponentialNotation: false }),
    );
    this.upperPriceInput = Number(
      round({ value: String(mid * hiMul), decimals: quoteExp, exponentialNotation: false }),
    );

    // Anchor the ladder to the same mid we sized against. Without this
    // an empty-pair Suggest would fall through effectiveMarketPrice to
    // (lower+upper)/2, which equals mid anyway on a symmetric ±5% band
    // — but any subsequent tweak to lower/upper would silently move the
    // anchor. Pinning userReferencePriceInput keeps the two decoupled.
    this.userReferencePriceInput = round({
      value: String(mid),
      decimals: quoteExp,
      exponentialNotation: false,
    });

    this.feeTierOption = LPFeeTierOptions.Volatile;
    this.feeTierPercentInput = LP_FEE_TIER_PERCENTS[LPFeeTierOptions.Volatile];
    this.liquidityShape = LiquidityDistributionShape.FLAT;
    this.customWeights = null;
    this.customBaseShape = null;
    this.customSided = null;
    this.positions = DEFAULT_POSITION_COUNT;
  };
}

const sumBy = (rungs: LiquidityRung[], pick: (r: LiquidityRung) => number): number => {
  let out = 0.0;
  for (const r of rungs) {
    out += pick(r);
  }
  return out;
};

