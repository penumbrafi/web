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

export const VERY_HIGH_AMOUNT = new Amount({ hi: 10000n }); // Used as default to generate sufficient amount of traces
export const TRACE_LIMIT_DEFAULT = 30;

export type RouteBookApiResponse = RouteBookResponseJson | { error: string };

// The client only ever sends 30 (route-book/depth default, order-form
// prime) or 100 (route-book/depth panels). Anything else is either a typo
// or abuse: `traceLimit=abc` gave a NaN cache key and an asymmetric book
// (`slice(0, NaN)` empties one side, `slice(-NaN)` keeps the other), and
// every distinct integer minted a fresh cache key + two pd simulates.
const TRACE_LIMIT_ALLOWED = new Set<number>([TRACE_LIMIT_DEFAULT, 100]);
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
  if (!cachedClient) {
    cachedClient = createClient(endpoint, SimulationService);
  }
  return cachedClient;
};

// Server-side cache for route book responses. pd's simulateTrade is
// CPU-expensive (walks all liquidity positions) so we cache identical
// queries for ~6s (one block). Keyed by base+quote+limit. Concurrent
// requests for the same key share a single in-flight compute so we never
// hammer pd with duplicate work.
type CacheEntry = { data: RouteBookResponseJson; expiresAt: number; refreshing: boolean };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6_000;
// When a request comes in and cache is older than this, return the stale
// data immediately and refresh in background. This means most users never
// wait for pd's slow simulateTrade — they get instant stale data while a
// background fetch updates the cache.
const STALE_THRESHOLD_MS = 4_000;

// One in-flight pd compute per cache key. `controller` lets us really
// cancel the upstream simulate (not just stop waiting for it): before,
// `withTimeout` rejected our promise while pd kept walking positions for
// a client that had already gone away, so under load pd accumulated
// zombie compute jobs. `waiters` counts requests awaiting this compute;
// when `cancelOnIdle` is set and the last one disconnects we abort so pd
// stops too. Background SWR refreshes have no waiters and never cancel
// on disconnect — they exist precisely to warm the cache for the next
// poll.
interface InflightCompute {
  promise: Promise<RouteBookResponseJson>;
  controller: AbortController;
  waiters: number;
  cancelOnIdle: boolean;
}
const inflight = new Map<string, InflightCompute>();

// Await an in-flight compute on behalf of a request. If the request's own
// signal aborts (tab closed, fetch cancelled) we drop the waiter and, when
// nobody else is waiting, abort the upstream simulate.
const awaitAsWaiter = async (
  entry: InflightCompute,
  reqSignal: AbortSignal,
): Promise<RouteBookResponseJson> => {
  entry.waiters += 1;
  const onAbort = () => {
    entry.waiters -= 1;
    if (entry.waiters <= 0 && entry.cancelOnIdle && !entry.controller.signal.aborted) {
      entry.controller.abort(new Error('all requesters disconnected'));
    }
  };
  reqSignal.addEventListener('abort', onAbort, { once: true });
  try {
    return await entry.promise;
  } finally {
    reqSignal.removeEventListener('abort', onAbort);
    if (!reqSignal.aborted) {
      entry.waiters -= 1;
    }
  }
};

