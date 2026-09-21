import { NextRequest, NextResponse } from 'next/server';
import { derivedUsdForSymbol } from '@/shared/api/server/derived-usd-price';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// UM price for the header chip. Historically hit CoinGecko's `penumbra`
// listing — but CoinGecko marked that inactive/deactivated and returns
// a stale ~$0.00136 that would silently mislead every viewer. We now
// derive UM/USD on-chain via /api/derived-usd-price's pipeline (depth-
// gated VWAP through a fixed-USD bridge, e.g. USDC.inj), so the chip
// shows the same anchor the LP form uses.
//
// The consumer (`inspect/explorer/lib/data/getUmPrice.ts`) reads
// `current_price` + `price_change_percentage_24h`. The derived pipeline
// has no historical component, so 24h change is 0 — treated as "no
// change" by the chip's colour band rather than a fake up/down.

type UmPriceRow = {
  current_price: number;
  price_change_percentage_24h: number;
  // Extra fields the LP form can key off; harmless to the header chip.
  source?: 'onchain-bridge';
  bridge?: string;
  depthUsd?: number;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const derived = await derivedUsdForSymbol('UM', req.signal);
  if (!derived) {
    return NextResponse.json({ error: 'no derived UM price available' }, { status: 502 });
  }
  const body: UmPriceRow = {
    current_price: derived.usd,
    price_change_percentage_24h: 0,
    source: 'onchain-bridge',
    bridge: derived.bridge,
    depthUsd: derived.depthUsd,
  };
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Cache-Age-Ms': String(derived.ageMs),
    },
  });
}
