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
import { SimulationService, TendermintProxyService } from '@penumbra-zone/protobuf';
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
// CPU-expensive: we ask for an effectively unbounded amount, so every call
// fills through the whole reachable book up to the chain's execution budget
// (~3s of pd CPU each). And pd here is the validator's own node, so wasted
// simulates compete with consensus.
//
// A book can only change when a block commits, so the rule is: AT MOST ONE
// compute per pair per block. Freshness is gated on chain height, not a
// timer: the cached book is served until pd reports a newer block, then the
// next request recomputes it (single-flighted, so every concurrent viewer
// shares that one compute). A timer can't do this: blocks are ~5.4s and
// jittery, so a 2s window recomputed each pair up to 3x per block, and a
// fixed 5s one would still double up on some blocks and lag on others.
//
// Keyed by pair only. Both trace limits the client uses (30, 100) come from
// ONE compute at COMPUTE_TRACE_LIMIT, sliced per request: pd never sees the
// limit (it only trims our post-processing), so separate keys meant two
// identical pd calls per pair per refresh.
interface CacheEntry {
  data: RouteBookResponseJson;
  expiresAt: number;
  refreshing: boolean;
  /** Chain height the book was computed at, when known. */
  height?: bigint;
}
const cache = new Map<string, CacheEntry>();
// Bookkeeping TTL used for the entry's age math.
const CACHE_TTL_MS = 4_000;
// Freshness window used ONLY when the chain height is unknown (getStatus
// failing). About one block.
const FALLBACK_FRESH_WINDOW_MS = 5_000;
// After a failed compute, don't try that pair again for this long, and keep
// serving the last good book. Without it a slow pd got a new 10s simulate
// the moment the previous one timed out, per pair, forever: the pile-up that
// saturated pd on 2026-09-24.
const FAILURE_BACKOFF_MS = 15_000;
const COMPUTE_TRACE_LIMIT = 100;

/** Last compute ATTEMPT per pair, successful or not. The one-per-block gate. */
const lastAttempt = new Map<string, { height?: bigint; at: number; failed: boolean }>();

// Latest committed height, from pd's getStatus. Refreshed at most once a
// second per process, single-flighted, and NEVER on the request's critical
// path once a height is known: requests read the last known height and the
// refresh runs in the background. getStatus is cheap but not reliably fast
// (seconds when pd is busy), and awaiting it put that delay on every book
// request, cache hits included. A height up to ~1s old just means a new
// block's recompute starts up to ~1s later.
const HEIGHT_REFRESH_MS = 1_000;
// Beyond this, a remembered height is too old to gate on: treat it as
// unknown and fall back to the time window.
const HEIGHT_MAX_AGE_MS = 15_000;
interface HeightState {
  height?: bigint;
  /** When `height` was last confirmed by pd. */
  heightAt: number;
  /** When a refresh was last attempted (success or not). */
  triedAt: number;
  inflight?: Promise<bigint | undefined>;
}
const heightState: HeightState = { heightAt: 0, triedAt: 0 };
let cachedStatusClient: Client<typeof TendermintProxyService> | undefined;
const refreshHeight = (endpoint: string): Promise<bigint | undefined> => {
  if (!heightState.inflight) {
    heightState.triedAt = Date.now();
    cachedStatusClient ??= createClient(endpoint, TendermintProxyService);
    heightState.inflight = cachedStatusClient
      .getStatus({}, { timeoutMs: 2_000, signal: AbortSignal.timeout(2_000) })
      .then(res => {
        const h = res.syncInfo?.latestBlockHeight;
        if (h !== undefined) {
          heightState.height = h;
          heightState.heightAt = Date.now();
        }
        return h;
      })
      // Keep the last good height; HEIGHT_MAX_AGE_MS retires it if pd stays
      // unreachable.
      .catch(() => undefined)
      .finally(() => {
        heightState.inflight = undefined;
      });
  }
  return heightState.inflight;
};
const getLatestHeight = async (endpoint: string): Promise<bigint | undefined> => {
  const now = Date.now();
  if (now - heightState.triedAt >= HEIGHT_REFRESH_MS) {
    const pending = refreshHeight(endpoint);
    if (heightState.height === undefined) {
      // Nothing known yet (cold start): this one request waits.
      return pending;
    }
  }
  return now - heightState.heightAt < HEIGHT_MAX_AGE_MS ? heightState.height : undefined;
};