const cacheHeaders = (cached: CacheEntry, now: number, age: number) => ({
  'Cache-Control': 'no-store',
  'X-Cache': cached.expiresAt > now ? 'HIT' : 'STALE',
  'X-Cache-Age-Ms': String(age),
});

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

  const cacheKey = `${baseAssetSymbol.toLowerCase()}|${quoteAssetSymbol.toLowerCase()}|${limit}`;
  const now = Date.now();
  // `nocache=1` bypasses the server-side SWR read (still writes fresh
  // data back to the cache). The client sends this right after a user's
  // own swap so the LP-panel mid / route-book reflect the just-landed
  // trade rather than the pre-swap snapshot the 6s TTL was still
  // serving. All non-owner traffic keeps the normal cached path. It does
  // NOT bypass single-flight below: two simultaneous primes for the same
  // key share one pd compute.
  const bypassRead = searchParams.get('nocache') === '1';
  const cached = bypassRead ? undefined : cache.get(cacheKey);

  const startCompute = (cancelOnIdle: boolean): InflightCompute => {
    const controller = new AbortController();
    const promise = computeRouteBook(
      grpcEndpoint,
      chainId,
      baseAssetSymbol,
      quoteAssetSymbol,
      limit,
      controller.signal,
    )
      .then(data => {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + CACHE_TTL_MS,
          refreshing: false,
        });
        return data;
      })
      .catch((err: unknown) => {
        // A rejected refresh must clear `refreshing` on the existing
        // entry — otherwise the flag is wedged as `true` forever and
        // subsequent requests skip refresh entirely, pinning the stale
        // entry indefinitely.
        const c = cache.get(cacheKey);
        if (c) c.refreshing = false;
        throw err;
      })
      .finally(() => {
        if (inflight.get(cacheKey) === entry) {
          inflight.delete(cacheKey);
        }
      });
    const entry: InflightCompute = { promise, controller, waiters: 0, cancelOnIdle };
    inflight.set(cacheKey, entry);
    return entry;
  };

  const startBackgroundRefresh = () => {
    if (inflight.has(cacheKey)) return;
    if (cached) cached.refreshing = true;
    const entry = startCompute(false);
    // The SWR path never awaits the compute; without this handler every
    // pd timeout during an outage surfaces as an unhandledRejection.
    entry.promise.catch((err: unknown) => {
      console.error('[book] background refresh failed', { cacheKey, err });
    });
  };

  // Stale-while-revalidate: if we have ANY cached entry, serve it
  // immediately and refresh in background. User never waits for pd.
  if (cached) {
    const age = now - (cached.expiresAt - CACHE_TTL_MS);
    // If the entry is grossly stale (> 10× TTL) we've almost certainly
    // been wedged by a failed refresh; force a fresh compute rather than
    // keep serving ancient data. Reset the flag to allow a retry.
    const grosslyStale = age > CACHE_TTL_MS * 10;
    if (grosslyStale) {
      cached.refreshing = false;
    } else {
      if (age > STALE_THRESHOLD_MS && !cached.refreshing) {
        startBackgroundRefresh();
      }
      return NextResponse.json(cached.data, { headers: cacheHeaders(cached, now, age) });
    }
    // Fall through to the synchronous compute path below for grosslyStale.
  }

  // No cached entry — must compute synchronously. Single-flight to avoid
  // duplicate pd queries for concurrent first-time requests. An in-flight
  // entry whose controller already fired is a dying promise (its
  // rejection lands a microtask later); don't attach to it, start fresh.
  const existing = inflight.get(cacheKey);
  if (existing && !existing.controller.signal.aborted) {
    try {
      const data = await awaitAsWaiter(existing, req.signal);
      return NextResponse.json(data, { headers: { 'X-Cache': 'INFLIGHT' } });
    } catch (err) {
      if (req.signal.aborted) {
        // Client went away mid-wait; nobody will read this response.
        return emptyFallback('INFLIGHT-ABORT');
      }
      // The in-flight compute rejected. Return an empty book rather than
      // 500 — the caller will retry on the next block poll and the
      // primary compute path below will try again.
      console.error('[book] inflight failed, serving empty fallback', { cacheKey, err });
      return emptyFallback('INFLIGHT-FAIL');
    }
  }

  const entry = startCompute(true);
  try {
    const data = await awaitAsWaiter(entry, req.signal);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    if (req.signal.aborted) {
      // Every requester disconnected and we aborted pd on their behalf.
      // Not an outage — log quietly so ops don't read tab-closes as pd
      // failures.
      console.info('[book] compute cancelled, all requesters disconnected', { cacheKey });
      return emptyFallback('MISS-ABORT');
    }
    // pd unreachable, slow, or throwing. Prefer the last-known cache
    // entry to `EMPTY_BOOK` — the user seeing a slightly-stale book is a
    // much better degradation than an empty ladder while pd recovers,
    // especially during the grosslyStale window when we already paid the
    // full timeout. The fallback below stays as a last resort for when
    // we've never had a successful compute.
    const salvage = cache.get(cacheKey);
    if (salvage) {
      console.error('[book] compute failed, serving stale fallback', {
        cacheKey,
        ageMs: Date.now() - (salvage.expiresAt - CACHE_TTL_MS),
        err,
      });
      return NextResponse.json(salvage.data, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': 'STALE-FAIL',
          'X-Book-Fallback': 'stale',
        },
      });
    }
    console.error('[book] compute failed, serving empty fallback', { cacheKey, err });
    return emptyFallback('MISS-FAIL');
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

const withHardStop = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`pd simulate hard-stopped after ${ms}ms`)), ms);
  });
  return Promise.race([p, stop]).finally(() => {
    if (handle) clearTimeout(handle);
  });
};

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
