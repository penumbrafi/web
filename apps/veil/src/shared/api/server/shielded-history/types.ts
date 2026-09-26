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