/** Trim a COMPUTE_TRACE_LIMIT book to what this request asked for. */
export const sliceBook = (data: RouteBookResponseJson, limit: number): RouteBookResponseJson => {
  if (limit >= COMPUTE_TRACE_LIMIT) {
    return data;
  }
  // Both sides are stored best-price-first (see processSimulation), so the
  // first `limit` entries are exactly what a `limit` compute returned, and
  // single hops are, as before, the 2-hop subset of the trimmed multi-hop list.
  const buy = data.multiHops.buy.slice(0, limit);
  const sell = data.multiHops.sell.slice(0, limit);
  return {
    singleHops: {
      buy: buy.filter(t => t.hops.length === 2),
      sell: sell.filter(t => t.hops.length === 2),
    },
    multiHops: { buy, sell },
  };
};

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

  const cacheKey = `${baseAssetSymbol.toLowerCase()}|${quoteAssetSymbol.toLowerCase()}`;
  const height = await getLatestHeight(grpcEndpoint);
  const now = Date.now();
  // `nocache=1` used to force a compute after a user's own swap. It is no
  // longer needed and is ignored: the swap lands in a new block, the height
  // moves, and the next request recomputes anyway. Honouring it let every
  // client bypass the one-per-block limit.
  const cached = cache.get(cacheKey);

  const startCompute = (cancelOnIdle: boolean): InflightCompute => {
    const controller = new AbortController();
    const promise = computeRouteBook(
      grpcEndpoint,
      chainId,
      baseAssetSymbol,
      quoteAssetSymbol,
      COMPUTE_TRACE_LIMIT,
      controller.signal,
    )
      .then(data => {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + CACHE_TTL_MS,
          refreshing: false,
          height,
        });
        lastAttempt.set(cacheKey, { height, at: Date.now(), failed: false });
        return data;
      })
      .catch((err: unknown) => {
        // Record the failure unless every requester simply went away: a
        // cancelled compute says nothing about pd's health.
        if (!controller.signal.aborted) {
          lastAttempt.set(cacheKey, { height, at: Date.now(), failed: true });
        }
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

  // The one-per-block gate. Serve the cached book when it was computed at the
  // current height, or when this pair was already attempted at this height
  // (even if that attempt failed), or while backing off from a failure.
  if (cached) {
    const age = now - (cached.expiresAt - CACHE_TTL_MS);
    const attempt = lastAttempt.get(cacheKey);
    const sameBlock =
      height !== undefined
        ? cached.height === height || attempt?.height === height
        : age < FALLBACK_FRESH_WINDOW_MS;
    const backingOff = !!attempt?.failed && now - attempt.at < FAILURE_BACKOFF_MS;
    if (sameBlock || backingOff) {
      return NextResponse.json(sliceBook(cached.data, limit), {
        headers: {
          ...cacheHeaders(cached, now, age),
          ...(backingOff && !sameBlock ? { 'X-Book-Fallback': 'backoff' } : {}),
        },
      });
    }
    // New block: serve this book now and refresh in the background, rather
    // than holding the request for the ~3-6s a compute takes. It is no less
    // fresh in practice: a request that waited would get block H's book only
    // after that same delay, and the client polls again next block anyway.
    // Still one compute per pair per block: the in-flight entry gates it.
    const running = inflight.get(cacheKey);
    if (!running || running.controller.signal.aborted) {
      // Background compute: nobody waits on it, so it must not cancel when
      // this request ends, and its failure is handled (salvage + backoff).
      startCompute(false).promise.catch(() => undefined);
    }
    return NextResponse.json(sliceBook(cached.data, limit), {
      headers: { ...cacheHeaders(cached, now, age), 'X-Cache': 'STALE-REVALIDATE' },
    });
  }

  // No cached entry at all (cold start, or a pair nobody has viewed) — must
  // compute synchronously. Single-flight to avoid
  // duplicate pd queries for concurrent first-time requests. An in-flight
  // entry whose controller already fired is a dying promise (its
  // rejection lands a microtask later); don't attach to it, start fresh.
  const existing = inflight.get(cacheKey);
  if (existing && !existing.controller.signal.aborted) {
    try {
      const data = await awaitAsWaiter(existing, req.signal);
      return NextResponse.json(sliceBook(data, limit), { headers: { 'X-Cache': 'INFLIGHT' } });
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
    return NextResponse.json(sliceBook(data, limit), {
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
      return NextResponse.json(sliceBook(salvage.data, limit), {
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
