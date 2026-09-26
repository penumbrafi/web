import { NextRequest, NextResponse } from 'next/server';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';
import { pindexerDb } from '@/shared/database/client';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';
import { getPriceHistory } from '../portfolio-history';
import { isHistoryRange } from '../portfolio-history/types';
import { ShieldedAsset, ShieldedHistoryResponse } from './types';

const EMPTY: ShieldedHistoryResponse = { points: [], assets: [], indexedHeight: 0 };
const ROWS_TTL_MS = 60_000;

interface Row {
  height: number;
  current: bigint;
  total: bigint;
  depositors: number;
}
let rowsCache: { at: number; byAsset: Map<string, Row[]> } | undefined;

/**
 * Every change to every asset's shielded balance, from pindexer's
 * insights_shielded_pool (tens of thousands of rows, so read whole and
 * cached for a minute). `current_value` is what sits in the shielded pool,
 * `total_value` everything that ever came in.
 */
const shieldedRows = async (): Promise<Map<string, Row[]>> => {
  if (rowsCache && Date.now() - rowsCache.at < ROWS_TTL_MS) {
    return rowsCache.byAsset;
  }
  const rows = await pindexerDb
    .selectFrom('insights_shielded_pool')
    .select(['asset_id', 'height', 'current_value', 'total_value', 'unique_depositors'])
    .orderBy('height', 'asc')
    .execute();
  const byAsset = new Map<string, Row[]>();
  for (const r of rows) {
    const id = uint8ArrayToBase64(r.asset_id);
    let list = byAsset.get(id);
    if (!list) {
      list = [];
      byAsset.set(id, list);
    }
    list.push({
      height: Number(r.height),
      current: BigInt(r.current_value),
      total: BigInt(r.total_value),
      depositors: r.unique_depositors,
    });
  }
  rowsCache = { at: Date.now(), byAsset };
  return byAsset;
};

/** Last row at or below `height` (rows ascending), or undefined. */
const rowAt = (rows: Row[], height: number): Row | undefined => {
  let lo = 0;
  let hi = rows.length - 1;
  let found: Row | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = rows[mid];
    if (r && r.height <= height) {
      found = r;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

const toDisplay = (amount: bigint, exponent: number) => Number(amount) / 10 ** exponent;

async function handleGet(req: NextRequest): Promise<NextResponse<ShieldedHistoryResponse>> {
  const range = new URL(req.url).searchParams.get('range');
  if (!isHistoryRange(range)) {
    return NextResponse.json(EMPTY, { status: 400 });
  }
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!chainId) {
    throw new Error('PENUMBRA_CHAIN_ID is not set');
  }
  const [registry, history, byAsset] = await Promise.all([
    withTimeout(getCachedRegistry(chainId), DEFAULT_TIMEOUT_MS, 'shielded-history registry'),
    getPriceHistory(range),
    shieldedRows(),
  ]);

  const metaOf = (id: string): Metadata | undefined =>
    registry.tryGetMetadata(new AssetId({ inner: Buffer.from(id, 'base64') }));

  // Shielded value at each sample point: every priced asset's balance then,
  // at its USD price then. Unpriced assets (memecoins with no market) count
  // in the table below but not in the USD line.
  const points = history.points.map((p, i) => {
    let usd = 0;
    for (const [id, rows] of byAsset) {
      const price = history.usd[id]?.[i];
      const meta = metaOf(id);
      const row = rowAt(rows, p.height);
      if (price === undefined || !meta || !row) {
        continue;
      }
      usd += toDisplay(row.current, getDisplayDenomExponent(meta)) * price;
    }
    return { height: p.height, timeMs: p.timeMs, usd };
  });

  const lastIndex = history.points.length - 1;
  const firstPoint = history.points[0];
  let indexedHeight = 0;
  const assets: ShieldedAsset[] = [];
  for (const [id, rows] of byAsset) {
    const latest = rows[rows.length - 1];
    if (!latest) {
      continue;
    }
    indexedHeight = Math.max(indexedHeight, latest.height);
    const meta = metaOf(id);
    const exponent = meta ? getDisplayDenomExponent(meta) : 0;
    const price = lastIndex >= 0 ? history.usd[id]?.[lastIndex] : undefined;
    const start = firstPoint ? rowAt(rows, firstPoint.height) : undefined;
    assets.push({
      assetId: id,
      symbol: meta?.symbol ?? '',
      base: meta?.base ?? '',
      inRegistry: !!meta,
      shielded: toDisplay(latest.current, exponent),
      shieldedAtRangeStart: start ? toDisplay(start.current, exponent) : 0,
      lifetimeInflow: toDisplay(latest.total, exponent),
      depositors: latest.depositors,
      usd: price === undefined ? undefined : toDisplay(latest.current, exponent) * price,
      lastChangeHeight: latest.height,
    });
  }
  assets.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.depositors - a.depositors);

  return NextResponse.json(
    { points, assets, indexedHeight },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY,
  logTag: 'shielded-history',
});
