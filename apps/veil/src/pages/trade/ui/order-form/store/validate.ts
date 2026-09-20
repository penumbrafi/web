import { Position } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import type { OffMidWarningKind } from './LPFormStore';

/**
 * A single thing standing between the user and a successful transaction.
 *
 * `blocking` issues disable submit; `warning` issues are shown but let the
 * user through, because they describe a deliberate-but-unusual choice (a
 * one-sided position, say) rather than a transaction the chain will refuse.
 */
export interface FormIssue {
  severity: 'blocking' | 'warning';
  message: string;
}

/** How much of one asset a prospective transaction will actually spend. */
export interface Requirement {
  asset: AssetInfo;
  /** In display units. */
  amount: number;
}

/**
 * Sum the reserves an LP plan commits, per asset.
 *
 * Reading this off the *built positions* rather than the form inputs is the
 * point: the inputs are what the user typed, the positions are what will be
 * spent after rounding, per-rung weighting and any rungs the planner dropped.
 * Validating the former would let a mismatch through.
 */
export const positionRequirements = (
  positions: Position[],
  base: AssetInfo,
  quote: AssetInfo,
): Requirement[] => {
  const totals = new Map<AssetInfo, number>();
  const add = (asset: AssetInfo, amount: number) => {
    totals.set(asset, (totals.get(asset) ?? 0) + amount);
  };

  for (const position of positions) {
    const asset1 = position.phi?.pair?.asset1;
    const asset2 = position.phi?.pair?.asset2;
    for (const asset of [base, quote]) {
      if (asset1?.equals(asset.id)) {
        add(asset, pnum(position.reserves?.r1, asset.exponent).toNumber());
      }
      if (asset2?.equals(asset.id)) {
        add(asset, pnum(position.reserves?.r2, asset.exponent).toNumber());
      }
    }
  }

  return [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([asset, amount]) => ({ asset, amount }));
};

/**
 * Everything the validator needs to know about the transaction being built.
 * Deliberately plain data so it can be unit-tested without a store.
 */
export interface ValidationInput {
  /** What the transaction will spend. Empty means "nothing entered yet". */
  requirements: Requirement[];
  /** The asset gas will be paid in, if known. */
  feeAsset?: AssetInfo;
  /** Estimated gas, in display units of `feeAsset`. Undefined while estimating. */
  gasFee?: number;
  /** True once a plan exists at all — i.e. the form is structurally complete. */
  hasPlan: boolean;
  /** For LP forms: the live mid the range is anchored to. */
  marketPrice?: number;
  /** True for the two forms that need a mid price to lay out positions. */
  requiresMarketPrice?: boolean;
  /** For LP forms: how many positions the plan actually produced. */
  positionCount?: number;
  /** True when the LP plan funds only one side of the book. */
  isOneSided?: boolean;
  /**
   * For LP: what the one-sided position is quoting. Used to render a
   * direction-explicit warning ("You are providing 78 USDC.inj as bids
   * to buy USDC ...") instead of the vague old "quoting one side of
   * the book" copy. Present only when isOneSided is true.
   */
  oneSidedDetails?: {
    fundedSide: 'base' | 'quote';
    fundedAsset: AssetInfo;
    receivedAsset: AssetInfo;
    fundedAmount: number;
  };
  /**
   * For LP: the side that was funded but cannot be quoted in the
   * chosen range, along with the symbols needed to explain it.
   * Now reserved for the TWO-sided planner's silent-drop case only;
   * one-sided-off-mid becomes `offMidWarning`.
   */
  wrongSide?: { funded: 'base' | 'quote'; baseSymbol: string; quoteSymbol: string };
  /**
   * For LP: warning shape when a one-sided position sits on the
   * "unfavourable" side of mid — bidding above market, or offering base
   * below market. Chain accepts it, arbitrageurs likely eat it; render
   * as a loud warning so users who mean it can proceed.
   */
  offMidWarning?: {
    kind: OffMidWarningKind;
    fundedSide: 'base' | 'quote';
    fundedAsset: AssetInfo;
    counterAsset: AssetInfo;
    midPrice: number;
  };
  /**
   * For LP / RangeLP: the price bounds the user chose. Passed through so the
   * validator can reject non-finite, non-positive, or inverted ranges before
   * they reach the LP math (where they become NaN prices, empty plans, or
   * "invalid uint32" crashes downstream).
   */
  lowerPrice?: number | null;
  upperPrice?: number | null;
}

