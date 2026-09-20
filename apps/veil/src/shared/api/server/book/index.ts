import { NextRequest, NextResponse } from 'next/server';
import { ChainRegistryClient } from '@penumbra-labs/registry';
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

type Registry = Awaited<ReturnType<ChainRegistryClient['remote']['get']>>;

export const VERY_HIGH_AMOUNT = new Amount({ hi: 10000n }); // Used as default to generate sufficient amount of traces
export const TRACE_LIMIT_DEFAULT = 30;

export type RouteBookApiResponse = RouteBookResponseJson | { error: string };

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

// Module-scope singletons. Endpoint + chainId come from env vars baked at
// process start — they don't change over a next-server lifetime, so we can
// safely reuse one Connect transport (keeps the HTTP/2 connection to nginx
// alive across requests, killing the ~1s TLS handshake per book refresh)
// and one registry (its `remote.get(chainId)` fetches the mainnet registry
// over WAN — cache it indefinitely; a registry change requires a rolling
// deploy anyway).
let cachedClient: Client<typeof SimulationService> | undefined;
const getSimClient = (endpoint: string): Client<typeof SimulationService> => {
  if (!cachedClient) {
    cachedClient = createClient(endpoint, SimulationService);
  }
  return cachedClient;
};

let registryPromise: Promise<Registry> | undefined;
const getRegistry = (chainId: string): Promise<Registry> => {
  if (!registryPromise) {
    registryPromise = new ChainRegistryClient().remote.get(chainId).catch(err => {
      // Clear on failure so the next request retries instead of pinning a
      // rejected promise forever.
      registryPromise = undefined;
      throw err;
    });
  }
  return registryPromise;
};

// Server-side cache for route book responses. pd's simulateTrade is
// CPU-expensive (walks all liquidity positions) so we cache identical
// queries for ~6s (one block). Keyed by base+quote+limit. Concurrent
// requests for the same key share a single in-flight promise so we
// never hammer pd with duplicate work.
type CacheEntry = { data: RouteBookResponseJson; expiresAt: number; refreshing: boolean };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RouteBookResponseJson>>();
const CACHE_TTL_MS = 6_000;
// When a request comes in and cache is older than this, return the stale
// data immediately and refresh in background. This means most users never
// wait for pd's slow simulateTrade — they get instant stale data while a
// background fetch updates the cache.
const STALE_THRESHOLD_MS = 4_000;

export async function GET(req: NextRequest): Promise<NextResponse<RouteBookApiResponse>> {
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
  const limit = traceParam ? Number(traceParam) : TRACE_LIMIT_DEFAULT;
  if (!baseAssetSymbol || !quoteAssetSymbol) {
    return NextResponse.json(
      { error: 'Missing required baseAsset or quoteAsset' },
      { status: 400 },
    );
  }

  const cacheKey = `${baseAssetSymbol.toLowerCase()}|${quoteAssetSymbol.toLowerCase()}|${limit}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  const startBackgroundRefresh = () => {
    if (inflight.has(cacheKey)) return;
    if (cached) cached.refreshing = true;
    const refresh = computeRouteBook(
      grpcEndpoint,
      chainId,
      baseAssetSymbol,
      quoteAssetSymbol,
      limit,
    )
      .then(data => {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + CACHE_TTL_MS,
          refreshing: false,
        });
        return data;
      })
      .catch(err => {
        // A rejected background refresh must clear `refreshing` on the
        // existing entry — otherwise the flag is wedged as `true` forever
        // and subsequent requests skip refresh entirely, pinning the
        // stale entry indefinitely. Log so the failure is visible.
        const c = cache.get(cacheKey);
        if (c) c.refreshing = false;
        console.error('[book] background refresh failed', { cacheKey, err });
        throw err;
      })
      .finally(() => {
        inflight.delete(cacheKey);
      });
    inflight.set(cacheKey, refresh);
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
    } else if (age > STALE_THRESHOLD_MS && !cached.refreshing) {
      startBackgroundRefresh();
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': cached.expiresAt > now ? 'HIT' : 'STALE',
          'X-Cache-Age-Ms': String(age),
        },
      });
    } else {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': cached.expiresAt > now ? 'HIT' : 'STALE',
          'X-Cache-Age-Ms': String(age),
        },
      });
    }
    // Fall through to the synchronous compute path below for grosslyStale.
  }

  // No cached entry — must compute synchronously. Single-flight to avoid
  // duplicate pd queries for concurrent first-time requests.
  const existing = inflight.get(cacheKey);
  if (existing) {
    try {
      const data = await existing;
      return NextResponse.json(data, { headers: { 'X-Cache': 'INFLIGHT' } });
    } catch (err) {
      // The in-flight compute rejected. Return an empty book rather than
      // 500 — the caller will retry on the next block poll and the
      // primary compute path below will try again.
      console.error('[book] inflight failed, serving empty fallback', {
        cacheKey,
        err,
      });
      return NextResponse.json(EMPTY_BOOK, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': 'INFLIGHT-FAIL',
          'X-Book-Fallback': 'empty',
        },
      });
    }
  }

  const compute = computeRouteBook(
    grpcEndpoint,
    chainId,
    baseAssetSymbol,
    quoteAssetSymbol,
    limit,
  );
  inflight.set(cacheKey, compute);
  let data: RouteBookResponseJson;
  try {
    data = await compute;
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
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
    console.error('[book] compute failed, serving empty fallback', {
      cacheKey,
      err,
    });
    return NextResponse.json(EMPTY_BOOK, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Cache': 'MISS-FAIL',
        'X-Book-Fallback': 'empty',
      },
    });
  } finally {
    inflight.delete(cacheKey);
  }
}

async function computeRouteBook(
  grpcEndpoint: string,
  chainId: string,
  baseAssetSymbol: string,
  quoteAssetSymbol: string,
  limit: number,
): Promise<RouteBookResponseJson> {
  const registry = await getRegistry(chainId);

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
  // Race each side against a hard timeout so a hanging pd request cannot
  // pin a next-server request slot (or the in-flight promise) for longer
  // than one block. On timeout we surface a plain Error the outer catch
  // renders as an empty-book fallback response.
  const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
      handle = setTimeout(
        () => reject(new Error(`pd ${label} timed out after ${PD_TIMEOUT_MS}ms`)),
        PD_TIMEOUT_MS,
      );
    });
    return Promise.race([p, timeout]).finally(() => {
      if (handle) clearTimeout(handle);
    });
  };
  const [buyRes, sellRes] = await Promise.all([
    withTimeout(simulateTrade(client, buySideRequest), 'buy simulate'),
    withTimeout(simulateTrade(client, sellSideRequest), 'sell simulate'),
  ]);
  const buyMulti = processSimulation({ res: buyRes, registry, limit, quote_to_base: false });
  const sellMulti = processSimulation({ res: sellRes, registry, limit, quote_to_base: true });

  return serializeResponse({
    singleHops: {
      buy: buyMulti.filter(t => t.hops.length === 2),
      sell: sellMulti.filter(t => t.hops.length === 2),
    },
    multiHops: { buy: buyMulti, sell: sellMulti },
  });
}

const simulateTrade = async (
  client: Client<typeof SimulationService>,
  req: SimulateTradeRequest,
) => {
  try {
    return await client.simulateTrade(req);
  } catch (e) {
    // If the error contains 'there are no orders to fulfill this swap', there are no orders to fulfill the trade,
    // so just return an empty array
    if (e instanceof Error && e.message.includes('there are no orders to fulfill this swap')) {
      return new SimulateTradeResponse({});
    }

    throw new Error(`Error retrieving route book: ${String(e)}`);
  }
};
