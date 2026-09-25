import type { ColumnType } from 'kysely';

/** `int8` columns come back as BigInt (see the type parser in client.ts). */
export type Int8 = ColumnType<bigint, bigint | number | string, bigint | number | string>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

/**
 * Sparse change log of the shielded pool, one row per (asset, height) at
 * which the value changed. `current_value` is the amount shielded right now
 * in base units, `total_value` the lifetime inflow; both are text because
 * 18-decimal assets exceed int8.
 */
export interface InsightsShieldedPool {
  asset_id: Buffer;
  height: Int8;
  total_value: string;
  current_value: string;
  unique_depositors: number;
}

export interface BlockDetails {
  height: Int8;
  root: Buffer;
  timestamp: Timestamp;
}

/** One row per block: UM supply. 12.9M rows, never read without a downsample. */
export interface InsightsSupply {
  height: Int8;
  total: Int8;
  staked: Int8;
  price: number | null;
  price_numeraire_asset_id: Buffer | null;
  market_cap: number | null;
}

export interface DB {
  insights_shielded_pool: InsightsShieldedPool;
  block_details: BlockDetails;
  insights_supply: InsightsSupply;
}
