import type { AssetInfo } from './assets';
import type { Point } from './series';

/** Latest block the indexer has, so every chart can extend its last step to it. */
export interface LatestBlock {
  height: number;
  /** Unix ms. */
  timestamp: number;
}

export interface AssetSummary extends AssetInfo {
  /** Height of the latest change event. */
  height: number;
  /** Currently shielded, in display units. */
  currentValue: number;
  /** Lifetime inflow, in display units. */
  totalValue: number;
  /** Base-unit strings, exact. */
  currentValueRaw: string;
  totalValueRaw: string;
  uniqueDepositors: number;
}

export interface AssetsResponse {
  assets: AssetSummary[];
  latest: LatestBlock;
}

export interface SeriesResponse {
  asset: AssetInfo;
  /** Sparse change events of `current_value`, display units, ascending. */
  current: Point[];
  /** Same for `total_value` (lifetime inflow). */
  total: Point[];
  latest: LatestBlock;
}

export interface SupplyResponse {
  /** Downsampled UM total supply, display units. */
  points: Point[];
  latest: LatestBlock;
}

export interface CompareResponse {
  series: { asset: AssetInfo; current: Point[] }[];
  latest: LatestBlock;
}

export interface ErrorResponse {
  error: 'indexer_unreachable' | 'not_found' | 'bad_request';
  message: string;
}

export const isErrorResponse = (x: unknown): x is ErrorResponse =>
  typeof x === 'object' && x !== null && 'error' in x;
