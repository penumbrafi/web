import { NextResponse, NextRequest } from 'next/server';
import { DEFAULT_PAIR } from '@/shared/config/featured-pairs';

const LAST_PAIR_COOKIE = 'veil_last_pair';
const LAST_PAIR_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export const routingProxy = (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // `/` is now the market/landing page itself (app/page.tsx); no redirect.

  // Remember the last viewed pair so /trade can redirect back to it.
  const tradePairMatch = /^\/trade\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  // A prefetch is not a visit. The home page lists every pair as a <Link>,
  // and Next prefetches each one that scrolls into view through this proxy,
  // so "last viewed" became whichever pair was prefetched last (e.g.
  // ATOM.ch0/stATOM) and /trade sent people to a market they never opened.
  const isPrefetch =
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-segment-prefetch') ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('sec-purpose')?.includes('prefetch') === true;
  if (tradePairMatch && isPrefetch) {
    return NextResponse.next();
  }
  if (tradePairMatch) {
    const [, base, quote] = tradePairMatch;
    if (base && quote) {
      const cookieValue = `${base}/${quote}`;
      const existing = request.cookies.get(LAST_PAIR_COOKIE)?.value;
      if (existing !== cookieValue) {
        const response = NextResponse.next();
        response.cookies.set(LAST_PAIR_COOKIE, cookieValue, {
          path: '/',
          maxAge: LAST_PAIR_COOKIE_MAX_AGE,
          sameSite: 'lax',
        });
        return response;
      }
    }
    return NextResponse.next();
  }

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
