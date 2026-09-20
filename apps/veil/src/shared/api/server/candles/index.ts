import { NextRequest, NextResponse } from 'next/server';
import { ChainRegistryClient } from '@penumbra-labs/registry';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { DurationWindow, durationWindows, isDurationWindow } from '@/shared/utils/duration.ts';
import { combineDbCandles, insertEmptyCandles } from '@/shared/api/server/candles/utils.ts';
import { CandleApiResponse, DbCandle } from '@/shared/api/server/candles/types.ts';
import { pindexerDb } from '@/shared/database/client';
import { withApiFallback, withTimeout, DEFAULT_TIMEOUT_MS } from '@/shared/api/server/with-api-fallback.ts';

const MAINNET_CHAIN_ID = 'penumbra-1';

// Empty candle list -- the graceful fallback served when the registry or
// pindexer is unreachable. Candle consumers already handle an empty array
// (no chart data yet) rather than crashing.
const EMPTY_CANDLES: CandleApiResponse = [];

const getCandlesForTimes = async ({
  assetStart,
  assetEnd,
  window,
  chainId,
  startTimes,
}: {
  assetStart: AssetId;
  assetEnd: AssetId;
  window: DurationWindow;
  chainId: string;
  startTimes: Date[];
}): Promise<DbCandle[]> => {
  if (startTimes.length === 0) return [];
  return pindexerDb
    .selectFrom('dex_ex_price_charts')
    .select(['start_time', 'open', 'close', 'low', 'high', 'swap_volume', 'direct_volume'])
    .where('the_window', '=', window)
    .where('asset_start', '=', Buffer.from(assetStart.inner))
    .where('asset_end', '=', Buffer.from(assetEnd.inner))
    .$if(chainId === MAINNET_CHAIN_ID, qb => qb.where('start_time', '>=', new Date('2024-08-06')))
    .where('start_time', 'in', startTimes)
    .orderBy('start_time', 'asc')
    .execute();
};

/**
 * Distinct `start_time` values across both trade directions for this pair,
 * paged from the tip going back. Historically each direction was paginated
 * independently (LIMIT/OFFSET per direction), then merged by time — a
 * sparser direction's page-1 reached further back than the denser one's,
 * so page-2 rows interleaved with page-1 times and the merged array was
 * non-monotonic. lightweight-charts then threw "data must be asc ordered
 * by time" on scroll-back. Union-first pagination guarantees both
 * directions return rows for the same window and merging stays monotonic.
 */
const getPagedBucketTimes = async ({
  assetStart,
  assetEnd,
  window,
  chainId,
  limit,
  page,
}: {
  assetStart: AssetId;
  assetEnd: AssetId;
  window: DurationWindow;
  chainId: string;
  limit?: number;
  page?: number;
}): Promise<Date[]> => {
  // Union both direction's start_times, then paginate on the distinct
  // set. Direction is captured only via the two WHERE branches; the
  // outer query only cares about time.
  const forward = pindexerDb
    .selectFrom('dex_ex_price_charts')
    .select('start_time')
    .where('the_window', '=', window)
    .where('asset_start', '=', Buffer.from(assetStart.inner))
    .where('asset_end', '=', Buffer.from(assetEnd.inner))
    .$if(chainId === MAINNET_CHAIN_ID, qb => qb.where('start_time', '>=', new Date('2024-08-06')));
  const reverse = pindexerDb
    .selectFrom('dex_ex_price_charts')
    .select('start_time')
    .where('the_window', '=', window)
    .where('asset_start', '=', Buffer.from(assetEnd.inner))
    .where('asset_end', '=', Buffer.from(assetStart.inner))
    .$if(chainId === MAINNET_CHAIN_ID, qb => qb.where('start_time', '>=', new Date('2024-08-06')));

  const q = forward
    .union(reverse)
    .as('u');
  const rows = await pindexerDb
    .selectFrom(q)
    .select('start_time')
    .distinct()
    .orderBy('start_time', 'desc')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Kysely limitation
    .$if(limit !== undefined, qb => qb.limit(limit!))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Kysely limitation
    .$if(page !== undefined && limit !== undefined, qb => qb.offset(limit! * (page! - 1)))
    .execute();
  return rows.map(r => r.start_time);
};

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY_CANDLES,
  logTag: 'candles',
});

