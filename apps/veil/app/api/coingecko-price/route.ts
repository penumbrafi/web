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
// 60s in-memory cache keeps us under CoinGecko's free-tier limits even
// with a busy trade page. Requests coalesce naturally: identical `ids`
// share a cache entry.

type PriceRow = { usd?: number; usd_24h_change?: number };
type PriceMap = Record<string, PriceRow>;

const cache = new Map<string, { at: number; value: PriceMap }>();
const CACHE_TTL_MS = 60_000;
const MAX_IDS = 25;

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
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.value);
  }

  const params = new URLSearchParams({
    ids: key,
    vs_currencies: 'usd',
    include_24hr_change: 'true',
  });
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`, {
      headers: { 'user-agent': 'penumbra-veil/1' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `coingecko: ${res.status}` }, { status: 502 });
    }
    const body = (await res.json()) as PriceMap;
    cache.set(key, { at: now, value: body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: `coingecko: ${String(e)}` }, { status: 502 });
  }
}
