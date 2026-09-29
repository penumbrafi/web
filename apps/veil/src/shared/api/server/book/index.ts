import { NextRequest, NextResponse } from 'next/server';
import { Registry } from '@penumbrafi/registry';
import {
  SimulateTradeRequest,
  SimulateTradeResponse,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Amount } from '@penumbra-zone/protobuf/penumbra/core/num/v1/num_pb';
import { RouteBookResponseJson } from '@/shared/api/server/book/types.ts';
import { processSimulation } from '@/shared/api/server/book/helpers.ts';
import { serializeResponse } from '@/shared/api/server/book/serialization.ts';
import { SimulationService } from '@penumbra-zone/protobuf';
import { Client } from '@connectrpc/connect';
import { createClient } from '@/shared/utils/protos/utils.ts';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import { withApiFallback } from '@/shared/api/server/with-api-fallback.ts';
import { getLatestHeight } from '@/shared/api/server/book/height.ts';
import {
  CACHE_TTL_MS,
  GateEntry,
  createOncePerBlockCache,
  withHardStop,
} from '@/shared/api/server/book/once-per-block.ts';

export const VERY_HIGH_AMOUNT = new Amount({ hi: 10000n }); // Used as default to generate sufficient amount of traces
export const TRACE_LIMIT_DEFAULT = 30;

export type RouteBookApiResponse = RouteBookResponseJson | { error: string };

// The client only ever sends 1 (portfolio mids), 30 (route-book/depth default,
// order-form prime) or 100 (route-book/depth panels). Anything else is either a typo
// or abuse: `traceLimit=abc` gave a NaN cache key and an asymmetric book
// (`slice(0, NaN)` empties one side, `slice(-NaN)` keeps the other), and
// every distinct integer minted a fresh cache key + two pd simulates.
// 1 = touch only (best bid + best ask), for screens that just need a mid.
export const TRACE_LIMIT_TOUCH = 1;
const TRACE_LIMIT_ALLOWED = new Set<number>([TRACE_LIMIT_TOUCH, TRACE_LIMIT_DEFAULT, 100]);
const parseTraceLimit = (raw: string | null): number => {
  if (raw === null || raw === '') {
    return TRACE_LIMIT_DEFAULT;
  }
  const parsed = Number(raw);
  if (TRACE_LIMIT_ALLOWED.has(parsed)) {
    return parsed;
  }
  console.warn('[book] unsupported traceLimit, clamping to default', {
    raw,
    fallback: TRACE_LIMIT_DEFAULT,
  });
  return TRACE_LIMIT_DEFAULT;
};

// Empty book we return as a graceful fallback when pd is unreachable or
// slow. Serving an empty book with a hint header degrades the UI (empty
// route book, empty depth chart) but keeps the app rendered — much better
// than 502 → ErrorBoundary → React error #300 blowing up the whole trade
// page. `useBook` handles empty arrays already.
const EMPTY_BOOK: RouteBookResponseJson = {
  singleHops: { buy: [], sell: [] },
  multiHops: { buy: [], sell: [] },
} as RouteBookResponseJson;

// Bound the pd call so a hanging simulation cannot pin an Actions runner
// or a next-server request slot. The route-book UI polls every block
// anyway; a couple of dropped refreshes are cheap compared to a wedged
// response queue.
// pd's simulate itself takes ~0.85s p50 for real routes on a fully synced
// mainnet node (bench: 5x grpcurl runs from inside CT1102). Two parallel
// simulates cap around 0.85s. The remainder of the budget covers TLS +
// registry lookup + serialization. Held generous so a page hiccup (JIT,
// GC, momentary rocksdb page miss) doesn't wedge the book cache.
const PD_TIMEOUT_MS = 10_000;

// Module-scope singleton. Endpoint comes from env vars baked at process
// start — it doesn't change over a next-server lifetime, so we can safely
// reuse one Connect transport (keeps the HTTP/2 connection to nginx alive
// across requests, killing the ~1s TLS handshake per book refresh). The
// registry is likewise process-wide via `getCachedRegistry`.
let cachedClient: Client<typeof SimulationService> | undefined;
const getSimClient = (endpoint: string): Client<typeof SimulationService> => {
  cachedClient ??= createClient(endpoint, SimulationService);
  return cachedClient;
};

