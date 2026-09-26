import { NextResponse, NextRequest } from 'next/server';
import { DEFAULT_PAIR, LAST_PAIR_COOKIE } from '@/shared/config/featured-pairs';

export const routingProxy = (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // `/` is now the market/landing page itself (app/page.tsx); no redirect.

  // The last-pair cookie is written by the trade page itself (see
  // use-remember-pair), not here: Next prefetches every pair link in view
  // through this proxy, and in this Next version the prefetch headers don't
  // reach it, so a write here recorded whichever pair was prefetched last.

  // /trade — redirect to the last viewed pair, or the default market.
  if (pathname === '/trade') {
    const lastPair = request.cookies.get(LAST_PAIR_COOKIE)?.value;
    if (lastPair && /^[^/]+\/[^/]+$/.test(lastPair)) {
      // Honored as-is. It used to be filtered against a hand-maintained symbol
      // allowlist so a stale cookie couldn't land you on a bridge-paused pair;
      // that list is gone (health is chain-state-driven now, see
      // shared/config/bridge-health.ts) and a per-request chain query has no
      // business in middleware. Whatever the pair is, /trade renders it and the
      // badge on it says what state its bridge is in.
      return NextResponse.redirect(new URL(`/trade/${lastPair}`, request.url));
    }

    // Pin the default to the market with the deepest book rather than the
    // registry's top-2-by-priorityScore, so fresh visitors land somewhere
    // populated.
    return NextResponse.redirect(
      new URL(`/trade/${DEFAULT_PAIR.base}/${DEFAULT_PAIR.quote}`, request.url),
    );
  }

  return NextResponse.next();
};
