import { NextRequest, NextResponse } from 'next/server';
import { UTCTimestamp } from 'lightweight-charts';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
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
  if (startTimes.length === 0) {return [];}
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
  offset,
}: {
  assetStart: AssetId;
  assetEnd: AssetId;
  window: DurationWindow;
  chainId: string;
  limit?: number;
  offset?: number;
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
    .$if(offset !== undefined && offset > 0, qb => qb.offset(offset!))
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

  // Shared process-wide registry (memoized WAN fetch) — see
  // `getCachedRegistry`. Was a fresh `new ChainRegistryClient().remote.get`
  // per request, i.e. a GitHub round trip on every chart poll.
  const registry = await withTimeout(
    getCachedRegistry(chainId),
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
  //
  // Gap-fill boundary: page 1 fills to `now`; page N>1 additionally
  // fetches ONE extra bucket time (the oldest of page N-1) so we can fill
  // the seam up to — but excluding — it. That extra row is stripped from
  // the page itself so the response shape and page size are unchanged.
  const gapFill = searchParams.get('gapFill') !== '0';
  const isFirstPage = page === undefined || page <= 1 || limit === undefined;
  const wantSeam = gapFill && !isFirstPage && limit !== undefined && page !== undefined;
  const baseOffset = limit !== undefined && page !== undefined ? limit * (page - 1) : 0;
  const pagedTimes = await withTimeout(
    getPagedBucketTimes({
      assetStart: baseAssetMetadata.penumbraAssetId,
      assetEnd: quoteAssetMetadata.penumbraAssetId,
      window: durationWindow,
      chainId,
      limit: wantSeam && limit !== undefined ? limit + 1 : limit,
      offset: wantSeam ? baseOffset - 1 : baseOffset,
    }),
    DEFAULT_TIMEOUT_MS,
    'candles pindexer paged times',
  );
  let startTimes = pagedTimes;
  let fillTo: UTCTimestamp | undefined;
  if (gapFill) {
    if (isFirstPage) {
      fillTo = Math.floor(Date.now() / 1000) as UTCTimestamp;
    } else if (wantSeam) {
      // Rows are newest-first; the first row belongs to the previous page.
      const seam = pagedTimes[0];
      startTimes = pagedTimes.slice(1);
      if (seam) {
        fillTo = (Math.floor(seam.getTime() / 1000) - 1) as UTCTimestamp;
      }
    }
  }
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
    if (slot) {slot.rev = r;}
    else {byTime.set(t, { rev: r });}
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
  const filled = gapFill ? insertEmptyCandles(durationWindow, response, fillTo) : response;
  return NextResponse.json(filled);
}
