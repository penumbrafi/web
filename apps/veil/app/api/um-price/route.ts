import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-side proxy for the CoinGecko public "coins/markets" endpoint.
// The old flow fetched CoinGecko directly from the browser and blew up on
// CORS in production because their reverse proxy does not set
// Access-Control-Allow-Origin for arbitrary web origins. We tunnel it
// through the Next server (no origin, no CORS) and pass the two fields
// the header chip needs. 60s in-memory cache keeps us well under
// CoinGecko's free-tier limits.
type Row = { current_price: number; price_change_percentage_24h: number };

let cache: { at: number; value: Row } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.value);
  }
  const params = new URLSearchParams({ ids: 'penumbra', vs_currency: 'usd' });
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}`, {
      // CoinGecko rate-limits by IP; a User-Agent avoids their generic bot heuristic.
      headers: { 'user-agent': 'penumbra-explorer/1' },
      // Explicit 5s cap; the container's outbound to CoinGecko can be slow.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `coingecko: ${res.status}` }, { status: 502 });
    }
    const body = (await res.json()) as Row[];
    const row = body[0];
    if (!row) {
      return NextResponse.json({ error: 'coingecko: empty response' }, { status: 502 });
    }
    cache = { at: now, value: row };
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: `coingecko: ${String(e)}` }, { status: 502 });
  }
}
