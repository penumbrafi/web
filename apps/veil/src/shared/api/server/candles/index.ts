import { NextRequest, NextResponse } from 'next/server';
import { ChainRegistryClient } from '@penumbrafi/registry';
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

const getCandlesOneDirection = async ({
  assetStart,
  assetEnd,
  window,
  chainId,
  page,
  limit,
}: {
  assetStart: AssetId;
  assetEnd: AssetId;
  window: DurationWindow;
  limit?: number;
  page?: number;
  chainId: string;
}): Promise<DbCandle[]> => {
  const filteredCandles = pindexerDb
    .selectFrom('dex_ex_price_charts')
    .select(['start_time', 'open', 'close', 'low', 'high', 'swap_volume', 'direct_volume'])
    .where('the_window', '=', window)
    .where('asset_start', '=', Buffer.from(assetStart.inner))
    .where('asset_end', '=', Buffer.from(assetEnd.inner))
    .orderBy('start_time', 'desc')
    .$if(chainId === MAINNET_CHAIN_ID, qb => qb.where('start_time', '>=', new Date('2024-08-06')))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Kysely limitation
    .$if(limit !== undefined, qb => qb.limit(limit!))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Kysely limitation
    .$if(page !== undefined && limit !== undefined, qb => qb.offset(limit! * (page! - 1)));

  return pindexerDb
    .selectFrom(filteredCandles.as('candles'))
    .selectAll()
    .orderBy('start_time', 'asc')
    .execute();
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

  // Query both directions in parallel: pindexer's dex_ex_price_charts is
  // direction-keyed, so (base→quote) holds taker-sell candles and
  // (quote→base) holds taker-buy candles. Merging the two by start_time
  // gives a single candle per bucket with split buy/sell volume.
  const [forwardRows, reverseRows] = await withTimeout(
    Promise.all([
      getCandlesOneDirection({
        assetStart: baseAssetMetadata.penumbraAssetId,
        assetEnd: quoteAssetMetadata.penumbraAssetId,
        window: durationWindow,
        chainId,
        limit,
        page,
      }),
      getCandlesOneDirection({
        assetStart: quoteAssetMetadata.penumbraAssetId,
        assetEnd: baseAssetMetadata.penumbraAssetId,
        window: durationWindow,
        chainId,
        limit,
        page,
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