// Server-side cache for route book responses. pd's simulateTrade is
// CPU-expensive: we ask for an effectively unbounded amount, so every call
// fills through the whole reachable book up to the chain's execution budget
// (~3s of pd CPU each). The one-compute-per-pair-per-block gate (height
// gating, single-flight, failure backoff) lives in `once-per-block.ts`,
// shared with /api/book/v2.
//
// Keyed by pair only. Both trace limits the client uses (30, 100) come from
// ONE compute at COMPUTE_TRACE_LIMIT, sliced per request: pd never sees the
// limit (it only trims our post-processing), so separate keys meant two
// identical pd calls per pair per refresh.
const gate = createOncePerBlockCache<RouteBookResponseJson>('book');
const COMPUTE_TRACE_LIMIT = 100;

/** Trim a COMPUTE_TRACE_LIMIT book to what this request asked for. */
export const sliceBook = (data: RouteBookResponseJson, limit: number): RouteBookResponseJson => {
  if (limit >= COMPUTE_TRACE_LIMIT) {
    return data;
  }
  // processSimulation stores bids best-first (descending) and asks best-LAST
  // (the lowest `limit` asks, reversed for display: highest at the top, best
  // ask at the bottom). So a `limit` compute's asks are the TAIL of the
  // stored side. Taking the head kept the 30 worst asks: on UM/USDC.inj the
  // default book's best ask read 0.00609 against a real 0.003965, and every
  // mid built on it was off. Singles stay the 2-hop subset of the trimmed
  // multi-hop lists.
  const buy = data.multiHops.buy.slice(0, limit);
  const sell = data.multiHops.sell.slice(-limit);
  return {
    singleHops: {
      buy: buy.filter(t => t.hops.length === 2),
      sell: sell.filter(t => t.hops.length === 2),
    },
    multiHops: { buy, sell },
  };
};

const cacheHeaders = (entry: GateEntry<RouteBookResponseJson>, now: number) => {
  const age = now - entry.computedAt;
  return {
    'Cache-Control': 'no-store',
    'X-Cache': age < CACHE_TTL_MS ? 'HIT' : 'STALE',
    'X-Cache-Age-Ms': String(age),
  };
};

// Outer belt: the handler already degrades every pd failure to a 200 +
// `X-Book-Fallback` itself; this only catches the unexpected (a throw
// before we reach the compute path) so it can never surface as a 500,
// and adds `X-Served-Ms` timing for the route.
export const GET = withApiFallback<[NextRequest], RouteBookApiResponse>(handleGet, {
  emptyResponse: EMPTY_BOOK,
  logTag: 'book',
});

async function handleGet(req: NextRequest): Promise<NextResponse<RouteBookApiResponse>> {
  // Prefer a server-only internal endpoint (localhost / private network) to
  // skip TLS, NAT, and reverse-proxy overhead. Falls back to public endpoint.
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
  const traceParam = searchParams.get('traceLimit');
  const limit = parseTraceLimit(traceParam);
  if (!baseAssetSymbol || !quoteAssetSymbol) {
    return NextResponse.json(
      { error: 'Missing required baseAsset or quoteAsset' },
      { status: 400 },
    );
  }

  const cacheKey = `${baseAssetSymbol.toLowerCase()}|${quoteAssetSymbol.toLowerCase()}`;
  const height = await getLatestHeight(grpcEndpoint);
  // `nocache=1` used to force a compute after a user's own swap. It is no
  // longer needed and is ignored: the swap lands in a new block, the height
  // moves, and the next request recomputes anyway. Honouring it let every
  // client bypass the one-per-block limit.
  const outcome = await gate.get(
    cacheKey,
    height,
    signal =>
      computeRouteBook(
        grpcEndpoint,
        chainId,
        baseAssetSymbol,
        quoteAssetSymbol,
        COMPUTE_TRACE_LIMIT,
        signal,
      ),
    req.signal,
  );
  const now = Date.now();

  switch (outcome.status) {
    case 'cached':
      return NextResponse.json(sliceBook(outcome.entry.data, limit), {
        headers: {
          ...cacheHeaders(outcome.entry, now),
          ...(outcome.backingOff && !outcome.sameBlock ? { 'X-Book-Fallback': 'backoff' } : {}),
        },
      });
    case 'revalidate':
      return NextResponse.json(sliceBook(outcome.entry.data, limit), {
        headers: { ...cacheHeaders(outcome.entry, now), 'X-Cache': 'STALE-REVALIDATE' },
      });
    case 'inflight':
      return NextResponse.json(sliceBook(outcome.entry.data, limit), {
        headers: { 'X-Cache': 'INFLIGHT' },
      });
    case 'miss':
      return NextResponse.json(sliceBook(outcome.entry.data, limit), {
        headers: { 'Cache-Control': 'no-store', 'X-Cache': 'MISS' },
      });
    case 'stale-fail':
      return NextResponse.json(sliceBook(outcome.entry.data, limit), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': 'STALE-FAIL',
          'X-Book-Fallback': 'stale',
        },
      });
    case 'empty':
      return emptyFallback(outcome.reason);
  }
}

