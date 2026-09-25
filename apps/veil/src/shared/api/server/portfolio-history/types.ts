export const HISTORY_RANGES = ['1d', '7d', '30d', 'max'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export const isHistoryRange = (s: string | null): s is HistoryRange =>
  HISTORY_RANGES.includes(s as HistoryRange);

/**
 * Public price history for the portfolio chart. The same for every caller:
 * the request names only a range, so the server never learns which assets a
 * wallet holds or since when. The browser joins it with its own notes.
 */
export interface PortfolioHistoryResponse {
  /** Sample points, ascending. `timeMs` is the block's own timestamp. */
  points: { height: number; timeMs: number }[];
  /** Base64 asset id -> USD per display unit, one entry per point. */
  usd: Record<string, number[]>;
}
