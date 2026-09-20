import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-side proxy for CoinGecko's `simple/price` endpoint. Same shape as
// /api/um-price (which is a single-id specialization) but takes an
// arbitrary comma-separated `ids=` and returns `{ [id]: { usd, ... } }`.
//
// Used by the LP form to suggest a smart "reference price" default —
// e.g. USDC/USDC.inj → `{ 'usd-coin': { usd: 1 }, 'wrapped-usd-coin-injective': { usd: 1 } }` → ratio 1.0.
// Bitcoin/ETH LPs on Penumbra get a real market-price default the same way.
//
// The `symbol → coingecko-id` mapping lives in the shared client-side
// consts file for now; longer-term it belongs on the registry so every
// consumer (veil, zafu, third-party wallets) gets the same intel.
//
// Caching, three layers, all in-process:
//  - 60s positive cache keyed by the sorted id set (LRU, capped at
//    MAX_CACHE_ENTRIES so an id-permutation flood can't grow the Map
//    unbounded over a long-lived next-server).
//  - single-flight: concurrent requests for the same key share ONE
//    upstream call instead of each racing CoinGecko on a cold key.
//  - 30s negative cache: a 429 / 5xx / network error is remembered and
//    re-served as the same 502 shape, so a burst of LP-form opens during
//    a rate-limit window doesn't hammer CoinGecko and dig the hole deeper.
//    When a stale positive entry exists we prefer serving THAT (tagged
//    `X-Fallback: stale`) over the error — the LP form gets a slightly old
//    reference price instead of none.

type PriceRow = { usd?: number; usd_24h_change?: number };
type PriceMap = Record<string, PriceRow>;

interface CacheEntry {
  at: number;
  value: PriceMap;
}
interface NegativeEntry {
  at: number;
  status: number;
  error: string;
}

const cache = new Map<string, CacheEntry>();
const negative = new Map<string, NegativeEntry>();
const inflight = new Map<string, Promise<NextResponse>>();
const CACHE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 500;
const MAX_IDS = 25;

// Map iteration order is insertion order; re-inserting on read makes the
// oldest-*used* key the first one, so evicting `keys().next()` is LRU.
const lruGet = <V>(map: Map<string, V>, key: string): V | undefined => {
  const v = map.get(key);
  if (v !== undefined) {
    map.delete(key);
    map.set(key, v);
  }
  return v;
};
const lruSet = <V>(map: Map<string, V>, key: string, value: V) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

const errorResponse = (status: number, error: string, extra?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

const staleOrError = (key: string, status: number, error: string): NextResponse => {
  const stale = cache.get(key);
  if (stale) {
    return NextResponse.json(stale.value, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Fallback': 'stale',
        'X-Cache-Age-Ms': String(Date.now() - stale.at),
      },
    });
  }
  return errorResponse(status, error);
};

const fetchUpstream = async (key: string): Promise<NextResponse> => {
  const params = new URLSearchParams({
    ids: key,
    vs_currencies: 'usd',
    include_24hr_change: 'true',
  });
  const now = Date.now();
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`, {
      headers: { 'user-agent': 'penumbra-veil/1' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const error = `coingecko: ${res.status}`;
      lruSet(negative, key, { at: now, status: 502, error });
      return staleOrError(key, 502, error);
    }
    const body = (await res.json()) as PriceMap;
    lruSet(cache, key, { at: now, value: body });
    negative.delete(key);
    return NextResponse.json(body, { headers: { 'X-Cache': 'MISS' } });
  } catch (e) {
    const error = `coingecko: ${String(e)}`;
    lruSet(negative, key, { at: now, status: 502, error });
    return staleOrError(key, 502, error);
  }
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const rawIds = (searchParams.get('ids') ?? '').trim();
  if (!rawIds) {
    return NextResponse.json({ error: 'missing ids' }, { status: 400 });
  }

  // Normalize: strip whitespace, dedupe, cap, lowercase (coingecko ids
  // are already lower-kebab; belt-and-suspenders against fat-fingered
  // input creating cache-key permutations of the same request).
  const ids = [
    ...new Set(
      rawIds
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => /^[a-z0-9._-]{1,64}$/.test(s)),
    ),
  ].slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no valid ids' }, { status: 400 });
  }
  const key = ids.slice().sort().join(',');
  const now = Date.now();

  const hit = lruGet(cache, key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.value, {
      headers: { 'X-Cache': 'HIT', 'X-Cache-Age-Ms': String(now - hit.at) },
    });
  }

  const neg = negative.get(key);
  if (neg && now - neg.at < NEGATIVE_TTL_MS) {
    // Recently failed upstream: don't retry yet. Same 502 body the
    // consumer already handles (`useReferencePrice` checks `r.ok`), or a
    // stale positive if we have one.
    const res = staleOrError(key, neg.status, neg.error);
    res.headers.set('X-Cache', 'NEGATIVE');
    return res;
  }

  // Single-flight: share one upstream call per key. Each waiter gets its
  // own NextResponse (a Response body can only be consumed once) built
  // from the shared outcome.
  const existing = inflight.get(key);
  if (existing) {
    const shared = await existing;
    return cloneResponse(shared, 'INFLIGHT');
  }
  const p = fetchUpstream(key).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

const cloneResponse = (res: NextResponse, xCache: string): NextResponse => {
  const headers = new Headers(res.headers);
  headers.set('X-Cache', xCache);
  return new NextResponse(res.body ? res.clone().body : null, {
    status: res.status,
    headers,
  });
};