const emptyFallback = (xCache: string): NextResponse<RouteBookApiResponse> =>
  NextResponse.json(EMPTY_BOOK, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Cache': xCache,
      'X-Book-Fallback': 'empty',
    },
  });

async function computeRouteBook(
  grpcEndpoint: string,
  chainId: string,
  baseAssetSymbol: string,
  quoteAssetSymbol: string,
  limit: number,
  cancel: AbortSignal,
): Promise<RouteBookResponseJson> {
  const registry: Registry = await getCachedRegistry(chainId);

  const allAssets = registry.getAllAssets();
  const baseAssetMetadata = allAssets.find(
    a => a.symbol.toLowerCase() === baseAssetSymbol.toLowerCase(),
  );
  const quoteAssetMetadata = allAssets.find(
    a => a.symbol.toLowerCase() === quoteAssetSymbol.toLowerCase(),
  );
  if (!baseAssetMetadata || !quoteAssetMetadata) {
    throw new Error('Base asset or quoteAsset metadata not found in registry');
  }

  const buySideRequest = new SimulateTradeRequest({
    input: new Value({
      assetId: baseAssetMetadata.penumbraAssetId,
      amount: VERY_HIGH_AMOUNT,
    }),
    output: quoteAssetMetadata.penumbraAssetId,
  });

  const sellSideRequest = new SimulateTradeRequest({
    input: new Value({
      assetId: quoteAssetMetadata.penumbraAssetId,
      amount: VERY_HIGH_AMOUNT,
    }),
    output: baseAssetMetadata.penumbraAssetId,
  });

  const client = getSimClient(grpcEndpoint);
  // One signal for both sides: fires on the hard timeout OR when every
  // requester has disconnected. Passed straight into Connect, which
  // aborts the underlying fetch — so pd sees the stream reset and stops
  // computing instead of finishing a result nobody will read. If one side
  // fails the other is aborted too via the shared controller. `timeoutMs`
  // additionally sets the `grpc-timeout` header so pd enforces the
  // deadline server-side even if the abort doesn't propagate cleanly
  // through the reverse proxy.
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(PD_TIMEOUT_MS)]);
  const sides = new AbortController();
  const onAny = () => sides.abort(signal.reason);
  signal.addEventListener('abort', onAny, { once: true });
  const callSignal = sides.signal;
  const simulateOrAbortPeer = async (req: SimulateTradeRequest) => {
    try {
      return await simulateTrade(client, req, callSignal);
    } catch (e) {
      if (!sides.signal.aborted) {
        sides.abort(e);
      }
      throw e;
    }
  };
  try {
    // Backstop race: if the transport ever ignored the signal we still
    // stop waiting shortly after the deadline instead of hanging a slot.
    const [buyRes, sellRes] = await withHardStop(
      Promise.all([simulateOrAbortPeer(buySideRequest), simulateOrAbortPeer(sellSideRequest)]),
      PD_TIMEOUT_MS + 1_000,
    );
    const buyMulti = processSimulation({ res: buyRes, registry, limit, quote_to_base: false });
    const sellMulti = processSimulation({ res: sellRes, registry, limit, quote_to_base: true });

    return serializeResponse({
      singleHops: {
        buy: buyMulti.filter(t => t.hops.length === 2),
        sell: sellMulti.filter(t => t.hops.length === 2),
      },
      multiHops: { buy: buyMulti, sell: sellMulti },
    });
  } finally {
    signal.removeEventListener('abort', onAny);
  }
}

const simulateTrade = async (
  client: Client<typeof SimulationService>,
  req: SimulateTradeRequest,
  signal: AbortSignal,
) => {
  try {
    return await client.simulateTrade(req, { signal, timeoutMs: PD_TIMEOUT_MS });
  } catch (e) {
    // If the error contains 'there are no orders to fulfill this swap', there are no orders to fulfill the trade,
    // so just return an empty array
    if (e instanceof Error && e.message.includes('there are no orders to fulfill this swap')) {
      return new SimulateTradeResponse({});
    }

    throw new Error(`Error retrieving route book: ${String(e)}`);
  }
};
