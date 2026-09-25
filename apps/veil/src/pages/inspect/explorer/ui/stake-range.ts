/**
 * Time-range presets for the active-stake-history chart.
 *
 * Kept in a plain (non-`'use client'`) module so the server component
 * that renders the validators page can resolve the URL ?range= param
 * and compute the SQL window without touching the client picker. The
 * picker UI lives in stake-range-selector.tsx and imports from here.
 */
export const STAKE_RANGES = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '180d', label: '180D', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: '2y', label: '2Y', days: 730 },
] as const;

export type StakeRangeKey = (typeof STAKE_RANGES)[number]['key'];

export const DEFAULT_STAKE_RANGE: StakeRangeKey = '90d';

export const parseStakeRange = (raw: string | undefined): StakeRangeKey => {
  if (!raw) {
    return DEFAULT_STAKE_RANGE;
  }
  const match = STAKE_RANGES.find(r => r.key === raw);
  return match?.key ?? DEFAULT_STAKE_RANGE;
};

export const stakeRangeDays = (key: StakeRangeKey): number =>
  STAKE_RANGES.find(r => r.key === key)?.days ?? 90;

/**
 * Step sizing per window. Numbers tuned so each window ends up with
 * ~25 (coarse) or 90–180 (dense) points — fine enough that the chart
 * line reads as continuous, coarse enough that the per-validator-bucket
 * LATERAL count stays out of the multi-second regime.
 *
 * Lives here (not on the SQL module) because 'use server' requires every
 * export to be an async function and stakeStepFor is sync.
 */
export interface StakeStep {
  /** Cheap first paint. Always renders fast. */
  coarse: number;
  /** Final refinement streamed in over Suspense. */
  dense: number;
}

export const stakeStepFor = (days: number): StakeStep => {
  if (days <= 30) {
    return { coarse: 1, dense: 1 };
  }
  if (days <= 90) {
    return { coarse: 3, dense: 1 };
  }
  if (days <= 180) {
    return { coarse: 7, dense: 1 };
  }
  if (days <= 365) {
    return { coarse: 14, dense: 3 };
  }
  return { coarse: 30, dense: 7 }; // 2y
};