const formatAmount = (asset: AssetInfo, amount: number): string =>
  asset.formatDisplayAmount(amount);

/**
 * Everything we can tell the user *before* they sign, so that a rejection
 * arrives as a sentence in the form rather than as a failed transaction and a
 * raw protobuf string in a toast.
 */
export const validateOrder = (input: ValidationInput): FormIssue[] => {
  const issues: FormIssue[] = [];

  if (input.requiresMarketPrice && input.marketPrice === undefined) {
    issues.push({
      severity: 'blocking',
      message:
        'No live market price for this pair yet, so the price range has nothing to anchor to. Pick a pair with an active route book, or use the Limit tab to name your own price.',
    });
    return issues;
  }

  // Range sanity — reject non-finite, non-positive, or inverted bounds
  // before the LP math sees them. Without this: lower==upper yields 0/0
  // NaN prices, negatives produce garbage `hi`/`lo` splits, and NaN prices
  // reach `priceToPQ` where destructuring `basePrice.toFraction()` on a
  // non-iterable used to throw the cryptic "n.default is not iterable".
  // Both `lowerPrice` and `upperPrice` are pass-through nullable — the
  // form's own "range not set" gates apply first, so we only judge them
  // once both are numeric.
  if (input.lowerPrice != null && input.upperPrice != null) {
    if (!Number.isFinite(input.lowerPrice) || !Number.isFinite(input.upperPrice)) {
      issues.push({
        severity: 'blocking',
        message: 'Price range must be finite numbers. Adjust the lower and upper bounds.',
      });
      return issues;
    }
    if (input.lowerPrice <= 0 || input.upperPrice <= 0) {
      issues.push({
        severity: 'blocking',
        message: 'Prices must be positive. Set a lower and upper bound above zero.',
      });
      return issues;
    }
    if (input.lowerPrice >= input.upperPrice) {
      issues.push({
        severity: 'blocking',
        message: 'Upper price must be greater than lower price.',
      });
      return issues;
    }
  }

  // Checked before `positionCount === 0`, which it would otherwise be
  // reported as. Funding the side that cannot be quoted in the chosen range
  // produces a ladder of all-zero rungs, so the plan comes back empty and the
  // user — who has plainly entered an amount — would be told it is "too
  // small". Newly reachable now that one-sided ranges are possible at all.
  if (input.wrongSide) {
    const { funded, baseSymbol, quoteSymbol } = input.wrongSide;
    issues.push({
      severity: 'blocking',
      message:
        funded === 'quote'
          ? `Your range is entirely above the mid price, so only ${baseSymbol} can be quoted there. Enter a ${baseSymbol} amount, or move the range below mid to quote ${quoteSymbol}.`
          : `Your range is entirely below the mid price, so only ${quoteSymbol} can be quoted there. Enter a ${quoteSymbol} amount, or move the range above mid to quote ${baseSymbol}.`,
    });
    return issues;
  }

  // Checked before the empty-requirements case, which it would otherwise be
  // shadowed by: the LP planners drop rungs whose reserves round to zero base
  // units (the chain rejects the whole transaction over a single empty
  // position), so when *every* rung is dropped the plan is an empty array and
  // there are no requirements to report. Message is deliberately concrete
  // about the most common causes — "amounts are too small" alone reads as
  // an accusation for someone who plainly typed a real amount, when the
  // real culprit is usually a stale/missing mid or a range on the wrong
  // side of it.
  if (input.positionCount === 0) {
    const hint = input.marketPrice === undefined
      ? 'Likely cause: no live market price for this pair yet, so the range has no anchor. Try the Limit tab, or wait for the book to populate.'
      : "Range and mid don't produce any rungs on the funded side — check your bounds or reference price. Alternatively the number of positions is too high for these amounts; try reducing positions.";
    issues.push({
      severity: 'blocking',
      message: `Could not build any positions from these inputs. ${hint}`,
    });
    return issues;
  }

  if (!input.hasPlan || input.requirements.length === 0) {
    issues.push({ severity: 'blocking', message: 'Enter an amount to continue.' });
    return issues;
  }

  for (const { asset, amount } of input.requirements) {
    // An unknown balance means the view service has not reported one yet
    // (still syncing, or no notes of this asset). Don't block on it — the
    // planner dry-run is the authority — but do catch what we can see.
    if (asset.balance === undefined) {
      continue;
    }

    if (amount > asset.balance) {
      issues.push({
        severity: 'blocking',
        message: `Not enough ${asset.symbol}. This needs ${formatAmount(asset, amount)} but you hold ${formatAmount(asset, asset.balance)}.`,
      });
      continue;
    }

    // Gas comes out of the same shielded pool as the order. Spending the
    // entire balance of the fee asset is the single most common way a
    // "MAX" order fails: the planner runs out of notes paying for itself.
    const isFeeAsset = input.feeAsset && asset.id.equals(input.feeAsset.id);
    if (isFeeAsset && input.gasFee !== undefined && amount + input.gasFee > asset.balance) {
      const headroom = Math.max(0, asset.balance - input.gasFee);
      issues.push({
        severity: 'blocking',
        message: `This leaves nothing to pay the transaction fee (about ${formatAmount(asset, input.gasFee)}). Use at most ${formatAmount(asset, headroom)}.`,
      });
    }
  }

  // Off-mid one-sided: user is bidding above market or offering base
  // below market. Chain accepts it; arbitrageurs likely take it as free
  // money. Loud warning so intent is confirmed but the submit stays open.
  if (input.offMidWarning) {
    const w = input.offMidWarning;
    const midStr = w.midPrice.toPrecision(6);
    if (w.kind === 'partial-straddle') {
      // One-sided funding, range crosses mid. The planner clamps to the
      // funded side's half; the rest of the range is dropped, not quoted.
      const side = w.fundedSide === 'quote' ? 'bid' : 'ask';
      issues.push({
        severity: 'warning',
        message: `Range partially crosses mid (~${midStr}) — only the ${side} portion will be quoted; the other portion is dropped.`,
      });
    } else if (w.kind === 'bids-above-mid') {
      issues.push({
        severity: 'warning',
        message: `Off-mid position: you are offering to buy ${w.counterAsset.symbol} at prices ABOVE the current market (~${midStr} ${w.fundedAsset.symbol}/${w.counterAsset.symbol}). Arbitrageurs may fill and drain the position at first crossing. Proceed only if this is intentional (e.g. a specific price view).`,
      });
    } else {
      issues.push({
        severity: 'warning',
        message: `Off-mid position: you are offering to sell ${w.fundedAsset.symbol} at prices BELOW the current market (~${midStr} ${w.counterAsset.symbol}/${w.fundedAsset.symbol}). Arbitrageurs may fill and drain the position at first crossing. Proceed only if this is intentional (e.g. a specific price view).`,
      });
    }
  }

  // Standard one-sided (on the conventional side of mid): direction-
  // explicit copy instead of the old vague "quoting one side of the
  // book". Names the fill mechanics so a user can predict what happens.
  if (input.isOneSided && !input.offMidWarning) {
    const d = input.oneSidedDetails;
    if (d) {
      const fundedAmount = d.fundedAsset.formatDisplayAmount(d.fundedAmount);
      const isBids = d.fundedSide === 'quote';
      issues.push({
        severity: 'warning',
        message: isBids
          ? `Providing ${fundedAmount} ${d.fundedAsset.symbol} as bids to buy ${d.receivedAsset.symbol}. Fills earn ${d.receivedAsset.symbol} when the market trades DOWN into your range.`
          : `Providing ${fundedAmount} ${d.fundedAsset.symbol} as asks to sell for ${d.receivedAsset.symbol}. Fills earn ${d.receivedAsset.symbol} when the market trades UP into your range.`,
      });
    } else {
      // Fallback for callers that didn't pass details.
      issues.push({
        severity: 'warning',
        message:
          'One-sided position: only one side of the book will be quoted; fills happen when the market trades into your range.',
      });
    }
  }

  return issues;
};

/** The first blocking issue, if any — what the submit button is waiting on. */
export const blockingIssue = (issues: FormIssue[]): FormIssue | undefined =>
  issues.find(i => i.severity === 'blocking');
