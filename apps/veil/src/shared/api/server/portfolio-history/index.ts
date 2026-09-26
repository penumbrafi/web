import { NextRequest, NextResponse } from 'next/server';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';
import { pindexerDb } from '@/shared/database/client';
import { getCachedRegistry, STAKING_TOKEN_ASSET_ID } from '@/shared/api/fetch-registry';
import { referencePriceFor } from '@/shared/const/reference-price';
import { calculateDisplayPrice } from '@/shared/utils/price-conversion';
import { DurationWindow } from '@/shared/utils/duration';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';
import { buildUsdSeries, PricePoint, sampleHeights } from './series';
import { HistoryRange, isHistoryRange, PortfolioHistoryResponse } from './types';

const DAY_MS = 86_400_000;
const POINTS = 120;
// Mainnet's typical block time; only used to guess the start height, which
// is then corrected from real block timestamps.
const EST_BLOCK_MS = 5_470;
const CACHE_MS = 60_000;

const RANGES: Record<HistoryRange, { ms: number | null; window: DurationWindow }> = {
  '1d': { ms: DAY_MS, window: '15m' },
  '7d': { ms: 7 * DAY_MS, window: '1h' },
  '30d': { ms: 30 * DAY_MS, window: '4h' },
  max: { ms: null, window: '1d' },
};

const EMPTY: PortfolioHistoryResponse = { points: [], usd: {} };

const cache = new Map<HistoryRange, { at: number; body: PortfolioHistoryResponse }>();

const blocksAt = async (heights: number[]) =>
  heights.length === 0
    ? []
    : pindexerDb
        .selectFrom('block_details')
        .select(['height', 'timestamp'])
        .where('height', 'in', heights.map(String))
        .orderBy('height', 'asc')
        .execute();

/** Height whose block is close to `targetMs`, refined once against a real timestamp. */
const heightNear = async (tip: { height: number; timeMs: number }, targetMs: number) => {
  const guess = Math.max(1, Math.round(tip.height - (tip.timeMs - targetMs) / EST_BLOCK_MS));
  const [anchor] = await blocksAt([guess]);
  if (!anchor || guess >= tip.height) {
    return guess;
  }
  const blockMs = (tip.timeMs - new Date(anchor.timestamp).getTime()) / (tip.height - guess);
  if (!(blockMs > 0)) {
    return guess;
  }
  return Math.max(1, Math.round(tip.height - (tip.timeMs - targetMs) / blockMs));
};

const build = async (range: HistoryRange): Promise<PortfolioHistoryResponse> => {
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!chainId) {
    throw new Error('PENUMBRA_CHAIN_ID is not set');
  }
  const registry = await withTimeout(
    getCachedRegistry(chainId),
    DEFAULT_TIMEOUT_MS,
    'portfolio-history registry.get',
  );

  const tipRow = await pindexerDb
    .selectFrom('block_details')
    .select(['height', 'timestamp'])
    .orderBy('height', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!tipRow) {
    return EMPTY;
  }
  const tip = { height: Number(tipRow.height), timeMs: new Date(tipRow.timestamp).getTime() };

  const { ms, window } = RANGES[range];
  let fromHeight: number;
  if (ms === null) {
    const first = await pindexerDb
      .selectFrom('block_details')
      .select('height')
      .orderBy('height', 'asc')
      .limit(1)
      .executeTakeFirst();
    fromHeight = Number(first?.height ?? tip.height);
  } else {
    fromHeight = await heightNear(tip, tip.timeMs - ms);
  }

  // pindexer can have gaps; a missing height just drops that sample.
  const blocks = await blocksAt(sampleHeights(fromHeight, tip.height, POINTS));
  const points = blocks.map(b => ({
    height: Number(b.height),
    timeMs: new Date(b.timestamp).getTime(),
  }));
  const firstPoint = points[0];
  if (!firstPoint) {
    return EMPTY;
  }

  const metaById = new Map<string, Metadata>();
  for (const m of registry.getAllAssets()) {
    if (m.penumbraAssetId) {
      metaById.set(uint8ArrayToBase64(m.penumbraAssetId.inner), m);
    }
  }
  const um = uint8ArrayToBase64(STAKING_TOKEN_ASSET_ID.inner);
  const stables = new Set<string>();
  for (const [id, m] of metaById) {
    const src = referencePriceFor(m.symbol);
    if (src?.kind === 'fixed' && src.usd === 1) {
      stables.add(id);
    }
  }
  const anchors = [um, ...stables].map(id => Buffer.from(id, 'base64'));

  const inRange = await pindexerDb
    .selectFrom('dex_ex_price_charts')
    .select(['asset_start', 'asset_end', 'close', 'start_time'])
    .where('the_window', '=', window)
    .where('start_time', '>=', new Date(firstPoint.timeMs))
    .where(eb => eb.or([eb('asset_start', 'in', anchors), eb('asset_end', 'in', anchors)]))
    .execute();

  // The last daily close before the range seeds each pair, so a pair that
  // did not trade inside the range still carries its price in.
  const seeds = await pindexerDb
    .selectFrom('dex_ex_price_charts')
    .distinctOn(['asset_start', 'asset_end'])
    .select(['asset_start', 'asset_end', 'close', 'start_time'])
    .where('the_window', '=', '1d')
    .where('start_time', '<', new Date(firstPoint.timeMs))
    .where(eb => eb.or([eb('asset_start', 'in', anchors), eb('asset_end', 'in', anchors)]))
    .orderBy('asset_start')
    .orderBy('asset_end')
    .orderBy('start_time', 'desc')
    .execute();

  const pricePoints: PricePoint[] = [];
  for (const row of [...seeds, ...inRange]) {
    const base = uint8ArrayToBase64(row.asset_start);
    const quote = uint8ArrayToBase64(row.asset_end);
    const baseMeta = metaById.get(base);
    const quoteMeta = metaById.get(quote);
    if (!baseMeta || !quoteMeta) {
      continue;
    }
    pricePoints.push({
      base,
      quote,
      timeMs: new Date(row.start_time).getTime(),
      price: calculateDisplayPrice(row.close, baseMeta, quoteMeta),
    });
  }

  const usd = buildUsdSeries({
    points: pricePoints,
    times: points.map(p => p.timeMs),
    stables,
    um,
  });
  return { points, usd: Object.fromEntries(usd) };
};

/**
 * Block-time sample points and per-asset USD price series for a range,
 * cached for a minute. Shared by the portfolio chart and the explorer's
 * shielded-pool chart.
 */
export const getPriceHistory = async (range: HistoryRange): Promise<PortfolioHistoryResponse> => {
  const hit = cache.get(range);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.body;
  }
  const body = await build(range);
  cache.set(range, { at: Date.now(), body });
  return body;
};

async function handleGet(req: NextRequest): Promise<NextResponse<PortfolioHistoryResponse>> {
  const range = new URL(req.url).searchParams.get('range');
  if (!isHistoryRange(range)) {
    return NextResponse.json(EMPTY, { status: 400 });
  }
  const body = await getPriceHistory(range);
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY,
  logTag: 'portfolio-history',
});
