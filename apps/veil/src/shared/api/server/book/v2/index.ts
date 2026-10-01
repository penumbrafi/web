import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@connectrpc/connect';
import { DexService } from '@penumbra-zone/protobuf';
import {
  DirectedTradingPair,
  Position,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { createClient } from '@/shared/utils/protos/utils.ts';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import { withApiFallback } from '@/shared/api/server/with-api-fallback.ts';
import { getLatestHeight } from '@/shared/api/server/book/height.ts';
import {
  CACHE_TTL_MS,
  GateOutcome,
  createOncePerBlockCache,
  withHardStop,
} from '@/shared/api/server/book/once-per-block.ts';
import {
  RawOrder,
  aggregateLevels,
  defaultStep,
  pageLevels,
  touchPrice,
} from '@/shared/api/server/book/v2/levels.ts';
import { PairAssets, positionToOrder } from '@/shared/api/server/book/v2/positions.ts';
import { bookEtag, ifNoneMatchHits } from '@/shared/api/server/book/v2/etag.ts';
import type {
  BookV2ApiResponse,
  BookV2Asset,
  BookV2Response,
} from '@/shared/api/server/book/v2/types.ts';

// /api/book/v2: the order book as direct liquidity positions, aggregated
// into price levels and paged outward from the touch.
//
// pd cost. v1 (/api/book) runs two `simulateTrade`s at an effectively
// unbounded input per pair per block: pd routes and EXECUTES a swap through
// the whole reachable book (multi-hop included) up to the execution budget,
// ~1-3s of pd CPU each. v2 instead makes two `liquidityPositionsByPrice`
// calls, a prefix scan of pd's price index that streams at most `limit`
// already-sorted positions with no routing or execution. It is far cheaper
// per call, and it goes through the same one-compute-per-pair-per-block gate
// as v1, so paging, bucket width and page size never reach pd: every page of
// every viewer is sliced from the one per-block snapshot.
//
// It does not REMOVE v1's compute: the hybrid limit form and useMarketPrice
// still read v1 (multi-hop traces), and pd never saw v1's trace limit, so
// the ladder and depth chart moving off it doesn't make v1 cheaper. Net per
// block per viewed pair: v1's two simulates (unchanged) + two cheap scans.
const DEFAULT_POSITION_LIMIT = 1_000;
const POSITION_LIMIT = (() => {
  const raw = Number(process.env['BOOK_V2_POSITION_LIMIT']);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_POSITION_LIMIT;
})();
const PD_TIMEOUT_MS = 10_000;

const DEFAULT_LEVELS = 20;
const MAX_LEVELS = 200;

export interface BookSnapshot {
  base: BookV2Asset;
  quote: BookV2Asset;
  bids: RawOrder[];
  asks: RawOrder[];
  /**
   * Height the CONTENT last changed at. A recompute at a new block that
   * finds the same positions keeps the previous `asOf`, so the ETag (and a
   * client's 304) survives quiet blocks instead of rolling every ~5s.
   */
  asOf: string;
  fingerprint: string;
  /** The scan stopped at its position limit, so there is more book beyond. */
  bidsTruncated: boolean;
  asksTruncated: boolean;
}

const gate = createOncePerBlockCache<BookSnapshot>('book-v2');
// Unlimited scans, for callers that need the whole book (CoinGecko's
// depth=0). Separate key space so it never replaces the capped snapshot the
// ladder pages from.
const fullGate = createOncePerBlockCache<BookSnapshot>('book-v2-full');

let cachedClient: Client<typeof DexService> | undefined;
const getDexClient = (endpoint: string): Client<typeof DexService> => {
  cachedClient ??= createClient(endpoint, DexService);
  return cachedClient;
};

const emptyResponse = (base = '', quote = ''): BookV2Response => ({
  height: null,
  mid: null,
  bestBid: null,
  bestAsk: null,
  step: 0,
  base: { symbol: base, exponent: 0 },
  quote: { symbol: quote, exponent: 0 },
  bids: [],
  asks: [],
});

// Short shared cache: a second tab or a refetch within the block reuses the
// response outright, and after that the browser revalidates with
// If-None-Match and usually gets a 304.
const CACHE_CONTROL = 'public, max-age=1, stale-while-revalidate=5';

/** Optional positive finite number, else undefined. */
const parsePositive = (raw: string | null): number | undefined => {
  if (raw === null || raw === '') {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const parseLevels = (raw: string | null): number => {
  const n = Number(raw);
  if (raw === null || raw === '' || !Number.isFinite(n)) {
    return DEFAULT_LEVELS;
  }
  return Math.min(MAX_LEVELS, Math.max(1, Math.floor(n)));
};

/** `step` absent → default (~0.1% of mid); `0` → raw; else the given width. */
export const parseStep = (raw: string | null): number | undefined => {
  if (raw === null || raw === '') {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * The pair's per-block snapshot through the shared gate, so any route that
 * needs the book (this one, the CoinGecko orderbook) costs pd at most one
 * pair of scans per block between them.
 */
export const readBookSnapshot = async (
  grpcEndpoint: string,
  chainId: string,
  baseSymbol: string,
  quoteSymbol: string,
  signal: AbortSignal,
  { full = false }: { full?: boolean } = {},
): Promise<GateOutcome<BookSnapshot>> => {
  const pairKey = `${baseSymbol.toLowerCase()}|${quoteSymbol.toLowerCase()}`;
  const height = await getLatestHeight(grpcEndpoint);
  const cache = full ? fullGate : gate;
  // pd reads a limit of 0 as "no limit".
  const positionLimit = full ? 0 : POSITION_LIMIT;
  return cache.get(
    pairKey,
    height,
    computeSignal =>
      computeSnapshot(
        grpcEndpoint,
        chainId,
        baseSymbol,
        quoteSymbol,
        computeSignal,
        positionLimit,
      ).then(snap => {
        const prev = cache.peek(pairKey)?.data;
        const asOf =
          prev && prev.fingerprint === snap.fingerprint
            ? prev.asOf
            : (height?.toString() ?? `t${Date.now()}`);
        return { ...snap, asOf };
      }),
    signal,
  );
};

export const GET = withApiFallback<[NextRequest], BookV2ApiResponse>(handleGet, {
  emptyResponse: emptyResponse(),
  logTag: 'book-v2',
});

async function handleGet(req: NextRequest): Promise<NextResponse<BookV2ApiResponse>> {
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
  const baseSymbol = searchParams.get('baseAsset');
  const quoteSymbol = searchParams.get('quoteAsset');
  if (!baseSymbol || !quoteSymbol) {
    return NextResponse.json(
      { error: 'Missing required baseAsset or quoteAsset' },
      { status: 400 },
    );
  }
  const levels = parseLevels(searchParams.get('levels'));
  const stepParam = parseStep(searchParams.get('step'));
  const cursorBid = parsePositive(searchParams.get('cursorBid'));
  const cursorAsk = parsePositive(searchParams.get('cursorAsk'));

  const pairKey = `${baseSymbol.toLowerCase()}|${quoteSymbol.toLowerCase()}`;
  const outcome = await readBookSnapshot(
    grpcEndpoint,
    chainId,
    baseSymbol,
    quoteSymbol,
    req.signal,
  );

  if (outcome.status === 'empty') {
    return NextResponse.json(emptyResponse(baseSymbol, quoteSymbol), {
      headers: {
        'Cache-Control': 'no-store',
        'X-Cache': outcome.reason,
        'X-Book-Fallback': 'empty',
      },
    });
  }

  const { entry } = outcome;
  const snap = entry.data;
  const bestBid = touchPrice(snap.bids, 'bid');
  const bestAsk = touchPrice(snap.asks, 'ask');
  const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : undefined;
  const step = stepParam ?? defaultStep(mid ?? bestBid ?? bestAsk);

  const headers: Record<string, string> = {
    'Cache-Control': CACHE_CONTROL,
    ETag: bookEtag({ pairKey, asOf: snap.asOf, step, levels, cursorBid, cursorAsk }),
    ...xCacheHeaders(outcome, Date.now()),
  };
  if (ifNoneMatchHits(req.headers.get('if-none-match'), headers['ETag'] ?? '')) {
    return new NextResponse<BookV2ApiResponse>(null, { status: 304, headers });
  }

  // Bucketing a <=1000-position snapshot per request is sub-millisecond, so
  // it isn't cached per (step, cursor); only the pd read is.
  const bidPage = pageLevels(aggregateLevels(snap.bids, step, 'bid'), 'bid', cursorBid, levels);
  const askPage = pageLevels(aggregateLevels(snap.asks, step, 'ask'), 'ask', cursorAsk, levels);
  const body: BookV2Response = {
    height: entry.height?.toString() ?? null,
    mid: mid ?? null,
    bestBid: bestBid ?? null,
    bestAsk: bestAsk ?? null,
    step,
    base: snap.base,
    quote: snap.quote,
    bids: bidPage.rows,
    asks: askPage.rows,
    ...(bidPage.nextCursor !== undefined ? { nextCursorBid: bidPage.nextCursor } : {}),
    ...(askPage.nextCursor !== undefined ? { nextCursorAsk: askPage.nextCursor } : {}),
  };
  return NextResponse.json(body, { headers });
}

const xCacheHeaders = (
  outcome: Exclude<GateOutcome<BookSnapshot>, { status: 'empty' }>,
  now: number,
): Record<string, string> => {
  const age = now - outcome.entry.computedAt;
  const ageHeader = { 'X-Cache-Age-Ms': String(age) };
  switch (outcome.status) {
    case 'cached':
      return {
        ...ageHeader,
        'X-Cache': age < CACHE_TTL_MS ? 'HIT' : 'STALE',
        ...(outcome.backingOff && !outcome.sameBlock ? { 'X-Book-Fallback': 'backoff' } : {}),
      };
    case 'revalidate':
      return { ...ageHeader, 'X-Cache': 'STALE-REVALIDATE' };
    case 'inflight':
      return { 'X-Cache': 'INFLIGHT' };
    case 'miss':
      return { 'X-Cache': 'MISS' };
    case 'stale-fail':
      return { ...ageHeader, 'X-Cache': 'STALE-FAIL', 'X-Book-Fallback': 'stale' };
  }
};

const fingerprintOf = (bids: RawOrder[], asks: RawOrder[]): string =>
  [...bids, ...asks].map(o => `${o.price}@${o.amount}`).join(',') +
  `|${bids.length}|${asks.length}`;

async function computeSnapshot(
  grpcEndpoint: string,
  chainId: string,
  baseSymbol: string,
  quoteSymbol: string,
  cancel: AbortSignal,
  positionLimit: number,
): Promise<Omit<BookSnapshot, 'asOf'>> {
  const registry = await getCachedRegistry(chainId);
  const allAssets = registry.getAllAssets();
  const baseMeta = allAssets.find(a => a.symbol.toLowerCase() === baseSymbol.toLowerCase());
  const quoteMeta = allAssets.find(a => a.symbol.toLowerCase() === quoteSymbol.toLowerCase());
  if (!baseMeta?.penumbraAssetId || !quoteMeta?.penumbraAssetId) {
    throw new Error('Base asset or quoteAsset metadata not found in registry');
  }
  const assets: PairAssets = {
    base: baseMeta.penumbraAssetId,
    quote: quoteMeta.penumbraAssetId,
    baseExponent: getDisplayDenomExponent.optional(baseMeta) ?? 0,
    quoteExponent: getDisplayDenomExponent.optional(quoteMeta) ?? 0,
  };

  const client = getDexClient(grpcEndpoint);
  // One signal for both scans: the hard timeout, or the gate cancelling.
  // `timeoutMs` also sets `grpc-timeout` so pd enforces the deadline itself.
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(PD_TIMEOUT_MS)]);
  const scan = async (start: AssetId, end: AssetId): Promise<Position[]> => {
    const out: Position[] = [];
    // Positions that can take `start` and give `end`, best price first.
    const stream = client.liquidityPositionsByPrice(
      {
        tradingPair: new DirectedTradingPair({ start, end }),
        limit: BigInt(positionLimit),
      },
      { signal, timeoutMs: PD_TIMEOUT_MS },
    );
    for await (const res of stream) {
      if (res.data) {
        out.push(res.data);
      }
    }
    return out;
  };

  // Asks give out base (trader pays quote); bids give out quote.
  const [askPositions, bidPositions] = await withHardStop(
    Promise.all([scan(assets.quote, assets.base), scan(assets.base, assets.quote)]),
    PD_TIMEOUT_MS + 1_000,
  );
  const toOrders = (positions: Position[], side: 'bid' | 'ask'): RawOrder[] => {
    const orders: RawOrder[] = [];
    for (const pos of positions) {
      const order = positionToOrder(pos, side, assets);
      if (order) {
        orders.push(order);
      }
    }
    return orders;
  };
  const bids = toOrders(bidPositions, 'bid');
  const asks = toOrders(askPositions, 'ask');
  return {
    base: { symbol: baseMeta.symbol, exponent: assets.baseExponent },
    quote: { symbol: quoteMeta.symbol, exponent: assets.quoteExponent },
    bids,
    asks,
    fingerprint: fingerprintOf(bids, asks),
    bidsTruncated: positionLimit > 0 && bidPositions.length >= positionLimit,
    asksTruncated: positionLimit > 0 && askPositions.length >= positionLimit,
  };
}

// A handful is enough to find the touch: pd streams best price first, and
// the few behind it only matter when fees reorder near-equal positions.
const TOUCH_SCAN_LIMIT = 8n;

/**
 * Best bid and ask only, from two short price-index scans. For callers that
 * need the touch of many pairs at once (CoinGecko /tickers) without pulling
 * each pair's full snapshot.
 */
export const readTouch = async (
  grpcEndpoint: string,
  assets: PairAssets,
  timeoutMs: number,
): Promise<{ bid?: number; ask?: number }> => {
  const client = getDexClient(grpcEndpoint);
  const signal = AbortSignal.timeout(timeoutMs);
  const scan = async (start: AssetId, end: AssetId, side: 'bid' | 'ask') => {
    const orders: RawOrder[] = [];
    const stream = client.liquidityPositionsByPrice(
      { tradingPair: new DirectedTradingPair({ start, end }), limit: TOUCH_SCAN_LIMIT },
      { signal, timeoutMs },
    );
    for await (const res of stream) {
      const order = res.data && positionToOrder(res.data, side, assets);
      if (order) {
        orders.push(order);
      }
    }
    return touchPrice(orders, side);
  };
  const [ask, bid] = await withHardStop(
    Promise.all([scan(assets.quote, assets.base, 'ask'), scan(assets.base, assets.quote, 'bid')]),
    timeoutMs + 1_000,
  );
  return { bid, ask };
};
