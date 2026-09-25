export type Range = '30d' | '90d' | '1y' | 'all';

export const RANGE_OPTIONS: readonly { value: Range; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All' },
];

const DAY = 86_400_000;

const RANGE_MS: Record<Exclude<Range, 'all'>, number> = {
  '30d': 30 * DAY,
  '90d': 90 * DAY,
  '1y': 365 * DAY,
};

/** Start of the window, measured back from the latest indexed block. */
export const rangeStart = (range: Range, latestMs: number): number =>
  range === 'all' ? Number.NEGATIVE_INFINITY : latestMs - RANGE_MS[range];
