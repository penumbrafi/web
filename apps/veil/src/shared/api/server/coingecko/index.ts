import { NextRequest, NextResponse } from 'next/server';
import { Registry } from '@penumbrafi/registry';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { assetIdFromBech32m, isAssetId } from '@penumbra-zone/bech32m/passet';
import { pindexerDb } from '@/shared/database/client';
import { getCachedRegistry, STAKING_TOKEN_ASSET_ID } from '@/shared/api/fetch-registry';
import { indexingAsset } from '@/shared/api/server/indexing-asset';
import { referencePriceFor } from '@/shared/const/reference-price';
import { withTimeout, DEFAULT_TIMEOUT_MS } from '@/shared/api/server/with-api-fallback.ts';
import { aggregateLevels } from '@/shared/api/server/book/v2/levels.ts';
import { readBookSnapshot, readTouch } from '@/shared/api/server/book/v2';
import {
  HistoricalTrade,
  Market,
  MarketRow,
  OrientRules,
  buildMarkets,
  dec,
  exponentOf,
  indexingPrices,
  orient,
  parseTickerId,
  tickerIdOf,
  toPair,
  toTicker,
  toTrade,
  Ticker,
  PairEntry,
} from './markets';

// CoinGecko exchange integration (issue #32): /pairs, /tickers, /orderbook
// and /historical_trades under /api/coingecko, in the shape of CoinGecko's
// "Integration Ideal API Endpoints" document, so the DEX can be listed and
// UM gets a live price again.
//
// Public, unauthenticated, CORS-open. Market data is cached in process for
// MARKETS_TTL_MS; on an upstream failure the last good copy keeps being
// served. These routes never answer an empty list on failure: to a crawler
// that reads as "the exchange has no markets", so they 503 instead.

const MARKETS_TTL_MS = 30_000;
const TOUCH_TIMEOUT_MS = 4_000;
const TOUCH_CONCURRENCY = 4;
const DEFAULT_TRADES = 200;
const MAX_TRADES = 1_000;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=60',
};

const json = <T>(body: T, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...HEADERS, ...extra } });

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { ...HEADERS, 'Cache-Control': 'no-store' } });

export const OPTIONS = () => new NextResponse(null, { status: 204, headers: HEADERS });

const env = () => {
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  return { chainId, grpcEndpoint };
};

const loadRegistry = (chainId: string) =>
  withTimeout(getCachedRegistry(chainId), DEFAULT_TIMEOUT_MS, 'coingecko registry.get');

const rulesFor = (): OrientRules => ({
  isStable: (m: Metadata) => {
    const src = referencePriceFor(m.symbol);
    return src?.kind === 'fixed' && src.usd === 1;
  },
  stakingHex: Buffer.from(STAKING_TOKEN_ASSET_ID.inner).toString('hex'),
});

const lookupIn = (registry: Registry) => (id: Buffer) =>
  registry.tryGetMetadata(new AssetId({ inner: Uint8Array.from(id) }));

/** Both directions of every pair over the last day. */
const readMarketRows = (): Promise<MarketRow[]> =>
  pindexerDb
    .selectFrom('dex_ex_pairs_summary')
    .select([
      'asset_start',
      'asset_end',
      'price',
      'high',
      'low',
      'direct_volume_over_window',
      'liquidity',
    ])
    .where('the_window', '=', '1d')
    .execute();

interface MarketsSnapshot {
  markets: Market[];
  tickers: Ticker[];
}