async function handleGet(req: NextRequest): Promise<NextResponse<CandleApiResponse>> {
  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!grpcEndpoint || !chainId) {
    return NextResponse.json(
      { error: 'PENUMBRA_GRPC_ENDPOINT or PENUMBRA_CHAIN_ID is not set' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const baseAssetSymbol = searchParams.get('baseAsset');
  const quoteAssetSymbol = searchParams.get('quoteAsset');
  const limit = Number(searchParams.get('limit')) || undefined;
  const page = Number(searchParams.get('page')) || undefined;

  if (!baseAssetSymbol || !quoteAssetSymbol) {
    return NextResponse.json(
      { error: 'Missing required baseAsset or quoteAsset' },
      { status: 400 },
    );
  }
  const durationWindow = searchParams.get('durationWindow');
  if (!durationWindow || !isDurationWindow(durationWindow)) {
    return NextResponse.json(
      { error: `durationWindow missing or invalid window. Options: ${durationWindows.join(', ')}` },
      { status: 400 },
    );
  }

  const registryClient = new ChainRegistryClient();
  const registry = await withTimeout(
    registryClient.remote.get(chainId),
    DEFAULT_TIMEOUT_MS,
    'candles registry.get',
  );

  // TODO: Add getMetadataBySymbol() helper to registry npm package
  const allAssets = registry.getAllAssets();
  const baseAssetMetadata = allAssets.find(
    a => a.symbol.toLowerCase() === baseAssetSymbol.toLowerCase(),
  );
  const quoteAssetMetadata = allAssets.find(
    a => a.symbol.toLowerCase() === quoteAssetSymbol.toLowerCase(),
  );
  if (!baseAssetMetadata?.penumbraAssetId || !quoteAssetMetadata?.penumbraAssetId) {
    return NextResponse.json(
      { error: `Base asset or quoteAsset asset ids not found in registry` },
      { status: 400 },
    );
  }

  // Two-step: first take the distinct start_times to fetch this page (a
  // UNION across both direction keys, paginated). Then fetch every row
  // for those exact times in each direction. Both directions return
  // candles for the SAME window, so the merged output is guaranteed
  // monotonic in time — no more page-2 interleaving with page-1 that
  // used to crash lightweight-charts on scroll-back.
  const startTimes = await withTimeout(
    getPagedBucketTimes({
      assetStart: baseAssetMetadata.penumbraAssetId,
      assetEnd: quoteAssetMetadata.penumbraAssetId,
      window: durationWindow,
      chainId,
      limit,
      page,
    }),
    DEFAULT_TIMEOUT_MS,
    'candles pindexer paged times',
  );
  const [forwardRows, reverseRows] = await withTimeout(
    Promise.all([
      getCandlesForTimes({
        assetStart: baseAssetMetadata.penumbraAssetId,
        assetEnd: quoteAssetMetadata.penumbraAssetId,
        window: durationWindow,
        chainId,
        startTimes,
      }),
      getCandlesForTimes({
        assetStart: quoteAssetMetadata.penumbraAssetId,
        assetEnd: baseAssetMetadata.penumbraAssetId,
        window: durationWindow,
        chainId,
        startTimes,
      }),
    ]),
    DEFAULT_TIMEOUT_MS,
    'candles pindexer query',
  );

  const byTime = new Map<number, { fwd?: DbCandle; rev?: DbCandle }>();
  for (const r of forwardRows) {
    byTime.set(r.start_time.getTime(), { fwd: r });
  }
  for (const r of reverseRows) {
    const t = r.start_time.getTime();
    const slot = byTime.get(t);
    if (slot) slot.rev = r;
    else byTime.set(t, { rev: r });
  }

  const response = Array.from(byTime.entries())
    .sort(([a], [b]) => a - b)
    .map(([, { fwd, rev }]) =>
      combineDbCandles(fwd, rev, baseAssetMetadata, quoteAssetMetadata),
    );

  // Gap-fill the time axis when ?gapFill=1 (default): inject flat
  // candles (open=close=prev.close, vol=0) for every missing window-
  // step between real fills, so candle X-position tracks actual time
  // elapsed (Binance / TradingView default). gapFill=0 returns only
  // candles with real fills — denser plot but a quiet pair looks
  // busier than it was.
  const gapFill = searchParams.get('gapFill');
  const filled =
    gapFill === '0' ? response : insertEmptyCandles(durationWindow, response);
  return NextResponse.json(filled);
}
