import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { TradePage } from '@/pages/trade';
import { deserializeRouteBookResponseJson } from '@/shared/api/server/book/serialization';
import { RouteBookApiResponse } from '@/shared/api/server/book';

interface Params {
  baseSymbol: string;
  quoteSymbol: string;
}

/**
 * Server Component wrapper for the trade page. Prefetches the book at
 * the default `traceLimit` (used by `useMarketPrice`, the chart anchor,
 * and the depth overlay) on the server and dehydrates the React Query
 * cache into the initial HTML. Client's `useBook` picks up the entry
 * on hydration — zero round trip for the first render, and the LP
 * mid / chart anchor / one-sided badge all resolve immediately.
 *
 * We deliberately do NOT prefetch the ladder's `traceLimit=100` variant
 * here: the ladder mounts one panel below the fold on the default
 * layout, and doubling the prefetch cost gains ~nothing perceptually
 * for the initial paint. Book route's SWR cache warms both variants
 * on the same pd compute so the client's ladder fetch is a hot cache
 * hit anyway.
 *
 * `TradePage` itself stays `'use client'` — the ResizableSplit /
 * useViewport / mobx observers all need the client tree. This is the
 * "smallest possible" server-shell + hydrate boundary that shaves the
 * initial book waterfall without a wholesale island refactor.
 */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { baseSymbol, quoteSymbol } = await params;

  const qc = new QueryClient();
  await prefetchBook(qc, baseSymbol, quoteSymbol);

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <TradePage />
    </HydrationBoundary>
  );
}

async function prefetchBook(qc: QueryClient, baseSymbol: string, quoteSymbol: string) {
  // Same-origin fetch from the server component. Next 16 dedupes and
  // this executes within the request context, so `pindexer_stream` and
  // pd calls made during handleGet run in the same isolate. `headers()`
  // gives us the request's own origin so we don't hard-code a URL.
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'http';
    if (!host) return;
    const url = `${proto}://${host}/api/book?baseAsset=${encodeURIComponent(baseSymbol)}&quoteAsset=${encodeURIComponent(quoteSymbol)}`;
    // Prefetch under the same key the client's `useBook` uses. Default
    // (undefined) traceLimit — matches useMarketPrice/depth-overlay.
    // Time-box so a slow prefetch never delays the first byte.
    const res = await fetch(url, {
      // Server-render this specific request; the internal /api/book
      // has its own 6s SWR cache so Next's fetch cache would only
      // duplicate that layer. Keep it simple.
      cache: 'no-store',
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return;
    const json = (await res.json()) as RouteBookApiResponse;
    if ('error' in json) return;
    qc.setQueryData(['book', baseSymbol, quoteSymbol, undefined], deserializeRouteBookResponseJson(json));
  } catch {
    // Never break the trade page on prefetch failure — client fetches
    // normally as before.
  }
}
