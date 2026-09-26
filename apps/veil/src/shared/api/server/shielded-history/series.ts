import { NextRequest, NextResponse } from 'next/server';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { pindexerDb } from '@/shared/database/client';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';
import { unregisteredExponent } from './exponents';
import { timesFor } from './block-times';
import { shieldedRows } from './index';
import { MAX_SERIES_ASSETS, ShieldedSeries, ShieldedSeriesResponse } from './types';

const EMPTY: ShieldedSeriesResponse = { series: [], tipMs: 0 };
const BASE64_ID = /^[A-Za-z0-9+/]{43}=$/;
const toDisplay = (amount: bigint, exponent: number) => Number(amount) / 10 ** exponent;

/**
 * Full shielded-pool history of up to 8 assets (`?assets=id,id`, base64),
 * every change at block resolution, so the chart can zoom anywhere without
 * asking again. Public pool-level data, the same for every caller.
 */
async function handleGet(req: NextRequest): Promise<NextResponse<ShieldedSeriesResponse>> {
  const ids = [
    ...new Set(
      (new URL(req.url).searchParams.get('assets') ?? '')
        .split(',')
        .filter(id => BASE64_ID.test(id)),
    ),
  ];
  if (ids.length === 0 || ids.length > MAX_SERIES_ASSETS) {
    return NextResponse.json(EMPTY, { status: 400 });
  }
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!chainId) {
    throw new Error('PENUMBRA_CHAIN_ID is not set');
  }
  const [registry, byAsset, tip] = await Promise.all([
    withTimeout(getCachedRegistry(chainId), DEFAULT_TIMEOUT_MS, 'shielded-series registry'),
    shieldedRows(),
    pindexerDb
      .selectFrom('block_details')
      .select('timestamp')
      .orderBy('height', 'desc')
      .limit(1)
      .executeTakeFirst(),
  ]);

  const heights = new Set<number>();
  for (const id of ids) {
    for (const r of byAsset.get(id) ?? []) {
      heights.add(r.height);
    }
  }
  const times = await timesFor([...heights]);

  const series: ShieldedSeries[] = ids.map(id => {
    const meta = registry.tryGetMetadata(new AssetId({ inner: Buffer.from(id, 'base64') }));
    const exponent = meta ? getDisplayDenomExponent(meta) : unregisteredExponent(id);
    const points: ShieldedSeries['points'] = [];
    for (const r of byAsset.get(id) ?? []) {
      // pindexer can have gaps in block_details; such a change just drops.
      const t = times.get(r.height);
      if (t !== undefined) {
        points.push([t, toDisplay(r.current, exponent), toDisplay(r.total, exponent)]);
      }
    }
    return { assetId: id, points };
  });

  return NextResponse.json(
    { series, tipMs: tip ? new Date(tip.timestamp).getTime() : 0 },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY,
  logTag: 'shielded-series',
});
