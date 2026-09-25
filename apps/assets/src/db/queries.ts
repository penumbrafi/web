import { sql } from 'kysely';
import { getPindexerDb } from './client';
import { lookupAsset, stakingAsset } from '@/lib/assets';
import { scaleBaseUnits } from '@/lib/amount';
import { normalizePoints, thin, type Point } from '@/lib/series';
import { CACHE_TTL_MS, memoTtl } from '@/lib/memo';
import type {
  AssetsResponse,
  CompareResponse,
  LatestBlock,
  SeriesResponse,
  SupplyResponse,
} from '@/lib/api';

/**
 * Supply sample stride in blocks. At ~5.6 s/block, 8640 blocks is roughly
 * twelve hours, which keeps a multi-year series at a few thousand rows
 * instead of the 12.9M in `insights_supply`.
 */
export const SUPPLY_STRIDE = 8640;
/** Cap on supply points returned; `thin` keeps every k-th plus the last. */
const SUPPLY_MAX_POINTS = 1500;
/** Series compared side by side. Eight is the categorical palette's limit. */
export const COMPARE_COUNT = 8;

const idToBuffer = (id: string): Buffer => Buffer.from(id, 'base64');

const latestBlock = async (): Promise<LatestBlock> => {
  const row = await getPindexerDb()
    .selectFrom('block_details')
    .select(['height', 'timestamp'])
    .orderBy('height', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  return { height: Number(row.height), timestamp: row.timestamp.getTime() };
};

const fetchAssets = async (): Promise<AssetsResponse> => {
  const db = getPindexerDb();
  const [rows, latest] = await Promise.all([
    // Latest change event per asset. `insights_shielded_pool_latest` is the
    // same thing as a view; spelling it out keeps the schema surface small.
    db
      .selectFrom('insights_shielded_pool')
      .distinctOn('asset_id')
      .select(['asset_id', 'height', 'current_value', 'total_value', 'unique_depositors'])
      .orderBy('asset_id')
      .orderBy('height', 'desc')
      .execute(),
    latestBlock(),
  ]);
  const assets = rows.map(r => {
    const info = lookupAsset(r.asset_id.toString('base64'));
    return {
      ...info,
      height: Number(r.height),
      currentValue: scaleBaseUnits(r.current_value, info.exponent),
      totalValue: scaleBaseUnits(r.total_value, info.exponent),
      currentValueRaw: r.current_value,
      totalValueRaw: r.total_value,
      uniqueDepositors: r.unique_depositors,
    };
  });
  // Sort by exact base-unit value within an exponent class is meaningless
  // across assets; display-unit float is the right ordering key here.
  assets.sort((a, b) => b.currentValue - a.currentValue);
  return { assets, latest };
};

interface SeriesRow {
  asset_id: Buffer;
  timestamp: Date;
  current_value: string;
  total_value: string;
}

const seriesRows = (ids: readonly string[]): Promise<SeriesRow[]> =>
  getPindexerDb()
    .selectFrom('insights_shielded_pool as p')
    .innerJoin('block_details as b', 'b.height', 'p.height')
    .select(['p.asset_id', 'b.timestamp', 'p.current_value', 'p.total_value'])
    .where('p.asset_id', 'in', ids.map(idToBuffer))
    .orderBy('p.height')
    .execute();

const toSeries = (
  rows: readonly SeriesRow[],
  exponent: number,
  column: 'current_value' | 'total_value',
): Point[] =>
  normalizePoints(
    rows.map(r => ({ t: r.timestamp.getTime(), v: scaleBaseUnits(r[column], exponent) })),
  );

const fetchSeries = async (id: string): Promise<SeriesResponse | null> => {
  const asset = lookupAsset(id);
  const [rows, latest] = await Promise.all([seriesRows([id]), latestBlock()]);
  if (rows.length === 0) {
    return null;
  }
  return {
    asset,
    current: toSeries(rows, asset.exponent, 'current_value'),
    total: toSeries(rows, asset.exponent, 'total_value'),
    latest,
  };
};

const fetchCompare = async (): Promise<CompareResponse> => {
  const { assets, latest } = await getAssets('all');
  const top = assets.filter(a => a.currentValue > 0).slice(0, COMPARE_COUNT);
  const rows = top.length > 0 ? await seriesRows(top.map(a => a.id)) : [];
  const byId = new Map<string, SeriesRow[]>();
  for (const r of rows) {
    const key = r.asset_id.toString('base64');
    const list = byId.get(key) ?? [];
    list.push(r);
    byId.set(key, list);
  }
  return {
    series: top.map(asset => ({
      asset,
      current: toSeries(byId.get(asset.id) ?? [], asset.exponent, 'current_value'),
    })),
    latest,
  };
};

const fetchSupply = async (): Promise<SupplyResponse> => {
  const db = getPindexerDb();
  const um = stakingAsset();
  // min/max over an empty table are SQL NULL; Kysely types them as bigint.
  const bounds = (await db
    .selectFrom('insights_supply')
    .select(eb => [eb.fn.min('height').as('lo'), eb.fn.max('height').as('hi')])
    .executeTakeFirstOrThrow()) as { lo: bigint | null; hi: bigint | null };
  if (bounds.lo === null || bounds.hi === null) {
    return { points: [], latest: await latestBlock() };
  }
  const lo = Number(bounds.lo);
  const hi = Number(bounds.hi);
  // Sample every SUPPLY_STRIDE blocks via generate_series joined on the
  // primary key, which is an index lookup per sample. `height % 8640 = 0`
  // says the same thing but forces a sequential scan over all 12.9M rows.
  // The max height is added so the line always ends at the latest block.
  const { rows } = await sql<{ height: bigint; total: bigint; timestamp: Date }>`
    select s.height, s.total, b.timestamp
    from (
      select generate_series(${lo}::bigint, ${hi}::bigint, ${SUPPLY_STRIDE}::bigint) as height
      union select ${hi}::bigint
    ) g
    join insights_supply s on s.height = g.height
    join block_details b on b.height = s.height
    order by s.height
  `.execute(db);
  const points = thin(
    normalizePoints(
      rows.map(r => ({ t: r.timestamp.getTime(), v: scaleBaseUnits(r.total, um.exponent) })),
    ),
    SUPPLY_MAX_POINTS,
  );
  return { points, latest: await latestBlock() };
};

export const getAssets = memoTtl((_key: 'all') => fetchAssets(), CACHE_TTL_MS);
export const getSeries = memoTtl((id: string) => fetchSeries(id), CACHE_TTL_MS);
export const getCompare = memoTtl((_key: 'all') => fetchCompare(), CACHE_TTL_MS);
export const getSupply = memoTtl((_key: 'all') => fetchSupply(), CACHE_TTL_MS);
