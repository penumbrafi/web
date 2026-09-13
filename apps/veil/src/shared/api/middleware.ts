import { NextResponse, NextRequest } from 'next/server';
import { DEFAULT_PAIR, isPairHealthy } from '@/shared/config/featured-pairs';

const LAST_PAIR_COOKIE = 'veil_last_pair';
const LAST_PAIR_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export const routingMiddleware = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // `/` is now the market/landing page itself (app/page.tsx); no redirect.

  // Remember the last viewed pair so /trade can redirect back to it.
  const tradePairMatch = pathname.match(/^\/trade\/([^/]+)\/([^/]+)\/?$/);
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
      // Only honor the cookie if BOTH sides of the remembered pair are still
      // healthy. A stale cookie from before we scoped IBC to Noble was
      // dumping users onto random bridge-paused pairs on their next visit
      // instead of the default UM/USDC market.
      const [cBase, cQuote] = lastPair.split('/');
      if (isPairHealthy(cBase, cQuote)) {
        return NextResponse.redirect(new URL(`/trade/${lastPair}`, request.url));
      }
    }

    // Pin the default to our highest-volume, always-settleable market (UM/USDC)
    // rather than the registry's top-2-by-priorityScore, so fresh visitors land
    // on a working pair while bridged-asset channels are being redeployed.
    return NextResponse.redirect(
      new URL(`/trade/${DEFAULT_PAIR.base}/${DEFAULT_PAIR.quote}`, request.url),
    );
  }

  return NextResponse.next();
};