/** Runs `fn` over `items`, at most `limit` at a time. */
const mapLimited = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) => {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const computeMarkets = async (chainId: string, grpcEndpoint?: string): Promise<MarketsSnapshot> => {
  const registry = await loadRegistry(chainId);
  const [rows, indexing] = await Promise.all([
    withTimeout(readMarketRows(), DEFAULT_TIMEOUT_MS, 'coingecko market rows'),
    withTimeout(indexingAsset(), DEFAULT_TIMEOUT_MS, 'coingecko indexing asset'),
  ]);
  const rules = rulesFor();
  const markets = buildMarkets(rows, lookupIn(registry), rules);
  const indexingMeta = registry.tryGetMetadata(indexing);
  const indexingExponent = indexingMeta ? exponentOf(indexingMeta) : undefined;
  const prices = indexingPrices(
    rows,
    Buffer.from(indexing.inner).toString('hex'),
    rules.stakingHex,
  );

  // The touch is recommended, not required: a pair whose scan fails or times
  // out is still listed, just without bid/ask.
  const tickers = await mapLimited(markets, TOUCH_CONCURRENCY, async m => {
    let touch: { bid?: number; ask?: number } = {};
    if (grpcEndpoint && m.base.penumbraAssetId && m.target.penumbraAssetId) {
      touch = await readTouch(
        grpcEndpoint,
        {
          base: m.base.penumbraAssetId,
          quote: m.target.penumbraAssetId,
          baseExponent: exponentOf(m.base),
          quoteExponent: exponentOf(m.target),
        },
        TOUCH_TIMEOUT_MS,
      ).catch(() => ({}));
    }
    return toTicker(m, { ...touch, prices, indexingExponent });
  });
  return { markets, tickers };
};

// One compute at a time, refreshed after MARKETS_TTL_MS; a failed refresh
// keeps the previous snapshot.
const memo: { value?: MarketsSnapshot; at: number; inflight?: Promise<MarketsSnapshot> } = {
  at: 0,
};

const getMarkets = async (chainId: string, grpcEndpoint?: string): Promise<MarketsSnapshot> => {
  const fresh = memo.value && Date.now() - memo.at < MARKETS_TTL_MS;
  if (fresh && memo.value) {
    return memo.value;
  }
  memo.inflight ??= computeMarkets(chainId, grpcEndpoint)
    .then(value => {
      memo.value = value;
      memo.at = Date.now();
      return value;
    })
    .finally(() => {
      memo.inflight = undefined;
    });
  try {
    return await memo.inflight;
  } catch (err) {
    if (memo.value) {
      console.warn('[coingecko] refresh failed, serving the previous markets', err);
      return memo.value;
    }
    throw err;
  }
};

const withMarkets = async (
  tag: string,
  pick: (s: MarketsSnapshot) => PairEntry[] | Ticker[],
): Promise<NextResponse> => {
  const { chainId, grpcEndpoint } = env();
  if (!chainId) {
    return fail('PENUMBRA_CHAIN_ID is not set', 500);
  }
  try {
    return json(pick(await getMarkets(chainId, grpcEndpoint)));
  } catch (err) {
    console.error(`[coingecko/${tag}]`, err);
    return fail('market data is temporarily unavailable', 503);
  }
};

export const getPairs = (): Promise<NextResponse> =>
  withMarkets('pairs', s => s.markets.map(toPair));

export const getTickers = (): Promise<NextResponse> => withMarkets('tickers', s => s.tickers);

/**
 * Resolve a ticker id to its two assets, and insist it is the canonical
 * orientation: `B_A` for a market listed as `A_B` is not a market.
 */
const resolveTicker = (
  registry: Registry,
  tickerId: string | null,
): { base: Metadata; target: Metadata; tickerId: string } | { error: string } => {
  const ids = tickerId ? parseTickerId(tickerId) : undefined;
  if (!tickerId || !ids || !isAssetId(ids[0]) || !isAssetId(ids[1])) {
    return { error: 'ticker_id must be <base passet1…>_<target passet1…>' };
  }
  const base = registry.tryGetMetadata(new AssetId(assetIdFromBech32m(ids[0])));
  const target = registry.tryGetMetadata(new AssetId(assetIdFromBech32m(ids[1])));
  if (!base || !target) {
    return { error: 'unknown asset in ticker_id' };
  }
  const [b, t] = orient(base, target, rulesFor());
  if (b !== base || tickerIdOf(ids[0], ids[1]) !== tickerId) {
    return { error: `not a canonical ticker_id; try ${ids[1]}_${ids[0]}` };
  }
  return { base: b, target: t, tickerId };
};

/** Optional non-negative integer query param. */
const intParam = (raw: string | null): number | undefined => {
  if (raw === null || raw === '') {
    return undefined;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export const getOrderbook = async (req: NextRequest): Promise<NextResponse> => {
  const { chainId, grpcEndpoint } = env();
  if (!chainId || !grpcEndpoint) {
    return fail('PENUMBRA_CHAIN_ID or PENUMBRA_GRPC_ENDPOINT is not set', 500);
  }
  const { searchParams } = new URL(req.url);
  try {
    const registry = await loadRegistry(chainId);
    const market = resolveTicker(registry, searchParams.get('ticker_id'));
    if ('error' in market) {
      return fail(market.error, 400);
    }

    // The book snapshot is keyed by symbol; a registry with two assets
    // sharing a symbol would hand back the other one's book.
    const all = registry.getAllAssets();
    const bySymbol = (s: string) => all.find(a => a.symbol.toLowerCase() === s.toLowerCase());
    if (
      !bySymbol(market.base.symbol)?.penumbraAssetId?.equals(market.base.penumbraAssetId) ||
      !bySymbol(market.target.symbol)?.penumbraAssetId?.equals(market.target.penumbraAssetId)
    ) {
      return fail('order book unavailable for this ticker_id (ambiguous symbol)', 404);
    }

    const outcome = await readBookSnapshot(
      grpcEndpoint,
      chainId,
      market.base.symbol,
      market.target.symbol,
      req.signal,
    );
    if (outcome.status === 'empty') {
      return fail('order book is temporarily unavailable', 503);
    }

    // depth=N is N/2 levels a side; 0 or absent is the whole book.
    const depth = intParam(searchParams.get('depth')) ?? 0;
    const perSide = depth > 0 ? Math.max(1, Math.floor(depth / 2)) : Infinity;
    const levels = (side: 'bid' | 'ask') =>
      aggregateLevels(side === 'bid' ? outcome.entry.data.bids : outcome.entry.data.asks, 0, side)
        .slice(0, perSide)
        .map(l => [dec(l.price), dec(l.amount)]);

    return json({
      ticker_id: market.tickerId,
      timestamp: String(outcome.entry.computedAt),
      bids: levels('bid'),
      asks: levels('ask'),
    });
  } catch (err) {
    console.error('[coingecko/orderbook]', err);
    return fail('order book is temporarily unavailable', 503);
  }
};

const readTrades = (start: AssetId, end: AssetId, limit: number, from?: Date, to?: Date) => {
  let q = pindexerDb
    .selectFrom('dex_ex_batch_swap_traces')
    .select(['rowid', 'input', 'output', 'time'])
    .where('asset_start', '=', Buffer.from(start.inner))
    .where('asset_end', '=', Buffer.from(end.inner));
  if (from) {
    q = q.where('time', '>=', from);
  }
  if (to) {
    q = q.where('time', '<=', to);
  }
  return q.orderBy('time', 'desc').orderBy('rowid', 'desc').limit(limit).execute();
};

export const getHistoricalTrades = async (req: NextRequest): Promise<NextResponse> => {
  const { chainId } = env();
  if (!chainId) {
    return fail('PENUMBRA_CHAIN_ID is not set', 500);
  }
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  if (type !== null && type !== 'buy' && type !== 'sell') {
    return fail('type must be buy or sell', 400);
  }
  const limit =
    Math.min(intParam(searchParams.get('limit')) ?? DEFAULT_TRADES, MAX_TRADES) || DEFAULT_TRADES;
  const startTime = intParam(searchParams.get('start_time'));
  const endTime = intParam(searchParams.get('end_time'));
  const from = startTime !== undefined ? new Date(startTime * 1000) : undefined;
  const to = endTime !== undefined ? new Date(endTime * 1000) : undefined;

  try {
    const registry = await loadRegistry(chainId);
    const market = resolveTicker(registry, searchParams.get('ticker_id'));
    if ('error' in market) {
      return fail(market.error, 400);
    }
    const baseId = market.base.penumbraAssetId;
    const targetId = market.target.penumbraAssetId;
    if (!baseId || !targetId) {
      return fail('unknown asset in ticker_id', 400);
    }
    const baseExp = exponentOf(market.base);
    const targetExp = exponentOf(market.target);

    // `type` is mandatory in CoinGecko's spec; without it, answer both.
    const side = async (t: 'buy' | 'sell'): Promise<HistoricalTrade[]> => {
      if (type !== null && type !== t) {
        return [];
      }
      const rows = await withTimeout(
        t === 'sell'
          ? readTrades(baseId, targetId, limit, from, to)
          : readTrades(targetId, baseId, limit, from, to),
        DEFAULT_TIMEOUT_MS,
        `coingecko historical_trades ${t}`,
      );
      return rows.map(r =>
        toTrade(
          {
            rowid: r.rowid,
            input: String(r.input),
            output: String(r.output),
            time: new Date(r.time),
          },
          t,
          baseExp,
          targetExp,
        ),
      );
    };
    const [buy, sell] = await Promise.all([side('buy'), side('sell')]);
    return json({ buy, sell });
  } catch (err) {
    console.error('[coingecko/historical_trades]', err);
    return fail('trade history is temporarily unavailable', 503);
  }
};
