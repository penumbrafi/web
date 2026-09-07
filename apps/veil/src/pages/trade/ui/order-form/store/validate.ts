import { Position } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';

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

  if (!input.hasPlan || input.requirements.length === 0) {
    issues.push({ severity: 'blocking', message: 'Enter an amount to continue.' });
    return issues;
  }

  // The LP planners drop rungs whose reserves round to zero base units,
  // because the chain rejects the whole transaction over a single empty
  // position. If that leaves nothing, the amount is simply too small.
  if (input.positionCount === 0) {
    issues.push({
      severity: 'blocking',
      message:
        'These amounts are too small to open a position — after splitting across the range, every position would round to zero. Increase the amount or reduce the number of positions.',
    });
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

  if (issues.length === 0 && input.isOneSided) {
    issues.push({
      severity: 'warning',
      message:
        'One-sided position: you are quoting only one side of the book, so it earns fees only once the market trades into your range.',
    });
  }

  return issues;
};

/** The first blocking issue, if any — what the submit button is waiting on. */
export const blockingIssue = (issues: FormIssue[]): FormIssue | undefined =>
  issues.find(i => i.severity === 'blocking');
