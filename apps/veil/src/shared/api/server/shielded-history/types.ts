export interface ShieldedAsset {
  /** Base64 asset id. */
  assetId: string;
  /** Empty for assets the registry doesn't know. */
  symbol: string;
  base: string;
  inRegistry: boolean;
  /** Now in the shielded pool, display units (base units if not in the registry). */
  shielded: number;
  /** Shielded at the start of the requested range, for the change column. */
  shieldedAtRangeStart: number;
  /** Everything that ever came in over IBC. */
  lifetimeInflow: number;
  depositors: number;
  /** USD value now; undefined when the asset has no price. */
  usd?: number;
  lastChangeHeight: number;
}

/** Public shielded-pool history: the same for every caller. */
export interface ShieldedHistoryResponse {
  /** Total shielded value in USD at each sample point (priced assets only). */
  points: { height: number; timeMs: number; usd: number }[];
  assets: ShieldedAsset[];
  /** Highest height pindexer has recorded a shielded-pool change at. */
  indexedHeight: number;
}

/**
 * One asset's shielded-pool change log: [block time ms, shielded, lifetime
 * inflow] after each change, ascending, display units. A step function: the
 * value holds until the next entry.
 */
export interface ShieldedSeries {
  assetId: string;
  points: [timeMs: number, current: number, total: number][];
}

/** Most assets one /api/shielded-history/series request (and one chart) takes. */
export const MAX_SERIES_ASSETS = 8;

export interface ShieldedSeriesResponse {
  series: ShieldedSeries[];
  /** Time of the latest indexed block, where every step line ends. */
  tipMs: number;
}

/** One asset's shielded-pool state at a moment, display units. */
export interface PoolSnapshot {
  /** In the shielded pool. */
  current: number;
  /** Everything that ever came in over IBC. */
  total: number;
  depositors: number;
}

export interface OverviewAsset {
  assetId: string;
  /** Empty for assets the registry doesn't know. */
  symbol: string;
  base: string;
  /** USD per display unit now; undefined without a DEX price route. */
  priceUsd?: number;
  now: PoolSnapshot;
  d1: PoolSnapshot;
  d7: PoolSnapshot;
  d30: PoolSnapshot;
}

/** The shielded pool at a glance: USD value over time and per-asset flows. */
export interface ShieldedOverviewResponse {
  /** Daily sample times (UTC midnight), ascending; the last is the latest block. */
  times: number[];
  /** USD value per sample of the largest assets now, largest first. */
  stack: { assetId: string; usd: number[] }[];
  /** Every other priced asset, summed. */
  otherUsd: number[];
  /** Every asset ever shielded, largest USD value first, unpriced last. */
  assets: OverviewAsset[];
}
